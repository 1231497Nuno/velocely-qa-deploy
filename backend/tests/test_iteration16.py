"""Iteration 16 — Refactor regression tests.

Foco: confirmar que após o refactor (helpers _th_row/_data_table/_totais_table
nos builders de PDF + extração de componentes frontend + correção de useCallback)
não há regressões funcionais nas APIs principais. Os PDFs continuam a gerar e
respondem com %PDF e tamanho razoável.
"""
import requests
import pytest
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in response: {r.json()}"
    return tok


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _is_pdf(content: bytes) -> bool:
    return content[:4] == b"%PDF"


# ---------- PDF generation regression ----------

class TestPDFGeneration:
    def test_orcamento_pdf(self, headers):
        lst = requests.get(f"{BASE_URL}/api/orcamentos", headers=headers, timeout=30)
        assert lst.status_code == 200, lst.text
        items = lst.json()
        if not items:
            pytest.skip("No orcamento available to test PDF")
        oid = items[0]["id"]
        r = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf", headers=headers, timeout=60)
        assert r.status_code == 200, f"PDF orcamento failed: {r.status_code} {r.text[:200]}"
        assert _is_pdf(r.content), "Response is not a PDF (header)"
        assert len(r.content) > 1000, f"PDF too small: {len(r.content)} bytes"

    def test_of_pdf(self, headers):
        lst = requests.get(f"{BASE_URL}/api/ordens-fabrico", headers=headers, timeout=30)
        assert lst.status_code == 200, lst.text
        items = lst.json()
        if not items:
            pytest.skip("No OF available to test PDF")
        oid = items[0]["id"]
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico/{oid}/pdf", headers=headers, timeout=60)
        assert r.status_code == 200, f"PDF OF failed: {r.status_code} {r.text[:200]}"
        assert _is_pdf(r.content)
        assert len(r.content) > 1000

    def test_encomenda_pdf(self, headers):
        lst = requests.get(f"{BASE_URL}/api/encomendas", headers=headers, timeout=30)
        assert lst.status_code == 200, lst.text
        items = lst.json()
        if not items:
            pytest.skip("No encomenda available to test PDF")
        eid = items[0]["id"]
        r = requests.get(f"{BASE_URL}/api/encomendas/{eid}/pdf", headers=headers, timeout=60)
        assert r.status_code == 200, f"PDF encomenda failed: {r.status_code} {r.text[:200]}"
        assert _is_pdf(r.content)
        assert len(r.content) > 1000

    def test_orcamento_pdf_with_template(self, headers):
        # Listar templates de orcamento
        tpls = requests.get(f"{BASE_URL}/api/pdf-templates", headers=headers, timeout=30)
        if tpls.status_code != 200:
            pytest.skip(f"templates-pdf endpoint not OK: {tpls.status_code}")
        items_tpl = tpls.json()
        if not items_tpl:
            pytest.skip("No PDF templates available")
        tpl_orc = next((t for t in items_tpl if t.get("modulo") == "orcamento"), None)
        if not tpl_orc:
            pytest.skip("No orcamento template")
        lst = requests.get(f"{BASE_URL}/api/orcamentos", headers=headers, timeout=30)
        items = lst.json()
        if not items:
            pytest.skip("No orcamento")
        oid = items[0]["id"]
        r = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf?template_id={tpl_orc['id']}", headers=headers, timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert _is_pdf(r.content)


# ---------- Listing endpoints regression (refactor of useCallback) ----------

LIST_ENDPOINTS = [
    "/api/orcamentos",
    "/api/encomendas",
    "/api/ordens-fabrico",
    "/api/clientes",
    "/api/maquinas",
    "/api/consumiveis",
    "/api/artigos",
    "/api/mao-obra",
    "/api/tipos-personalizacao",
    "/api/prazos",
    "/api/dashboard",
]


@pytest.mark.parametrize("ep", LIST_ENDPOINTS)
def test_list_endpoint_ok(ep, headers):
    r = requests.get(f"{BASE_URL}{ep}", headers=headers, timeout=30)
    assert r.status_code == 200, f"{ep} failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    # dashboard returns object; lista returns list
    if ep == "/api/dashboard":
        assert isinstance(body, dict)
        # Spot-check some KPIs and the prazos counters
        for k in ["prazos_atrasadas", "prazos_proximos_7"]:
            assert k in body, f"missing dashboard key {k}"
    else:
        assert isinstance(body, list)


