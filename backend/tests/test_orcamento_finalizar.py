"""Rascunho sem número; código ORC só no finalizar."""
import pytest
import requests
from conftest import (
    get_base_url,
    get_admin_credentials,
    orc_put_body,
    finalizar_orcamento,
    finalizar_e_aceitar,
)

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
    yield s


def _artigo(client):
    arts = client.get(f"{API}/artigos").json()
    arts = arts if isinstance(arts, list) else arts.get("items") or []
    assert arts, "sem artigos"
    return next((a for a in arts if a.get("roteiro")), arts[0])


class TestOrcamentoFinalizar:
    def test_criar_e_rascunho_sem_numero(self, client):
        r = client.post(f"{API}/orcamentos", json={"status": "aceite", "linhas": []})
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]
        try:
            assert not (orc.get("numero") or "").strip()
            assert orc["status"] == "rascunho"
            assert orc.get("cliente_id") or (orc.get("cliente") or "").strip()

            rp = client.get(f"{API}/orcamentos/{oid}/pdf")
            assert rp.status_code == 400

            re = client.post(f"{API}/orcamentos/{oid}/enviar-email", json={"to": "a@b.c"})
            assert re.status_code == 400

            orc["status"] = "aceite"
            ru = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(orc))
            assert ru.status_code == 400

            rc = client.post(f"{API}/orcamentos/{oid}/converter")
            assert rc.status_code == 400
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_finalizar_sem_cliente_falha(self, client):
        r = client.post(f"{API}/orcamentos", json={"linhas": []})
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]
        try:
            ru = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(orc, cliente="", cliente_id=None))
            assert ru.status_code == 200, ru.text
            rf = client.post(f"{API}/orcamentos/{oid}/finalizar")
            assert rf.status_code == 400
            assert "cliente" in (rf.json().get("detail") or "").lower()
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_finalizar_sem_linhas_falha(self, client):
        r = client.post(f"{API}/orcamentos", json={"cliente": "teste-sem-linhas", "linhas": []})
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        try:
            rf = client.post(f"{API}/orcamentos/{oid}/finalizar")
            assert rf.status_code == 400
            assert "linha" in (rf.json().get("detail") or "").lower()
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_finalizar_atribui_numero(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-finalizar",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "x", "quantidade": 1}],
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        try:
            assert not (r.json().get("numero") or "").strip()
            fin = finalizar_orcamento(client, f"{API}/orcamentos/{oid}/finalizar")
            assert fin["numero"].startswith("ORC")
            assert fin["status"] == "criado"
            assert fin.get("versao") == 1
            rp = client.get(f"{API}/orcamentos/{oid}/pdf")
            assert rp.status_code == 200
            assert rp.content[:4] == b"%PDF"
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_duplicar_fica_rascunho_sem_numero(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-dup",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "x", "quantidade": 1}],
        })
        oid = r.json()["id"]
        try:
            finalizar_orcamento(client, f"{API}/orcamentos/{oid}/finalizar")
            d = client.post(f"{API}/orcamentos/{oid}/duplicar")
            assert d.status_code == 200, d.text
            novo = d.json()
            assert novo["id"] != oid
            assert not (novo.get("numero") or "").strip()
            assert novo["status"] == "rascunho"
            client.delete(f"{API}/orcamentos/{novo['id']}")
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_converter_so_depois_de_finalizar_e_aceite(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-conv-fin",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "x", "quantidade": 1}],
        })
        oid = r.json()["id"]
        enc_id = None
        try:
            rc = client.post(f"{API}/orcamentos/{oid}/converter")
            assert rc.status_code == 400
            finalizar_e_aceitar(client, API, oid)
            rc = client.post(f"{API}/orcamentos/{oid}/converter")
            assert rc.status_code == 200, rc.text
            enc = rc.json()
            enc_id = enc.get("id") if not str(enc.get("numero") or "").startswith("OF") else enc.get("encomenda_id")
            assert enc_id
        finally:
            if enc_id:
                client.delete(f"{API}/encomendas/{enc_id}")
            client.delete(f"{API}/orcamentos/{oid}")

    def test_negociar_arquiva_v1_e_abre_v2(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-neg",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "x", "quantidade": 1}],
        })
        oid = r.json()["id"]
        try:
            finalizar_orcamento(client, f"{API}/orcamentos/{oid}/finalizar")
            n = client.post(f"{API}/orcamentos/{oid}/negociar")
            assert n.status_code == 200, n.text
            orc = n.json()
            assert orc["status"] == "negociado"
            assert orc["versao"] == 2
            assert len(orc.get("versoes") or []) == 1
            assert orc["versoes"][0]["versao"] == 1
            n2 = client.post(f"{API}/orcamentos/{oid}/negociar")
            assert n2.status_code == 200, n2.text
            assert n2.json()["versao"] == 3
            assert len(n2.json()["versoes"]) == 2
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_validade_nao_pode_ser_antes_da_data(self, client):
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-datas",
            "data": "2026-08-20",
            "validade": "2026-08-10",
            "linhas": [],
        })
        assert r.status_code == 400

        r = client.post(f"{API}/orcamentos", json={"cliente": "teste-datas", "linhas": []})
        oid = r.json()["id"]
        try:
            ru = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(r.json(), data="2026-08-20", validade="2026-08-10"))
            assert ru.status_code == 400
            assert "validade" in (ru.json().get("detail") or "").lower()
        finally:
            client.delete(f"{API}/orcamentos/{oid}")

    def test_finalizar_data_tem_de_ser_hoje(self, client):
        r = client.post(f"{API}/orcamentos", json={"cliente": "teste-datas-hoje", "linhas": []})
        oid = r.json()["id"]
        try:
            orc = r.json()
            ru = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(orc, data="2020-01-01"))
            assert ru.status_code == 200, ru.text
            rf = client.post(f"{API}/orcamentos/{oid}/finalizar")
            assert rf.status_code == 400
            assert "hoje" in (rf.json().get("detail") or "").lower()

            ru = client.put(f"{API}/orcamentos/{oid}", json=orc_put_body(orc, data="2099-01-01"))
            assert ru.status_code == 200, ru.text
            rf = client.post(f"{API}/orcamentos/{oid}/finalizar")
            assert rf.status_code == 400
            assert "hoje" in (rf.json().get("detail") or "").lower()
        finally:
            client.delete(f"{API}/orcamentos/{oid}")


