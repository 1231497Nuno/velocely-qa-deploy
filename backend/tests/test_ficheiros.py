"""Ficheiros e fotos: do artigo e anexos do documento."""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials, orc_put_body

BASE = get_base_url()
API = f"{BASE}/api"
ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"login": "admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    yield s


def _artigo(client):
    arts = client.get(f"{API}/artigos?lite=1").json()
    arts = arts if isinstance(arts, list) else arts.get("items") or []
    assert arts, "sem artigos"
    return arts[0]


class TestFicheiros:
    def test_artigo_capa_e_anexo_aparecem_no_orcamento(self, client):
        art = _artigo(client)
        token = client.headers.get("Authorization")
        r = client.get(f"{API}/ficheiros/artigo/{art['id']}")
        assert r.status_code == 200, r.text
        grupos = r.json().get("grupos") or []
        assert grupos and grupos[0]["origem"] == "documento"

        up = requests.post(
            f"{API}/ficheiros/artigo/{art['id']}",
            headers={"Authorization": token},
            files={"file": ("ficha.pdf", b"%PDF-1.4 teste", "application/pdf")},
        )
        assert up.status_code == 200, up.text
        itens = (up.json()["grupos"][0].get("itens") or [])
        assert any(i.get("nome") == "ficha.pdf" for i in itens)
        pdf = next(i for i in itens if i.get("nome") == "ficha.pdf")

        orc = client.post(f"{API}/orcamentos", json={
            "cliente": "Teste ficheiros",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "A", "quantidade": 1}],
        })
        assert orc.status_code == 200, orc.text
        oid = orc.json()["id"]
        try:
            fic = client.get(f"{API}/ficheiros/orcamento/{oid}")
            assert fic.status_code == 200, fic.text
            gs = fic.json().get("grupos") or []
            assert gs[0]["origem"] == "documento"
            art_g = next((g for g in gs if g.get("artigo_id") == art["id"]), None)
            assert art_g, fic.text
            assert any(i.get("nome") == "ficha.pdf" for i in (art_g.get("itens") or []))

            add = requests.post(
                f"{API}/ficheiros/orcamento/{oid}",
                headers={"Authorization": token},
                files={"file": ("nota.txt", b"ok", "text/plain")},
            )
            assert add.status_code == 200, add.text
            doc_itens = add.json()["grupos"][0]["itens"]
            assert any(i.get("nome") == "nota.txt" for i in doc_itens)
            nota = next(i for i in doc_itens if i.get("nome") == "nota.txt")

            # PUT do orçamento não apaga anexos
            put = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(orc.json()))
            assert put.status_code == 200, put.text
            again = client.get(f"{API}/ficheiros/orcamento/{oid}").json()
            assert any(i.get("nome") == "nota.txt" for i in again["grupos"][0]["itens"])

            rm = client.delete(f"{API}/ficheiros/orcamento/{oid}", params={"item": nota["id"]})
            assert rm.status_code == 200, rm.text
            assert not any(i.get("nome") == "nota.txt" for i in rm.json()["grupos"][0]["itens"])
        finally:
            client.delete(f"{API}/orcamentos/{oid}")
            client.delete(f"{API}/ficheiros/artigo/{art['id']}", params={"item": pdf["id"]})
