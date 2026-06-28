"""
Iteration 11 — PDF Templates, Empresa Settings, e PDF export por módulo
- Login admin
- GET/PUT /api/settings/empresa
- GET /api/pdf-secoes  (3 módulos)
- CRUD /api/pdf-templates (filtro modulo=)
- GET /api/{orcamentos|ordens-fabrico|encomendas}/{id}/pdf (com e sem template_id)
- Permissões: PUT /settings/empresa e POST/PUT/DELETE /pdf-templates exigem admin
"""
import os
import time
import requests
import pytest
from pathlib import Path

def _load_frontend_env_url():
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env_url() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not found"
API = f"{BASE_URL}/api"


def _load_admin_creds():
    """Lê credenciais de teste de variáveis de ambiente ou de /app/memory/test_credentials.md.
    Evita ter o segredo hardcoded no ficheiro de teste."""
    email = os.environ.get("TEST_ADMIN_EMAIL")
    password = os.environ.get("TEST_ADMIN_PASSWORD")
    if email and password:
        return email, password
    e = p = None
    creds = Path("/app/memory/test_credentials.md")
    if creds.exists():
        for line in creds.read_text().splitlines():
            s = line.strip()
            if s.startswith("- Email:") and e is None:
                e = s.split("`")[1] if "`" in s else s.split(":", 1)[1].strip()
            elif s.startswith("- Password:") and p is None:
                p = s.split("`")[1] if "`" in s else s.split(":", 1)[1].strip()
            if e and p:
                break
    return email or e, password or p


ADMIN_EMAIL, ADMIN_PASS = _load_admin_creds()


# ----------------- Fixtures -----------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data.get("token") or data.get("access_token")


