"""Bloqueio: quantidade da encomenda não pode descer abaixo do já lançado em OFs."""
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
    return s


def _artigo(client):
    arts = client.get(f"{API}/artigos?lite=1").json()
    arts = arts if isinstance(arts, list) else arts.get("items") or []
    assert arts, "sem artigos"
    return arts[0]


def _enc_put_body(enc, artigos):
    keys = (
        "cliente", "cliente_id", "descricao", "data", "prazo_entrega", "estado", "notas",
        "desconto_total", "desconto_total_tipo", "imagens", "pagamentos",
        "valor_total", "valor_total_manual", "valor_pago", "autorizada_producao",
        "envio", "entregue", "data_entrega",
    )
    body = {k: enc[k] for k in keys if k in enc}
    body["artigos"] = artigos
    return body


class TestEncomendaQtdVsOfs:
    def test_nao_reduz_abaixo_de_ofs(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/encomendas", json={
            "cliente": "Teste Qtd OF",
            "artigos": [{
                "artigo_id": art["id"],
                "artigo_nome": art.get("nome") or "Artigo",
                "quantidade": 18,
                "preco_unit": 5,
            }],
            "autorizada_producao": True,
        })
        assert r.status_code == 200, r.text
        enc = r.json()
        eid = enc["id"]
        linha = (enc.get("artigos") or [None])[0]
        assert linha
        of_id = None
        try:
            # Autorizar se necessário
            if not enc.get("autorizada_producao"):
                body = _enc_put_body(enc, enc["artigos"])
                body["autorizada_producao"] = True
                enc = client.put(f"{API}/encomendas/{eid}", json=body).json()

            of = client.post(f"{API}/encomendas/{eid}/ordens-fabrico", json={
                "cliente": enc.get("cliente") or "Teste",
                "itens": [{
                    "artigo_id": linha["artigo_id"],
                    "artigo_nome": linha["artigo_nome"],
                    "quantidade": 18,
                }],
            })
            assert of.status_code == 200, of.text
            of_id = of.json()["id"]

            artigos_baixa = [{**linha, "quantidade": 15}]
            bad = client.put(f"{API}/encomendas/{eid}", json=_enc_put_body(enc, artigos_baixa))
            assert bad.status_code == 400, bad.text
            detail = ((bad.json() or {}).get("detail") or "").lower()
            assert "of" in detail or "fabrico" in detail

            ok = client.put(f"{API}/encomendas/{eid}", json=_enc_put_body(enc, [{**linha, "quantidade": 18}]))
            assert ok.status_code == 200, ok.text
        finally:
            if of_id:
                client.delete(f"{API}/ordens-fabrico/{of_id}")
            client.delete(f"{API}/encomendas/{eid}")
