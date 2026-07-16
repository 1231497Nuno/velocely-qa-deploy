"""Tests for iteration 27: 'Onde é usado' (utilizacoes) endpoints + OFs faseadas backend basics.

Endpoints under test:
- GET /api/artigos/{aid}/utilizacoes
- GET /api/maquinas/{mid}/utilizacoes
- GET /api/mao-obra/{mid}/utilizacoes
- GET /api/consumiveis/{cid}/utilizacoes
- GET /api/tipos-personalizacao/{tid}/utilizacoes

Auth: 401 sem token; 200 com admin token.
"""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE = get_base_url()
API = f"{BASE}/api"
ADMIN_EMAIL, ADMIN_PASS = get_admin_credentials()


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"login": "admin", "password": ADMIN_PASS}, timeout=30)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}


# --- 401 without auth ---
class TestAuth401:
    def test_artigo_util_needs_auth(self):
        r = requests.get(f"{API}/artigos/xxx/utilizacoes", timeout=15)
        assert r.status_code in (401, 403)

    def test_maquina_util_needs_auth(self):
        r = requests.get(f"{API}/maquinas/xxx/utilizacoes", timeout=15)
        assert r.status_code in (401, 403)

    def test_mao_obra_util_needs_auth(self):
        r = requests.get(f"{API}/mao-obra/xxx/utilizacoes", timeout=15)
        assert r.status_code in (401, 403)

    def test_consumivel_util_needs_auth(self):
        r = requests.get(f"{API}/consumiveis/xxx/utilizacoes", timeout=15)
        assert r.status_code in (401, 403)

    def test_tipo_pers_util_needs_auth(self):
        r = requests.get(f"{API}/tipos-personalizacao/xxx/utilizacoes", timeout=15)
        assert r.status_code in (401, 403)


