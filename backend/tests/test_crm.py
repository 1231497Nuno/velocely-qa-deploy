"""CRM / Leads — testes de integração (API a correr em BACKEND_URL).

Cobre: estados configuráveis (criar, editar, reordenar, apagar com destino),
leads (criar, mover no kanban, interações, pesquisa), conversão em cliente
e associação de orçamentos.
"""
import uuid

import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"
ADMIN_LOGIN = "admin"
_, ADMIN_PASS = get_admin_credentials()


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('token')}"}


def _estados(hdr):
    r = requests.get(f"{API}/crm/estados", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_estados_por_defeito_existem(hdr):
    est = _estados(hdr)
    assert len(est) >= 1
    assert all({"id", "nome", "cor", "tipo", "ordem", "total_leads"} <= set(e) for e in est)


def test_ciclo_estado_personalizado(hdr):
    nome = f"TEST estado {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/crm/estados", json={"nome": nome, "cor": "#EA580C"}, headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["cor"] == "#ea580c"
    # nome duplicado
    r = requests.post(f"{API}/crm/estados", json={"nome": nome.upper()}, headers=hdr, timeout=15)
    assert r.status_code == 400
    # editar
    r = requests.put(f"{API}/crm/estados/{e['id']}", json={"nome": nome + " v2", "cor": "#16a34a", "tipo": "aberto"},
                     headers=hdr, timeout=15)
    assert r.status_code == 200 and r.json()["nome"] == nome + " v2"
    # reordenar: pôr o novo em primeiro
    ids = [x["id"] for x in _estados(hdr)]
    nova = [e["id"]] + [i for i in ids if i != e["id"]]
    r = requests.put(f"{API}/crm/estados-ordem", json={"ids": nova}, headers=hdr, timeout=15)
    assert r.status_code == 200 and [x["id"] for x in r.json()] == nova
    # repor ordem original
    requests.put(f"{API}/crm/estados-ordem", json={"ids": ids}, headers=hdr, timeout=15)
    # criar lead no estado e apagar estado sem destino → 400; com destino → move
    lead = requests.post(f"{API}/crm/leads", json={"nome": "TEST lead estado", "estado_id": e["id"]},
                         headers=hdr, timeout=15).json()
    r = requests.delete(f"{API}/crm/estados/{e['id']}", headers=hdr, timeout=15)
    assert r.status_code == 400
    destino = next(x for x in _estados(hdr) if x["id"] != e["id"])
    r = requests.delete(f"{API}/crm/estados/{e['id']}?mover_para={destino['id']}", headers=hdr, timeout=15)
    assert r.status_code == 200 and r.json()["leads_movidos"] == 1
    l2 = requests.get(f"{API}/crm/leads/{lead['id']}", headers=hdr, timeout=15).json()
    assert l2["estado_id"] == destino["id"]
    requests.delete(f"{API}/crm/leads/{lead['id']}", headers=hdr, timeout=15)


def test_ciclo_lead(hdr):
    est = _estados(hdr)
    abertos = [e for e in est if e["tipo"] == "aberto"]
    assert abertos
    tag = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/crm/leads", json={"nome": "", "empresa": ""}, headers=hdr, timeout=15)
    assert r.status_code == 422
    a = requests.post(f"{API}/crm/leads", json={"nome": f"TEST A {tag}", "origem": "Instagram", "valor_estimado": 120},
                      headers=hdr, timeout=15).json()
    b = requests.post(f"{API}/crm/leads", json={"nome": f"TEST B {tag}", "origem": "WhatsApp"},
                      headers=hdr, timeout=15).json()
    assert a["estado_id"] == abertos[0]["id"] and a["valor_estimado"] == 120
    # mover B para antes de A
    r = requests.post(f"{API}/crm/leads/{b['id']}/mover", json={"estado_id": a["estado_id"], "antes_de_id": a["id"]},
                      headers=hdr, timeout=15)
    assert r.status_code == 200
    lista = requests.get(f"{API}/crm/leads?q={tag}", headers=hdr, timeout=15).json()
    assert [x["id"] for x in lista] == [b["id"], a["id"]]
    # interação
    r = requests.post(f"{API}/crm/leads/{a['id']}/interacoes", json={"tipo": "chamada", "texto": "Pediu preço"},
                      headers=hdr, timeout=15)
    assert r.status_code == 200
    det = requests.get(f"{API}/crm/leads/{a['id']}", headers=hdr, timeout=15).json()
    assert det["interacoes"][0]["texto"] == "Pediu preço"
    # converter em cliente particular
    r = requests.post(f"{API}/crm/leads/{a['id']}/converter",
                      json={"cliente": {"nome": f"TEST cliente {tag}", "tipo": "particular"}}, headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    conv = r.json()
    assert conv["is_cliente"] and conv["cliente_id"]
    # orçamento associado
    orc = requests.post(f"{API}/orcamentos", json={"cliente_id": conv["cliente_id"], "cliente": conv["cliente_nome"]},
                        headers=hdr, timeout=15)
    assert orc.status_code == 200, orc.text
    r = requests.post(f"{API}/crm/leads/{a['id']}/orcamentos", json={"orcamento_id": orc.json()["id"]},
                      headers=hdr, timeout=15)
    assert r.status_code == 200 and len(r.json()["orcamentos"]) == 1
    # limpeza
    requests.delete(f"{API}/orcamentos/{orc.json()['id']}", headers=hdr, timeout=15)
    requests.delete(f"{API}/clientes/{conv['cliente_id']}", headers=hdr, timeout=15)
    for lid in (a["id"], b["id"]):
        assert requests.delete(f"{API}/crm/leads/{lid}", headers=hdr, timeout=15).status_code == 200
