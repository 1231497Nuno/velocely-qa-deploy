"""Iteration 13 tests:
- OF: multiple personalizacoes persistence on POST/PUT
- PDF sections endpoint: dados_cliente subcampos + orcamento_origem on OF/Encomenda
- PDF generation with cliente field selection + cross-data (orcamento de origem)
- PDF templates can be created/loaded with new subfields
"""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")


def _load_admin_creds():
    email = os.environ.get("TEST_ADMIN_EMAIL")
    pwd = os.environ.get("TEST_ADMIN_PASSWORD")
    if email and pwd:
        return email, pwd
    try:
        txt = open("/app/memory/test_credentials.md").read()
        m_e = re.search(r"Email:\s*`([^`]+)`", txt)
        m_p = re.search(r"Password:\s*`([^`]+)`", txt)
        if m_e and m_p:
            return m_e.group(1), m_p.group(1)
    except Exception:
        pass
    raise RuntimeError("Credenciais de teste em falta: defina TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD ou /app/memory/test_credentials.md")


@pytest.fixture(scope="module")
def auth():
    email, pwd = _load_admin_creds()
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


# ---------- PDF SECOES ----------
class TestPdfSecoes:
    def test_pdf_secoes_has_cliente_subfields_and_orcamento_origem(self, auth):
        r = requests.get(f"{BASE_URL}/api/pdf-secoes", headers=auth, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for mod in ("orcamento", "of", "encomenda"):
            assert mod in data
            secs = data[mod]
            dados = next((s for s in secs if s["key"] == "dados_cliente"), None)
            assert dados is not None, f"dados_cliente missing in {mod}"
            assert "campos" in dados, f"campos missing in dados_cliente for {mod}"
            keys = {c["key"] for c in dados["campos"]}
            expected = {"cliente_nome", "cliente_nif", "cliente_morada", "cliente_codigo_postal",
                        "cliente_cidade", "cliente_pais", "cliente_telefone", "cliente_email"}
            assert expected.issubset(keys), f"missing client subfields in {mod}: {expected - keys}"
        # orcamento_origem only in OF + Encomenda
        for mod in ("of", "encomenda"):
            secs = data[mod]
            keys = {s["key"] for s in secs}
            assert "orcamento_origem" in keys, f"orcamento_origem missing in {mod}"
        # NOT in orcamento
        keys_orc = {s["key"] for s in data["orcamento"]}
        assert "orcamento_origem" not in keys_orc


# ---------- OF múltiplas personalizações ----------
class TestOfMultiplasPersonalizacoes:
    @pytest.fixture(scope="class")
    def created_ids(self):
        return {"of": None, "tps": []}

    def test_get_existing_tipos_personalizacao(self, auth, created_ids):
        r = requests.get(f"{BASE_URL}/api/tipos-personalizacao", headers=auth, timeout=30)
        assert r.status_code == 200
        tps = r.json()
        assert len(tps) >= 2, "need at least 2 tipos-personalizacao"
        created_ids["tps"] = tps[:2]
        # also fetch an artigo
        ar = requests.get(f"{BASE_URL}/api/artigos", headers=auth, timeout=30)
        assert ar.status_code == 200 and ar.json(), "need at least 1 artigo"
        created_ids["artigo"] = ar.json()[0]

    def test_create_of_with_two_personalizacoes(self, auth, created_ids):
        tps = created_ids["tps"]
        artigo = created_ids["artigo"]
        p1 = {"id": tps[0]["id"], "nome": tps[0]["nome"]}
        p2 = {"id": tps[1]["id"], "nome": tps[1]["nome"]}
        payload = {
            "cliente": "teste-cli-iter13",
            "descricao": "teste-OF iteration 13",
            "data": "2026-01-15",
            "status": "pendente",
            "itens": [
                {
                    "artigo_id": artigo["id"],
                    "artigo_nome": artigo.get("nome", "teste-artigo"),
                    "quantidade": 1,
                    "personalizacoes": [p1, p2],
                    "operacoes": [],
                }
            ],
        }
        r = requests.post(f"{BASE_URL}/api/ordens-fabrico", headers=auth, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        created_ids["of"] = data.get("id")
        assert created_ids["of"]
        itens = data.get("itens", [])
        assert len(itens) == 1
        pers = itens[0].get("personalizacoes") or []
        assert len(pers) == 2, f"expected 2 pers, got {len(pers)}: {pers}"
        names = {p.get("nome") for p in pers}
        assert names == {tps[0]["nome"], tps[1]["nome"]}

    def test_get_of_persists_two_personalizacoes(self, auth, created_ids):
        of_id = created_ids["of"]
        assert of_id
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico/{of_id}", headers=auth, timeout=30)
        assert r.status_code == 200
        data = r.json()
        pers = data["itens"][0].get("personalizacoes") or []
        assert len(pers) == 2

    def test_put_of_keeps_multiple_personalizacoes(self, auth, created_ids):
        of_id = created_ids["of"]
        assert of_id
        # fetch and re-PUT
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico/{of_id}", headers=auth, timeout=30)
        of = r.json()
        # Build update payload
        upd = {
            "cliente": of.get("cliente") or "teste-cli-iter13",
            "descricao": of.get("descricao", ""),
            "data": of.get("data") or "2026-01-15",
            "status": of.get("status") or "pendente",
            "itens": [
                {
                    "artigo_id": of["itens"][0].get("artigo_id"),
                    "artigo_nome": of["itens"][0].get("artigo_nome"),
                    "quantidade": of["itens"][0].get("quantidade", 1),
                    "personalizacoes": of["itens"][0].get("personalizacoes", []),
                    "operacoes": of["itens"][0].get("operacoes", []),
                }
            ],
        }
        r2 = requests.put(f"{BASE_URL}/api/ordens-fabrico/{of_id}", headers=auth, json=upd, timeout=30)
        assert r2.status_code == 200, f"{r2.status_code} {r2.text}"
        data = r2.json()
        pers = data["itens"][0].get("personalizacoes") or []
        assert len(pers) == 2

    def test_cleanup_of(self, auth, created_ids):
        of_id = created_ids["of"]
        if of_id:
            r = requests.delete(f"{BASE_URL}/api/ordens-fabrico/{of_id}", headers=auth, timeout=30)
            assert r.status_code in (200, 204), r.text


# ---------- PDF templates with client subfields ----------
class TestPdfTemplatesClienteSubfields:
    @pytest.fixture(scope="class")
    def tpl_id(self):
        return {"id": None}

    def test_create_template_with_subset_cliente_fields(self, auth, tpl_id):
        payload = {
            "nome": "teste-tpl-iter13-of",
            "modulo": "of",
            "campos": {
                "dados_cliente": True,
                "cliente_nome": True,
                "cliente_nif": True,
                "cliente_morada": False,
                "cliente_codigo_postal": False,
                "cliente_cidade": False,
                "cliente_pais": False,
                "cliente_telefone": False,
                "cliente_email": False,
                "datas_estado": True,
                "orcamento_origem": True,
                "roteiro_operacoes": True,
                "tempos": True,
                "notas": False,
            },
        }
        r = requests.post(f"{BASE_URL}/api/pdf-templates", headers=auth, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        d = r.json()
        tpl_id["id"] = d.get("id")
        assert tpl_id["id"]
        # verify subset persisted
        cf = d.get("campos") or {}
        assert cf.get("cliente_nome") is True
        assert cf.get("cliente_nif") is True
        assert cf.get("cliente_morada") is False
        assert cf.get("orcamento_origem") is True

    def test_get_template_persists_subfields(self, auth, tpl_id):
        r = requests.get(f"{BASE_URL}/api/pdf-templates?modulo=of", headers=auth, timeout=30)
        assert r.status_code == 200
        tpls = r.json()
        match = next((t for t in tpls if t["id"] == tpl_id["id"]), None)
        assert match is not None
        cf = match.get("campos") or {}
        assert cf.get("cliente_nome") is True
        assert cf.get("cliente_morada") is False

    def test_cleanup_template(self, auth, tpl_id):
        if tpl_id["id"]:
            r = requests.delete(f"{BASE_URL}/api/pdf-templates/{tpl_id['id']}", headers=auth, timeout=30)
            assert r.status_code in (200, 204)


# ---------- PDF generation: completo vs template ----------
class TestPdfGenerationModules:
    """Verify PDF endpoints return 200 application/pdf both for 'completo' and with template."""

    @pytest.fixture(scope="class")
    def sample_ids(self, auth):
        ids = {}
        # Orçamento
        r = requests.get(f"{BASE_URL}/api/orcamentos", headers=auth, timeout=30)
        if r.status_code == 200 and r.json():
            ids["orc"] = r.json()[0]["id"]
        # OF
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico", headers=auth, timeout=30)
        if r.status_code == 200 and r.json():
            ids["of"] = r.json()[0]["id"]
        # Encomenda
        r = requests.get(f"{BASE_URL}/api/encomendas", headers=auth, timeout=30)
        if r.status_code == 200 and r.json():
            ids["enc"] = r.json()[0]["id"]
        return ids

    @pytest.fixture(scope="class")
    def tpls(self, auth):
        out = {}
        # create OF template with only 2 client fields + orcamento_origem
        for modulo, key in (("orcamento", "orc"), ("of", "of"), ("encomenda", "enc")):
            campos = {
                "dados_cliente": True,
                "cliente_nome": True,
                "cliente_nif": True,
                "cliente_morada": False,
                "cliente_codigo_postal": False,
                "cliente_cidade": False,
                "cliente_pais": False,
                "cliente_telefone": False,
                "cliente_email": False,
            }
            if modulo in ("of", "encomenda"):
                campos["orcamento_origem"] = True
            r = requests.post(f"{BASE_URL}/api/pdf-templates", headers=auth,
                              json={"nome": f"teste-tpl-iter13-{modulo}", "modulo": modulo, "campos": campos}, timeout=30)
            assert r.status_code in (200, 201)
            out[key] = r.json()["id"]
        yield out
        # cleanup
        for tid in out.values():
            requests.delete(f"{BASE_URL}/api/pdf-templates/{tid}", headers=auth, timeout=30)

    def _check_pdf(self, r):
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert "pdf" in ctype.lower(), f"not pdf: {ctype}"
        assert r.content[:4] == b"%PDF", f"missing PDF magic: {r.content[:20]}"
        return len(r.content)

    def test_orcamento_pdf_completo_and_template(self, sample_ids, tpls):
        oid = sample_ids.get("orc")
        if not oid:
            pytest.skip("no orcamento")
        r1 = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf", timeout=60)
        s1 = self._check_pdf(r1)
        r2 = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf?template_id={tpls['orc']}", timeout=60)
        s2 = self._check_pdf(r2)
        # template should be smaller or equal — but at minimum both must be valid PDFs
        print(f"orcamento completo={s1}B tpl={s2}B")

    def test_of_pdf_completo_and_template(self, sample_ids, tpls):
        oid = sample_ids.get("of")
        if not oid:
            pytest.skip("no of")
        r1 = requests.get(f"{BASE_URL}/api/ordens-fabrico/{oid}/pdf", timeout=60)
        s1 = self._check_pdf(r1)
        r2 = requests.get(f"{BASE_URL}/api/ordens-fabrico/{oid}/pdf?template_id={tpls['of']}", timeout=60)
        s2 = self._check_pdf(r2)
        print(f"of completo={s1}B tpl={s2}B")

    def test_encomenda_pdf_completo_and_template(self, sample_ids, tpls):
        eid = sample_ids.get("enc")
        if not eid:
            pytest.skip("no encomenda")
        r1 = requests.get(f"{BASE_URL}/api/encomendas/{eid}/pdf", timeout=60)
        s1 = self._check_pdf(r1)
        r2 = requests.get(f"{BASE_URL}/api/encomendas/{eid}/pdf?template_id={tpls['enc']}", timeout=60)
        s2 = self._check_pdf(r2)
        print(f"encomenda completo={s1}B tpl={s2}B")
