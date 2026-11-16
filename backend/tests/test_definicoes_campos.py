"""Definições → Aparência e Campos (obrigatórios, personalizados, cores das linhas).

Testes de integração: API a correr em BACKEND_URL. Repõem a configuração no fim.
"""
import uuid

import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"
_, ADMIN_PASS = get_admin_credentials()


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{API}/auth/login", json={"login": "admin", "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('token')}"}


def test_aparencia_publica_e_guardar(hdr):
    original = requests.get(f"{API}/settings/aparencia", headers=hdr, timeout=15).json()["tema"]
    try:
        r = requests.put(f"{API}/settings/aparencia", json={**original, "cor_principal": "#1D4ED8", "cantos": "suaves"},
                         headers=hdr, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["tema"]["cor_principal"] == "#1d4ed8"
        pub = requests.get(f"{API}/branding", timeout=15).json()  # sem login
        assert pub["tema"]["cantos"] == "suaves"
        r = requests.put(f"{API}/settings/aparencia", json={**original, "cantos": "triangular"}, headers=hdr, timeout=15)
        assert r.status_code == 422
    finally:
        requests.put(f"{API}/settings/aparencia", json=original, headers=hdr, timeout=15)


def test_campos_obrigatorios_e_personalizados(hdr):
    cat = requests.get(f"{API}/settings/campos", headers=hdr, timeout=15).json()
    original = cat["fornecedores"]["config"]
    body = {
        "obrigatorios": ["website"],
        "extras": [{"label": "Prazo de entrega habitual", "tipo": "numero", "obrigatorio": True},
                   {"label": "Zona", "tipo": "lista", "opcoes": [{"valor": "Norte", "cor": "#16a34a"}, "Sul"]}],
        "cores_linhas": {"campo": "extra:zona"},
    }
    try:
        r = requests.put(f"{API}/settings/campos/fornecedores", json=body, headers=hdr, timeout=15)
        assert r.status_code == 200, r.text
        keys = [c["key"] for c in r.json()["extras"]]
        assert keys == ["prazo_de_entrega_habitual", "zona"]
        nome = f"TEST forn {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/fornecedores", json={"nome": nome, "tipo": "particular"}, headers=hdr, timeout=15)
        assert r.status_code == 400 and "Website" in r.text and "Prazo de entrega habitual" in r.text
        r = requests.post(f"{API}/fornecedores", json={
            "nome": nome, "tipo": "particular", "website": "https://x.pt",
            "campos_extra": {"prazo_de_entrega_habitual": "5", "zona": "Norte"},
        }, headers=hdr, timeout=15)
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["campos_extra"] == {"prazo_de_entrega_habitual": 5.0, "zona": "Norte"}
        requests.delete(f"{API}/fornecedores/{f['id']}", headers=hdr, timeout=15)
        # cores só a partir de campos do tipo lista
        bad = {**body, "cores_linhas": {"campo": "extra:prazo_de_entrega_habitual"}}
        assert requests.put(f"{API}/settings/campos/fornecedores", json=bad, headers=hdr, timeout=15).status_code == 400
    finally:
        requests.put(f"{API}/settings/campos/fornecedores", json=original, headers=hdr, timeout=15)


def test_linhas_de_compra_exigem_artigo(hdr):
    oc = requests.post(f"{API}/ordens-compra", json={"assunto": "TEST linhas"}, headers=hdr, timeout=15).json()
    try:
        r = requests.put(f"{API}/ordens-compra/{oc['id']}", json={
            "assunto": "TEST linhas", "linhas": [{"nome": "Linha livre", "quantidade": 1, "preco_unit": 1}],
        }, headers=hdr, timeout=15)
        assert r.status_code == 400 and "artigo" in r.text.lower()
    finally:
        requests.delete(f"{API}/ordens-compra/{oc['id']}", headers=hdr, timeout=15)


def test_previsao_of_da_encomenda(hdr):
    """O resumo da OF devolve operações/materiais por artigo e totais (usa a 1.ª encomenda com artigos)."""
    encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=15).json()
    encs = encs.get("items") if isinstance(encs, dict) else encs
    enc = next((e for e in encs or [] if any(a.get("artigo_id") for a in e.get("artigos") or [])), None)
    if not enc:
        pytest.skip("sem encomendas com artigos no ambiente")
    a = next(x for x in enc["artigos"] if x.get("artigo_id"))
    r = requests.post(f"{API}/encomendas/{enc['id']}/ordens-fabrico/previsao",
                      json={"itens": [{"enc_artigo_id": a["id"], "artigo_id": a["artigo_id"], "quantidade": 1}]},
                      headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["itens"]) == 1 and "operacoes" in body["itens"][0] and "materiais" in body["itens"][0]
    assert {"tempo_maquina_min", "custo_materiais", "avisos"} <= set(body["resumo"])
