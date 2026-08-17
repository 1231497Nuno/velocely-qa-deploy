"""Contas a pagar e a receber (módulo independente de faturas)."""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE = get_base_url()
API = f"{BASE}/api"
ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    original = None
    cat = s.get(f"{API}/settings/modulos")
    if cat.status_code == 200:
        original = list(cat.json().get("ativos") or [])
        if "contas" not in original:
            s.put(f"{API}/settings/modulos", json={"modulos": original + ["contas"]})
    yield s
    if original is not None and "contas" not in original:
        s.put(f"{API}/settings/modulos", json={"modulos": original})


class TestContas:
    def test_criar_receber_e_liquidar(self, client):
        r = client.post(f"{API}/contas", json={
            "tipo": "receber",
            "entidade": "Cliente Teste AR",
            "descricao": "Serviço avulso",
            "valor": 100,
        })
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        try:
            assert c["numero"].startswith("CTR")
            assert c["estado"] == "pendente"
            assert c["valor_pendente"] == 100
            assert c["tipo"] == "receber"

            listed = client.get(f"{API}/contas", params={"tipo": "receber", "q": c["numero"]})
            assert listed.status_code == 200, listed.text
            items = listed.json()
            items = items if isinstance(items, list) else items.get("items") or []
            assert any(x["id"] == cid for x in items)

            upd = client.put(f"{API}/contas/{cid}", json={
                "tipo": "receber",
                "entidade": "Cliente Teste AR",
                "descricao": "Serviço avulso",
                "valor": 100,
                "valor_pago": 40,
            })
            assert upd.status_code == 200, upd.text
            assert upd.json()["estado"] == "parcial"
            assert upd.json()["valor_pendente"] == 60

            upd2 = client.put(f"{API}/contas/{cid}", json={
                "tipo": "receber",
                "entidade": "Cliente Teste AR",
                "descricao": "Serviço avulso",
                "valor": 100,
                "valor_pago": 100,
            })
            assert upd2.status_code == 200, upd2.text
            assert upd2.json()["estado"] == "liquidada"
            assert upd2.json()["valor_pendente"] == 0
        finally:
            client.delete(f"{API}/contas/{cid}")

    def test_criar_pagar_anexo_e_anular(self, client):
        r = client.post(f"{API}/contas", json={
            "tipo": "pagar",
            "entidade": "Fornecedor Teste AP",
            "referencia": "FT-99",
            "valor": 25.5,
        })
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        token = client.headers.get("Authorization")
        try:
            assert c["numero"].startswith("CTP")
            assert c["tipo"] == "pagar"

            up = requests.post(
                f"{API}/contas/{cid}/anexos",
                headers={"Authorization": token},
                files={"file": ("nota.pdf", b"%PDF-1.4 teste", "application/pdf")},
            )
            assert up.status_code == 200, up.text
            anexos = up.json().get("anexos") or []
            assert len(anexos) == 1
            assert anexos[0]["nome"] == "nota.pdf"
            aid = anexos[0]["id"]

            got = client.get(f"{API}/contas/{cid}")
            assert got.status_code == 200
            assert len(got.json().get("anexos") or []) == 1

            an = client.post(f"{API}/contas/{cid}/anular")
            assert an.status_code == 200, an.text
            assert an.json()["estado"] == "anulada"

            rm = client.delete(f"{API}/contas/{cid}/anexos/{aid}")
            assert rm.status_code == 200, rm.text
            assert (rm.json().get("anexos") or []) == []
        finally:
            client.delete(f"{API}/contas/{cid}")

    def test_valor_obrigatorio(self, client):
        r = client.post(f"{API}/contas", json={
            "tipo": "receber",
            "entidade": "X",
            "valor": 0,
        })
        assert r.status_code == 400, r.text