@pytest.fixture(scope="session")
def colaborador_creds(admin_token):
    """Cria um utilizador colaborador (teste-) para testar 403 e devolve credenciais."""
    h = {"Authorization": f"Bearer {admin_token}"}
    email = f"teste-colab-it11-{int(time.time())}@example.com"
    password = "Colab123!"
    payload = {"email": email, "password": password, "nome": "teste-Colab It11", "perfil_id": "colaborador"}
    r = requests.post(f"{API}/users", json=payload, headers=h, timeout=15)
    if r.status_code not in (200, 201):
        # fallback: try without perfil_id
        payload.pop("perfil_id", None)
        r = requests.post(f"{API}/users", json=payload, headers=h, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"Não foi possível criar colaborador: {r.status_code} {r.text[:200]}")
    user_id = r.json().get("id")
    # Login as colaborador
    lr = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    token = None
    if lr.status_code == 200:
        token = lr.json().get("token") or lr.json().get("access_token")
    yield {"email": email, "password": password, "token": token, "id": user_id}
    # cleanup
    try:
        requests.delete(f"{API}/users/{user_id}", headers=h, timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ----------------- Empresa Settings -----------------
class TestEmpresaSettings:
    def test_get_empresa(self, auth_headers):
        r = requests.get(f"{API}/settings/empresa", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        # campos esperados existem (podem estar vazios)
        for k in ["nome", "morada", "codigo_postal", "cidade", "nif", "telefone", "email", "rodape"]:
            assert k in d, f"missing key {k}"

    def test_put_empresa_persists(self, auth_headers):
        payload = {
            "nome": "teste-Empresa It11",
            "morada": "Rua dos Testes 11",
            "codigo_postal": "4000-100",
            "cidade": "Porto",
            "pais": "Portugal",
            "nif": "500000011",
            "telefone": "+351 220 000 011",
            "email": "teste-empresa-it11@example.com",
            "website": "https://teste.example.com",
            "logo_base64": "",
            "rodape": "Rodapé teste It11 — IVA incluído à taxa legal",
        }
        r = requests.put(f"{API}/settings/empresa", json=payload, headers=auth_headers, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["nome"] == payload["nome"]
        assert d["rodape"] == payload["rodape"]
        # GET de verificação
        r2 = requests.get(f"{API}/settings/empresa", headers=auth_headers, timeout=10)
        assert r2.status_code == 200
        g = r2.json()
        assert g["nome"] == payload["nome"]
        assert g["nif"] == payload["nif"]
        assert g["rodape"] == payload["rodape"]

    def test_put_empresa_requires_admin(self, colaborador_creds):
        if not colaborador_creds.get("token"):
            pytest.skip("Sem token de colaborador")
        h = {"Authorization": f"Bearer {colaborador_creds['token']}", "Content-Type": "application/json"}
        r = requests.put(f"{API}/settings/empresa", json={"nome": "x"}, headers=h, timeout=10)
        assert r.status_code in (401, 403), f"expected 403 got {r.status_code} {r.text[:200]}"


# ----------------- PDF Secoes -----------------
class TestPdfSecoes:
    def test_get_pdf_secoes_three_modules(self, auth_headers):
        r = requests.get(f"{API}/pdf-secoes", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        for mod in ["orcamento", "of", "encomenda"]:
            assert mod in d, f"missing module {mod}"
            assert isinstance(d[mod], list) and len(d[mod]) > 0
            assert all("key" in s and "label" in s for s in d[mod])
        # encomenda específico
        enc_keys = {s["key"] for s in d["encomenda"]}
        for k in ["dados_cliente", "artigos", "valor_total", "pagamento", "ofs_associadas", "notas"]:
            assert k in enc_keys, f"encomenda missing key {k}"


# ----------------- PDF Templates CRUD -----------------
class TestPdfTemplatesCRUD:
    created_ids = []

    def test_create_templates_three_modules(self, auth_headers):
        for modulo, nome in [
            ("encomenda", "teste-Modelo-Encomenda"),
            ("orcamento", "teste-Modelo-Orcamento"),
            ("of", "teste-Modelo-OF"),
        ]:
            # Use a sample of section keys with one disabled
            r0 = requests.get(f"{API}/pdf-secoes", headers=auth_headers).json()
            campos = {s["key"]: True for s in r0[modulo]}
            # disable last section
            last_key = r0[modulo][-1]["key"]
            campos[last_key] = False
            payload = {
                "nome": nome,
                "modulo": modulo,
                "finalidade": "cliente",
                "mostrar_branding": True,
                "campos": campos,
            }
            r = requests.post(f"{API}/pdf-templates", json=payload, headers=auth_headers, timeout=10)
            assert r.status_code == 200, r.text
            t = r.json()
            assert t["nome"] == nome
            assert t["modulo"] == modulo
            assert t["campos"][last_key] is False
            assert "id" in t
            TestPdfTemplatesCRUD.created_ids.append((modulo, t["id"]))

    def test_list_templates_filter_by_modulo(self, auth_headers):
        r = requests.get(f"{API}/pdf-templates?modulo=encomenda", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for t in items:
            assert t["modulo"] == "encomenda"
        # at least our created one
        ids = [i[1] for i in self.created_ids if i[0] == "encomenda"]
        if ids:
            found = any(t["id"] == ids[0] for t in items)
            assert found, "newly created encomenda template not in list"

    def test_update_template(self, auth_headers):
        if not self.created_ids:
            pytest.skip("no templates created")
        modulo, tid = self.created_ids[0]
        r0 = requests.get(f"{API}/pdf-secoes", headers=auth_headers).json()
        campos = {s["key"]: True for s in r0[modulo]}
        payload = {
            "nome": "teste-Modelo-Encomenda-Edit",
            "modulo": modulo,
            "finalidade": "interno",
            "mostrar_branding": False,
            "campos": campos,
        }
        r = requests.put(f"{API}/pdf-templates/{tid}", json=payload, headers=auth_headers, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["nome"] == "teste-Modelo-Encomenda-Edit"
        assert d["finalidade"] == "interno"
        assert d["mostrar_branding"] is False
        # verify via list
        r2 = requests.get(f"{API}/pdf-templates?modulo={modulo}", headers=auth_headers).json()
        found = next((t for t in r2 if t["id"] == tid), None)
        assert found is not None
        assert found["nome"] == "teste-Modelo-Encomenda-Edit"

    def test_pdf_templates_create_requires_admin(self, colaborador_creds):
        if not colaborador_creds.get("token"):
            pytest.skip("Sem token de colaborador")
        h = {"Authorization": f"Bearer {colaborador_creds['token']}", "Content-Type": "application/json"}
        r = requests.post(f"{API}/pdf-templates", json={"nome": "x", "modulo": "encomenda"}, headers=h, timeout=10)
        assert r.status_code in (401, 403)

    def test_pdf_templates_delete_requires_admin(self, colaborador_creds, auth_headers):
        if not colaborador_creds.get("token"):
            pytest.skip("Sem token de colaborador")
        if not self.created_ids:
            pytest.skip("no templates created")
        _, tid = self.created_ids[0]
        h = {"Authorization": f"Bearer {colaborador_creds['token']}"}
        r = requests.delete(f"{API}/pdf-templates/{tid}", headers=h, timeout=10)
        assert r.status_code in (401, 403)


# ----------------- PDF Export por módulo -----------------
def _create_orcamento(auth_headers):
    payload = {
        "cliente": "teste-Cliente-PDF",
        "data": "2026-01-15",
        "descricao": "Orçamento PDF teste it11",
        "linhas": [],
        "notas": "teste",
    }
    r = requests.post(f"{API}/orcamentos", json=payload, headers=auth_headers, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _create_encomenda(auth_headers):
    payload = {
        "cliente": "teste-Cliente-PDF",
        "data": "2026-01-15",
        "descricao": "Encomenda PDF teste it11",
        "artigos": [{"descricao": "Artigo teste", "quantidade": 2, "preco_unit": 10.0}],
        "valor_total_manual": False,
        "valor_pago": 0,
        "estado": "rascunho",
        "autorizada_producao": False,
        "notas": "teste",
    }
    r = requests.post(f"{API}/encomendas", json=payload, headers=auth_headers, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _create_of(auth_headers):
    # OF mínima
    payload = {
        "cliente": "teste-Cliente-PDF",
        "data": "2026-01-15",
        "descricao": "OF PDF teste it11",
        "operacoes": [],
        "notas": "teste",
    }
    r = requests.post(f"{API}/ordens-fabrico", json=payload, headers=auth_headers, timeout=10)
    if r.status_code not in (200, 201):
        return None
    return r.json()["id"]


class TestPdfExports:
    """PDF endpoints são abertos (sem Bearer). Validar 200 + content-type + magic %PDF."""

    @pytest.fixture(scope="class")
    def orc_id(self, auth_headers):
        oid = _create_orcamento(auth_headers)
        yield oid
        try:
            requests.delete(f"{API}/orcamentos/{oid}", headers=auth_headers, timeout=10)
        except Exception:
            pass

    @pytest.fixture(scope="class")
    def enc_id(self, auth_headers):
        eid = _create_encomenda(auth_headers)
        yield eid
        try:
            requests.delete(f"{API}/encomendas/{eid}", headers=auth_headers, timeout=10)
        except Exception:
            pass

    @pytest.fixture(scope="class")
    def of_id(self, auth_headers):
        oid = _create_of(auth_headers)
        yield oid
        if oid:
            try:
                requests.delete(f"{API}/ordens-fabrico/{oid}", headers=auth_headers, timeout=10)
            except Exception:
                pass

    def _assert_pdf(self, r):
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, f"content-type={ct}"
        assert r.content[:4] == b"%PDF", f"magic bytes: {r.content[:8]!r}"

    def test_orcamento_pdf(self, orc_id):
        r = requests.get(f"{API}/orcamentos/{orc_id}/pdf", timeout=30)
        self._assert_pdf(r)

    def test_encomenda_pdf(self, enc_id):
        r = requests.get(f"{API}/encomendas/{enc_id}/pdf", timeout=30)
        self._assert_pdf(r)

    def test_of_pdf(self, of_id):
        if not of_id:
            pytest.skip("OF não pôde ser criada (provavelmente falta operacoes/materiais)")
        r = requests.get(f"{API}/ordens-fabrico/{of_id}/pdf", timeout=30)
        self._assert_pdf(r)

    def test_encomenda_pdf_with_template_disabling_section(self, enc_id, auth_headers):
        # Create a template that disables ofs_associadas
        r0 = requests.get(f"{API}/pdf-secoes", headers=auth_headers).json()
        campos = {s["key"]: True for s in r0["encomenda"]}
        campos["ofs_associadas"] = False
        tpl = {
            "nome": "teste-Modelo-EncSemOFs",
            "modulo": "encomenda",
            "finalidade": "cliente",
            "mostrar_branding": True,
            "campos": campos,
        }
        rc = requests.post(f"{API}/pdf-templates", json=tpl, headers=auth_headers, timeout=10)
        assert rc.status_code == 200
        tid = rc.json()["id"]
        try:
            r = requests.get(f"{API}/encomendas/{enc_id}/pdf?template_id={tid}", timeout=30)
            self._assert_pdf(r)
        finally:
            requests.delete(f"{API}/pdf-templates/{tid}", headers=auth_headers, timeout=10)

    def test_orcamento_pdf_with_template(self, orc_id, auth_headers):
        r0 = requests.get(f"{API}/pdf-secoes", headers=auth_headers).json()
        campos = {s["key"]: True for s in r0["orcamento"]}
        campos["personalizacoes"] = False
        campos["materiais"] = False
        tpl = {"nome": "teste-Modelo-Orc", "modulo": "orcamento", "finalidade": "cliente", "mostrar_branding": True, "campos": campos}
        rc = requests.post(f"{API}/pdf-templates", json=tpl, headers=auth_headers, timeout=10)
        assert rc.status_code == 200
        tid = rc.json()["id"]
        try:
            r = requests.get(f"{API}/orcamentos/{orc_id}/pdf?template_id={tid}", timeout=30)
            self._assert_pdf(r)
        finally:
            requests.delete(f"{API}/pdf-templates/{tid}", headers=auth_headers, timeout=10)


# ----------------- Cleanup -----------------
def test_zz_cleanup_templates(auth_headers):
    # Cleanup all teste- templates
    for modulo in ["orcamento", "of", "encomenda"]:
        r = requests.get(f"{API}/pdf-templates?modulo={modulo}", headers=auth_headers, timeout=10)
        if r.status_code != 200:
            continue
        for t in r.json():
            if t.get("nome", "").startswith("teste-"):
                requests.delete(f"{API}/pdf-templates/{t['id']}", headers=auth_headers, timeout=10)
