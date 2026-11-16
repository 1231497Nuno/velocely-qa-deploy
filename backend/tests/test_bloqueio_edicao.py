"""Documentos em estado final não podem ser editados (OF finalizada, NC fechada).

Testes de integração: API a correr em BACKEND_URL.
"""
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


def test_of_finalizada_nao_editavel(hdr):
    payload = {"cliente": "teste-bloqueio-of", "descricao": "antes", "status": "pendente", "itens": []}
    r = requests.post(f"{API}/ordens-fabrico", json=payload, headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    of_id = r.json()["id"]
    try:
        r = requests.put(f"{API}/ordens-fabrico/{of_id}", json={**payload, "descricao": "editada"}, headers=hdr, timeout=15)
        assert r.status_code == 200, r.text

        r = requests.post(f"{API}/ordens-fabrico/{of_id}/finalizar", headers=hdr, timeout=15)
        assert r.status_code == 200, r.text

        r = requests.put(f"{API}/ordens-fabrico/{of_id}", json={**payload, "descricao": "depois"}, headers=hdr, timeout=15)
        assert r.status_code == 409, r.text
        assert requests.get(f"{API}/ordens-fabrico/{of_id}", headers=hdr, timeout=15).json()["descricao"] == "editada"
    finally:
        requests.delete(f"{API}/ordens-fabrico/{of_id}", headers=hdr, timeout=15)


def test_nc_fechada_so_reabre(hdr):
    arts = requests.get(f"{API}/artigos?lite=1", headers=hdr, timeout=15).json()
    arts = arts if isinstance(arts, list) else arts.get("items") or []
    if not arts:
        pytest.skip("sem artigos")
    art = arts[0]
    enc = requests.post(f"{API}/encomendas", json={
        "cliente": "Teste bloqueio NC",
        "artigos": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "Artigo", "quantidade": 2, "preco_unit": 1}],
    }, headers=hdr, timeout=15)
    if enc.status_code == 403:
        pytest.skip("módulo de não conformidades inativo")
    assert enc.status_code == 200, enc.text
    enc = enc.json()
    nc_id = None
    try:
        rc = requests.post(f"{API}/encomendas/{enc['id']}/nao-conformidades", json={
            "encomenda_artigo_id": enc["artigos"][0]["id"], "tipo": "defeito", "descricao": "teste", "quantidade": 1,
        }, headers=hdr, timeout=15)
        if rc.status_code == 403:
            pytest.skip("módulo de não conformidades inativo")
        assert rc.status_code == 200, rc.text
        nc_id = rc.json()["id"]

        r = requests.put(f"{API}/nao-conformidades/{nc_id}", json={"estado": "fechada"}, headers=hdr, timeout=15)
        assert r.status_code == 200, r.text

        r = requests.put(f"{API}/nao-conformidades/{nc_id}", json={"descricao": "alterada"}, headers=hdr, timeout=15)
        assert r.status_code == 409, r.text

        r = requests.put(f"{API}/nao-conformidades/{nc_id}", json={"estado": "em_analise", "descricao": "alterada"},
                         headers=hdr, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "em_analise"
        assert r.json()["descricao"] == "teste"  # ao reabrir só muda o estado
    finally:
        if nc_id:
            requests.delete(f"{API}/nao-conformidades/{nc_id}", headers=hdr, timeout=15)
        requests.delete(f"{API}/encomendas/{enc['id']}", headers=hdr, timeout=15)