def _enc_put(enc, **overrides):
    keys = (
        "cliente", "cliente_id", "descricao", "data", "prazo_entrega", "estado",
        "notas", "desconto_total", "desconto_total_tipo", "artigos", "imagens",
        "pagamentos", "valor_total", "valor_total_manual", "valor_pago", "autorizada_producao",
    )
    body = {k: enc[k] for k in keys if k in enc}
    body.update(overrides)
    return body


class TestConverterPrecosNaoDescem:
    def test_converter_guarda_piso_e_permite_aumentar(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-piso-preco",
            "linhas": [{
                "artigo_id": art["id"],
                "artigo_nome": art.get("nome") or "x",
                "quantidade": 2,
                "preco_unit": 10.0,
                "preco_unit_manual": True,
            }],
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        enc_id = None
        try:
            orc = client.get(f"{API}/orcamentos/{oid}").json()
            lid = orc["linhas"][0]["id"]
            piso = float(orc["linhas"][0]["preco_unit"])
            finalizar_e_aceitar(client, API, oid)
            rc = client.post(f"{API}/orcamentos/{oid}/converter", json={"precos": {lid: piso + 3}})
            assert rc.status_code == 200, rc.text
            enc = rc.json()
            enc_id = enc["id"]
            art0 = enc["artigos"][0]
            assert art0["preco_unit_orcamento"] == piso
            assert art0["preco_unit"] == piso + 3
            assert enc.get("valor_orcamento") is not None
            assert abs(enc["valor_total"] - (float(enc["valor_orcamento"]) + 3 * 2)) < 0.02

            enc = client.get(f"{API}/encomendas/{enc_id}").json()
            arts = [{**enc["artigos"][0], "preco_unit": piso - 1}]
            ru = client.put(f"{API}/encomendas/{enc_id}", json=_enc_put(enc, artigos=arts))
            assert ru.status_code == 400, ru.text
            assert "inferior" in (ru.json().get("detail") or "").lower()

            arts = [{**enc["artigos"][0], "preco_unit": piso + 5}]
            ru = client.put(f"{API}/encomendas/{enc_id}", json=_enc_put(enc, artigos=arts))
            assert ru.status_code == 200, ru.text
            assert ru.json()["artigos"][0]["preco_unit"] == piso + 5
        finally:
            if enc_id:
                client.delete(f"{API}/encomendas/{enc_id}")
            client.delete(f"{API}/orcamentos/{oid}")

    def test_converter_rejeita_preco_abaixo_do_orcamento(self, client):
        art = _artigo(client)
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "teste-piso-baixo",
            "linhas": [{
                "artigo_id": art["id"],
                "artigo_nome": art.get("nome") or "x",
                "quantidade": 1,
                "preco_unit": 20.0,
                "preco_unit_manual": True,
            }],
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        try:
            orc = client.get(f"{API}/orcamentos/{oid}").json()
            lid = orc["linhas"][0]["id"]
            piso = float(orc["linhas"][0]["preco_unit"])
            finalizar_e_aceitar(client, API, oid)
            rc = client.post(f"{API}/orcamentos/{oid}/converter", json={"precos": {lid: piso - 0.5}})
            assert rc.status_code == 400, rc.text
            assert "inferior" in (rc.json().get("detail") or "").lower()
        finally:
            client.delete(f"{API}/orcamentos/{oid}")
