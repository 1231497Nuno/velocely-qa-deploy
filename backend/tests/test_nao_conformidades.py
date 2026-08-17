"""Não conformidades abertas a partir das referências das encomendas."""
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
        if "nao_conformidades" not in original:
            s.put(f"{API}/settings/modulos", json={"modulos": original + ["nao_conformidades"]})
    yield s
    if original is not None and "nao_conformidades" not in original:
        s.put(f"{API}/settings/modulos", json={"modulos": original})


def _artigo(client):
    arts = client.get(f"{API}/artigos?lite=1").json()
    arts = arts if isinstance(arts, list) else arts.get("items") or []
    assert arts, "sem artigos"
    return arts[0]


class TestNaoConformidades:
    def test_abrir_nc_na_referencia_da_encomenda(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/encomendas", json={
            "cliente": "Teste NC",
            "artigos": [{
                "artigo_id": art["id"],
                "artigo_nome": art.get("nome") or "Artigo",
                "quantidade": 4,
                "preco_unit": 10,
            }],
        })
        assert r.status_code == 200, r.text
        enc = r.json()
        eid = enc["id"]
        linha = (enc.get("artigos") or [None])[0]
        assert linha
        nc_id = None
        try:
            bad = client.post(f"{API}/encomendas/{eid}/nao-conformidades", json={
                "descricao": "sem referência",
            })
            assert bad.status_code == 400, bad.text

            blocked = client.post(f"{API}/encomendas/{eid}/nao-conformidades", json={
                "encomenda_artigo_id": linha["id"],
                "tipo": "defeito",
                "descricao": "Cor fora do padrão",
                "quantidade": 1,
            })
            assert blocked.status_code == 400, blocked.text
            detail = ((blocked.json() or {}).get("detail") or "").lower()
            assert "entregue" in detail

            put_keys = (
                "cliente", "cliente_id", "descricao", "data", "prazo_entrega", "estado", "notas",
                "desconto_total", "desconto_total_tipo", "artigos", "imagens", "pagamentos",
                "valor_total", "valor_total_manual", "valor_pago", "autorizada_producao",
            )
            put_body = {k: enc[k] for k in put_keys if k in enc}
            put_body["entregue"] = True
            put_body["data_entrega"] = (enc.get("data") or "")[:10] or None
            rp = client.put(f"{API}/encomendas/{eid}", json=put_body)
            assert rp.status_code == 200, rp.text
            assert rp.json().get("entregue") is True

            rc = client.post(f"{API}/encomendas/{eid}/nao-conformidades", json={
                "encomenda_artigo_id": linha["id"],
                "tipo": "defeito",
                "descricao": "Cor fora do padrão",
                "quantidade": 1,
            })
            assert rc.status_code == 200, rc.text
            nc = rc.json()
            nc_id = nc["id"]
            assert (nc.get("numero") or "").startswith("NC-")
            assert nc["encomenda_id"] == eid
            assert nc["encomenda_artigo_id"] == linha["id"]
            assert nc["artigo_id"] == art["id"]
            assert nc["estado"] == "aberta"
            assert "Cor fora do padrão" in (nc.get("descricao") or "")

            lista = client.get(f"{API}/encomendas/{eid}/nao-conformidades")
            assert lista.status_code == 200
            assert any(x["id"] == nc_id for x in lista.json())

            ru = client.put(f"{API}/nao-conformidades/{nc_id}", json={"estado": "em_analise"})
            assert ru.status_code == 200, ru.text
            assert ru.json()["estado"] == "em_analise"
            assert ru.json()["descricao"] == nc["descricao"]
        finally:
            if nc_id:
                client.delete(f"{API}/nao-conformidades/{nc_id}")
            client.delete(f"{API}/encomendas/{eid}")