# ---------- Artigos CRUD (test data prefixed 'teste-it16-') ----------

class TestArtigoCRUD:
    def test_create_update_delete_artigo(self, headers):
        # Buscar 1 material e 1 mao-obra reais para usar na composição
        mats = requests.get(f"{BASE_URL}/api/consumiveis", headers=headers, timeout=30).json()
        mos = requests.get(f"{BASE_URL}/api/mao-obra", headers=headers, timeout=30).json()
        if not mats or not mos:
            pytest.skip("Need at least 1 consumivel e 1 mao-obra")

        material = mats[0]
        mo = mos[0]

        payload = {
            "nome": "teste-it16-artigo",
            "descricao": "teste-it16-ref",
            "margem": 30,
            "materiais": [{"material_id": material["id"], "material_nome": material["nome"], "quantidade": 1, "unidade": material.get("unidade", "un"), "custo_unitario": material.get("custo_unitario", 1)}],
            "roteiro": [{"nome": "Op1", "mao_obra_id": mo["id"], "mao_obra_nome": mo.get("nome"), "tempo_mao_obra": 10}],
        }
        r = requests.post(f"{BASE_URL}/api/artigos", headers=headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"Create artigo failed: {r.status_code} {r.text[:300]}"
        created = r.json()
        art_id = created["id"]
        try:
            # GET single
            r2 = requests.get(f"{BASE_URL}/api/artigos/{art_id}", headers=headers, timeout=30)
            assert r2.status_code == 200
            fetched = r2.json()
            assert fetched["nome"] == "teste-it16-artigo"
            # Update
            fetched["nome"] = "teste-it16-artigo-updated"
            r3 = requests.put(f"{BASE_URL}/api/artigos/{art_id}", headers=headers, json=fetched, timeout=30)
            assert r3.status_code == 200, r3.text[:300]
            assert r3.json()["nome"] == "teste-it16-artigo-updated"
        finally:
            rd = requests.delete(f"{BASE_URL}/api/artigos/{art_id}", headers=headers, timeout=30)
            assert rd.status_code in (200, 204), f"Cleanup failed: {rd.status_code} {rd.text[:200]}"


# ---------- Orcamento CRUD (test data prefixed 'teste-it16-') ----------

class TestOrcamentoCRUD:
    def test_create_compute_delete_orcamento(self, headers):
        clientes = requests.get(f"{BASE_URL}/api/clientes", headers=headers, timeout=30).json()
        artigos = requests.get(f"{BASE_URL}/api/artigos", headers=headers, timeout=30).json()
        mats = requests.get(f"{BASE_URL}/api/consumiveis", headers=headers, timeout=30).json()
        if not clientes or not artigos:
            pytest.skip("Need cliente + artigo")
        cli = clientes[0]
        art = artigos[0]
        material = mats[0] if mats else None

        linha = {
            "artigo_id": art["id"],
            "artigo_nome": art.get("nome"),
            "quantidade": 2,
            "personalizacoes": [],
        }
        payload = {
            "cliente": cli.get("nome") or "teste-it16-cliente",
            "cliente_id": cli["id"],
            "descricao": "teste-it16-orc",
            "linhas": [linha],
            "materiais": [],
        }
        if material:
            payload["materiais"] = [{
                "consumivel_id": material["id"],
                "nome": material["nome"],
                "quantidade": 1,
                "unidade": material.get("unidade", "un"),
                "custo_unitario": material.get("custo_unitario", 1),
                "margem": 30,
            }]

        r = requests.post(f"{BASE_URL}/api/orcamentos", headers=headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"Create orcamento failed: {r.status_code} {r.text[:300]}"
        orc = r.json()
        oid = orc["id"]
        try:
            r2 = requests.get(f"{BASE_URL}/api/orcamentos/{oid}", headers=headers, timeout=30)
            assert r2.status_code == 200
            fetched = r2.json()
            assert fetched["id"] == oid
            # PDF deste orc deve gerar
            rp = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf", headers=headers, timeout=60)
            assert rp.status_code == 200
            assert _is_pdf(rp.content)
        finally:
            rd = requests.delete(f"{BASE_URL}/api/orcamentos/{oid}", headers=headers, timeout=30)
            assert rd.status_code in (200, 204), f"Cleanup orc failed: {rd.status_code} {rd.text[:200]}"