# --- Shape assertions ---
class TestShapes:
    def test_artigo_utilizacoes_shape(self, H):
        arts = requests.get(f"{API}/artigos", headers=H, timeout=30).json()
        assert isinstance(arts, list) and len(arts) > 0
        aid = arts[0]["id"]
        r = requests.get(f"{API}/artigos/{aid}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) >= {"orcamentos", "encomendas", "ordens_fabrico"}
        for grp in ("orcamentos", "encomendas", "ordens_fabrico"):
            assert isinstance(d[grp], list)
            for it in d[grp]:
                assert "id" in it and "numero" in it

    def test_maquina_utilizacoes_shape(self, H):
        ms = requests.get(f"{API}/maquinas", headers=H, timeout=30).json()
        if not ms:
            pytest.skip("no maquinas")
        r = requests.get(f"{API}/maquinas/{ms[0]['id']}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "artigos" in d and isinstance(d["artigos"], list)

    def test_mao_obra_utilizacoes_shape(self, H):
        ms = requests.get(f"{API}/mao-obra", headers=H, timeout=30).json()
        if not ms:
            pytest.skip("no mao-obra")
        r = requests.get(f"{API}/mao-obra/{ms[0]['id']}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "artigos" in d and isinstance(d["artigos"], list)

    def test_consumivel_utilizacoes_shape(self, H):
        cs = requests.get(f"{API}/consumiveis", headers=H, timeout=30).json()
        if not cs:
            pytest.skip("no consumiveis")
        r = requests.get(f"{API}/consumiveis/{cs[0]['id']}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "artigos" in d and isinstance(d["artigos"], list)

    def test_tipo_pers_utilizacoes_shape(self, H):
        ts = requests.get(f"{API}/tipos-personalizacao", headers=H, timeout=30).json()
        if not ts:
            pytest.skip("no tipos-personalizacao")
        r = requests.get(f"{API}/tipos-personalizacao/{ts[0]['id']}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"orcamentos", "encomendas", "ordens_fabrico"}


# --- Cross-check: pick a real used artigo (from an existing encomenda) and check it appears back ---
class TestReverseCorrectness:
    def test_artigo_used_in_encomenda_appears(self, H):
        encs = requests.get(f"{API}/encomendas", headers=H, timeout=30).json()
        target = None
        for e in encs:
            for a in (e.get("artigos") or []):
                if a.get("artigo_id"):
                    target = (a["artigo_id"], e["id"])
                    break
            if target:
                break
        if not target:
            pytest.skip("no encomenda with artigo_id")
        aid, eid = target
        r = requests.get(f"{API}/artigos/{aid}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        ids = {e["id"] for e in d["encomendas"]}
        assert eid in ids, f"encomenda {eid} deveria aparecer nas utilizacoes de {aid}: got {ids}"

    def test_maquina_used_in_artigo_roteiro(self, H):
        arts = requests.get(f"{API}/artigos", headers=H, timeout=30).json()
        target = None
        for a in arts:
            for op in (a.get("roteiro") or []):
                if op.get("maquina_id"):
                    target = (op["maquina_id"], a["id"])
                    break
            if target:
                break
        if not target:
            pytest.skip("no artigo with maquina_id in roteiro")
        mid, aid = target
        r = requests.get(f"{API}/maquinas/{mid}/utilizacoes", headers=H, timeout=30)
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()["artigos"]}
        assert aid in ids


# --- OFs faseadas: partial creation via POST /encomendas/{id}/ordens-fabrico ---
class TestOFFaseada:
    """Cria uma OF parcial numa encomenda real e depois apaga a OF criada."""

    def test_criar_of_parcial_e_apagar(self, H):
        encs = requests.get(f"{API}/encomendas", headers=H, timeout=30).json()
        # pick encomenda ENC-2026-0046 ("em produção") — fallback: first with artigos
        enc = next((e for e in encs if e.get("numero") == "ENC-2026-0046"), None)
        if not enc:
            enc = next((e for e in encs if (e.get("artigos") or []) and any(a.get("artigo_id") for a in e["artigos"])), None)
        if not enc:
            pytest.skip("no suitable encomenda")

        eid = enc["id"]
        # get full detail
        e_full = requests.get(f"{API}/encomendas/{eid}", headers=H, timeout=30).json()
        arts = [a for a in (e_full.get("artigos") or []) if a.get("artigo_id")]
        assert arts, "encomenda sem artigos com artigo_id"

        # pick first artigo, create OF with quantity 1 only
        a0 = arts[0]
        itens = [{
            "artigo_id": a0["artigo_id"],
            "artigo_nome": a0.get("artigo_nome", ""),
            "imagem": a0.get("imagem", ""),
            "quantidade": 1,
            "personalizacoes": a0.get("personalizacoes") or [],
            "operacoes": [],
        }]
        payload = {"cliente": e_full.get("cliente", ""), "itens": itens, "imagens": e_full.get("imagens") or []}
        r = requests.post(f"{API}/encomendas/{eid}/ordens-fabrico", headers=H, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"create OF failed: {r.status_code} {r.text[:300]}"
        of = r.json()
        of_id = of.get("id")
        assert of_id, f"no OF id: {of}"

        try:
            # Verify OF has only 1 item with qtd 1
            of_full = requests.get(f"{API}/ordens-fabrico/{of_id}", headers=H, timeout=30).json()
            itens_ret = of_full.get("itens") or []
            assert len(itens_ret) == 1
            assert (Number := float(itens_ret[0].get("quantidade") or 0)) == 1.0

            # Verify encomenda now lists this OF
            e2 = requests.get(f"{API}/encomendas/{eid}", headers=H, timeout=30).json()
            of_ids = {o["id"] for o in (e2.get("ordens_fabrico") or [])}
            assert of_id in of_ids
        finally:
            # cleanup: delete the OF created for tests
            r_del = requests.delete(f"{API}/ordens-fabrico/{of_id}", headers=H, timeout=30)
            assert r_del.status_code in (200, 204, 404), f"delete OF failed: {r_del.status_code} {r_del.text[:200]}"

    def test_criar_of_permite_quantidade_maior_que_total(self, H):
        """Utilizador escolheu 'só sugerir, deixar livre'. O backend NÃO deve bloquear qtd > total."""
        encs = requests.get(f"{API}/encomendas", headers=H, timeout=30).json()
        enc = next((e for e in encs if (e.get("artigos") or []) and any(a.get("artigo_id") for a in e["artigos"])), None)
        if not enc:
            pytest.skip("no suitable encomenda")
        eid = enc["id"]
        e_full = requests.get(f"{API}/encomendas/{eid}", headers=H, timeout=30).json()
        a0 = next(a for a in e_full["artigos"] if a.get("artigo_id"))
        # exagerar quantidade
        big = (int(a0.get("quantidade") or 1) * 10) + 999
        payload = {
            "cliente": e_full.get("cliente", ""),
            "itens": [{
                "artigo_id": a0["artigo_id"],
                "artigo_nome": a0.get("artigo_nome", ""),
                "imagem": a0.get("imagem", ""),
                "quantidade": big,
                "personalizacoes": a0.get("personalizacoes") or [],
                "operacoes": [],
            }],
            "imagens": [],
        }
        r = requests.post(f"{API}/encomendas/{eid}/ordens-fabrico", headers=H, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"should allow big qty: {r.status_code} {r.text[:300]}"
        of = r.json()
        of_id = of.get("id")
        # cleanup
        if of_id:
            requests.delete(f"{API}/ordens-fabrico/{of_id}", headers=H, timeout=30)
