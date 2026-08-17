"""Testes de upload de imagem por artigo (Orçamentos, Encomendas, OFs).
Cobre: /api/upload/imagem (auth, tamanho, formato), /api/files/{path} (auth via header/query),
auto-preenchimento catálogo→linha em orçamentos, override,
propagação orçamento→OF+encomenda, propagação encomenda→OF, build_of_itens auto imagem.
"""
import pytest
import requests
import struct
import zlib
from conftest import get_base_url, get_admin_credentials, finalizar_e_aceitar

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"

ADMIN_LOGIN = "admin"
_, ADMIN_PASSWORD = get_admin_credentials()


def _png_bytes(w=2, h=2):
    """Build a valid tiny PNG image (RGBA)."""
    def chunk(tag, data):
        cbytes = tag + data
        return struct.pack(">I", len(data)) + cbytes + struct.pack(">I", zlib.crc32(cbytes) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8bit RGBA
    # scanlines: filter byte 0 + 4 bytes per pixel
    raw = b""
    for _ in range(h):
        raw += b"\x00" + (b"\xff\x00\x00\xff" * w)
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def created_ids():
    return {"artigos": [], "orcamentos": [], "encomendas": [], "ordens": []}


@pytest.fixture(scope="session", autouse=True)
def _cleanup(token, created_ids):
    yield
    h = {"Authorization": f"Bearer {token}"}
    for oid in created_ids["ordens"]:
        try: requests.delete(f"{API}/ordens-fabrico/{oid}", headers=h, timeout=10)
        except Exception: pass
    for eid in created_ids["encomendas"]:
        try: requests.delete(f"{API}/encomendas/{eid}", headers=h, timeout=10)
        except Exception: pass
    for oid in created_ids["orcamentos"]:
        try: requests.delete(f"{API}/orcamentos/{oid}", headers=h, timeout=10)
        except Exception: pass
    for aid in created_ids["artigos"]:
        try: requests.delete(f"{API}/artigos/{aid}", headers=h, timeout=10)
        except Exception: pass


# ---------- Upload endpoint ----------
class TestUpload:
    def test_upload_requires_auth(self):
        png = _png_bytes()
        r = requests.post(f"{API}/upload/imagem", files={"file": ("a.png", png, "image/png")}, timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_upload_png_ok(self, auth_headers):
        png = _png_bytes()
        r = requests.post(f"{API}/upload/imagem", files={"file": ("teste.png", png, "image/png")},
                          headers=auth_headers, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "path" in data
        assert isinstance(data["path"], str) and len(data["path"]) > 0
        assert data["path"].endswith(".png")

    def test_upload_rejects_txt(self, auth_headers):
        r = requests.post(f"{API}/upload/imagem",
                          files={"file": ("teste.txt", b"hello world", "text/plain")},
                          headers=auth_headers, timeout=30)
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"

    def test_upload_rejects_large_file(self, auth_headers):
        big = b"x" * (5 * 1024 * 1024 + 10)  # >5MB
        r = requests.post(f"{API}/upload/imagem",
                          files={"file": ("big.png", big, "image/png")},
                          headers=auth_headers, timeout=120)
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"


# ---------- Download endpoint ----------
class TestDownload:
    @pytest.fixture(scope="class")
    def uploaded_path(self, token):
        png = _png_bytes()
        r = requests.post(f"{API}/upload/imagem", files={"file": ("dl.png", png, "image/png")},
                          headers={"Authorization": f"Bearer {token}"}, timeout=60)
        assert r.status_code == 200
        return r.json()["path"]

    def test_download_without_auth_returns_401(self, uploaded_path):
        r = requests.get(f"{API}/files/{uploaded_path}", timeout=30)
        assert r.status_code == 401

    def test_download_with_header_auth(self, uploaded_path, auth_headers):
        r = requests.get(f"{API}/files/{uploaded_path}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) > 0

    def test_download_with_query_auth(self, uploaded_path, token):
        r = requests.get(f"{API}/files/{uploaded_path}?auth={token}", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) > 0


# ---------- Auto-fill catálogo → linha orçamento ----------
class TestAutoFillOrcamento:
    def test_autofill_from_artigo(self, auth_headers, token, created_ids):
        # upload
        png = _png_bytes()
        up = requests.post(f"{API}/upload/imagem", files={"file": ("cat.png", png, "image/png")},
                           headers=auth_headers, timeout=60)
        assert up.status_code == 200
        path = up.json()["path"]

        # criar artigo com imagem
        art = requests.post(f"{API}/artigos", json={
            "nome": "teste-artigo-img", "descricao": "teste", "unidade": "un",
            "imagem": path, "custo_artigo": 5.0, "margem": 30.0,
            "materiais": [], "roteiro": [],
        }, headers=auth_headers, timeout=15)
        assert art.status_code == 200, art.text
        art_data = art.json()
        assert art_data.get("imagem") == path
        artigo_id = art_data["id"]
        created_ids["artigos"].append(artigo_id)

        # criar orçamento com linha SEM imagem
        orc = requests.post(f"{API}/orcamentos", json={
            "cliente": "teste-cliente", "descricao": "teste-orc",
            "linhas": [{"artigo_id": artigo_id, "quantidade": 2}],
        }, headers=auth_headers, timeout=15)
        assert orc.status_code == 200, orc.text
        orc_id = orc.json()["id"]
        created_ids["orcamentos"].append(orc_id)

        # GET orçamento verifica auto-preenchimento
        g = requests.get(f"{API}/orcamentos/{orc_id}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        linhas = g.json().get("linhas", [])
        assert len(linhas) == 1
        assert linhas[0].get("imagem") == path, f"Imagem não auto-preenchida. linha={linhas[0]}"

    def test_override_preserves_line_imagem(self, auth_headers, created_ids):
        # upload duas imagens diferentes
        p1 = requests.post(f"{API}/upload/imagem",
                           files={"file": ("cat2.png", _png_bytes(), "image/png")},
                           headers=auth_headers, timeout=60).json()["path"]
        p2 = requests.post(f"{API}/upload/imagem",
                           files={"file": ("line.png", _png_bytes(3, 3), "image/png")},
                           headers=auth_headers, timeout=60).json()["path"]

        art = requests.post(f"{API}/artigos", json={
            "nome": "teste-art-override", "imagem": p1, "custo_artigo": 3.0,
        }, headers=auth_headers, timeout=15).json()
        created_ids["artigos"].append(art["id"])

        orc = requests.post(f"{API}/orcamentos", json={
            "cliente": "teste-cliente-ovr",
            "linhas": [{"artigo_id": art["id"], "quantidade": 1, "imagem": p2}],
        }, headers=auth_headers, timeout=15)
        assert orc.status_code == 200
        orc_id = orc.json()["id"]
        created_ids["orcamentos"].append(orc_id)

        g = requests.get(f"{API}/orcamentos/{orc_id}", headers=auth_headers, timeout=15).json()
        assert g["linhas"][0]["imagem"] == p2, "Override não respeitado"


# ---------- Propagação orçamento → OF + encomenda ----------
class TestPropagacaoConverter:
    def test_converter_propaga_imagem(self, auth_headers, created_ids):
        path = requests.post(f"{API}/upload/imagem",
                             files={"file": ("prop.png", _png_bytes(), "image/png")},
                             headers=auth_headers, timeout=60).json()["path"]
        art = requests.post(f"{API}/artigos", json={
            "nome": "teste-art-prop", "imagem": path, "custo_artigo": 4.0,
        }, headers=auth_headers, timeout=15).json()
        created_ids["artigos"].append(art["id"])

        orc = requests.post(f"{API}/orcamentos", json={
            "cliente": "teste-cli-prop",
            "status": "aceite",
            "linhas": [{"artigo_id": art["id"], "quantidade": 2}],
        }, headers=auth_headers, timeout=15).json()
        created_ids["orcamentos"].append(orc["id"])

        finalizar_e_aceitar(requests, API, orc["id"], headers=auth_headers, timeout=15)

        of = requests.post(f"{API}/orcamentos/{orc['id']}/converter",
                           headers=auth_headers, timeout=30)
        assert of.status_code == 200, of.text
        of_data = of.json()
        created_ids["ordens"].append(of_data["id"])
        # itens da OF
        assert of_data["itens"][0].get("imagem") == path, f"OF item sem imagem: {of_data['itens'][0]}"

        # encomenda gerada
        assert of_data.get("encomenda_id")
        enc = requests.get(f"{API}/encomendas/{of_data['encomenda_id']}",
                           headers=auth_headers, timeout=15).json()
        created_ids["encomendas"].append(enc["id"])
        assert enc["artigos"][0].get("imagem") == path, f"Encomenda artigo sem imagem: {enc['artigos'][0]}"


# ---------- Propagação Encomenda → OF ----------
class TestPropagacaoEncomendaOF:
    def test_build_of_itens_autofill(self, auth_headers, created_ids):
        path = requests.post(f"{API}/upload/imagem",
                             files={"file": ("enc.png", _png_bytes(), "image/png")},
                             headers=auth_headers, timeout=60).json()["path"]
        art = requests.post(f"{API}/artigos", json={
            "nome": "teste-art-enc", "imagem": path, "custo_artigo": 2.5,
        }, headers=auth_headers, timeout=15).json()
        created_ids["artigos"].append(art["id"])

        # encomenda direta
        enc = requests.post(f"{API}/encomendas", json={
            "cliente": "teste-cli-enc",
            "artigos": [{"artigo_id": art["id"], "artigo_nome": art["nome"],
                         "quantidade": 1, "preco_unit": 10.0}],
        }, headers=auth_headers, timeout=15).json()
        created_ids["encomendas"].append(enc["id"])

        # OF a partir de encomenda: item COM imagem explícita
        of1 = requests.post(f"{API}/encomendas/{enc['id']}/ordens-fabrico", json={
            "cliente": enc["cliente"],
            "itens": [{"artigo_id": art["id"], "quantidade": 1, "imagem": path}],
        }, headers=auth_headers, timeout=15)
        assert of1.status_code == 200, of1.text
        of1d = of1.json()
        created_ids["ordens"].append(of1d["id"])
        assert of1d["itens"][0].get("imagem") == path

        # OF a partir de encomenda: item SEM imagem → deve auto-preencher do catálogo
        of2 = requests.post(f"{API}/encomendas/{enc['id']}/ordens-fabrico", json={
            "cliente": enc["cliente"],
            "itens": [{"artigo_id": art["id"], "quantidade": 1}],
        }, headers=auth_headers, timeout=15)
        assert of2.status_code == 200, of2.text
        of2d = of2.json()
        created_ids["ordens"].append(of2d["id"])
        assert of2d["itens"][0].get("imagem") == path, \
            f"build_of_itens não auto-preencheu do catálogo: {of2d['itens'][0]}"
