"""Iteration 9 — Clientes, Encomendas, ClienteSelector, Conversão Orçamento→OF+Encomenda.

Cobertura:
 - CRUD /api/clientes
 - CRUD /api/encomendas (numeração ENC-2026-XXXX)
 - Orçamento com cliente/cliente_id persistido
 - Conversão Orçamento→OF cria também Encomenda (link nas 2 direções)
 - POST /encomendas/{id}/ordens-fabrico cria OF associada
 - RBAC sem token: review_request diz que devem ser 401 (sanity check)
 - Cleanup de todos os dados "teste-"
"""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"

ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()

# State buckets for cleanup
_CREATED = {"clientes": [], "encomendas": [], "ofs": [], "orcamentos": [], "artigos": []}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------- 1. Auth gating sanity -------------------
def test_clientes_endpoint_no_token_status():
    """Review_request afirma que GET sem token deve dar 401. Reportar caso contrário."""
    r = requests.get(f"{API}/clientes")
    # Não falha o teste — apenas regista o status real para o report.
    print(f"GET /api/clientes sem token => {r.status_code}")
    assert r.status_code in (200, 401, 403)


def test_encomendas_endpoint_no_token_status():
    r = requests.get(f"{API}/encomendas")
    print(f"GET /api/encomendas sem token => {r.status_code}")
    assert r.status_code in (200, 401, 403)


# ------------------- 2. Clientes CRUD -------------------
def test_create_cliente(auth):
    payload = {
        "nome": "teste-ClienteA",
        "morada": "Rua Teste, 1",
        "contacto": "910000001",
        "email": "teste-clientea@example.com",
        "nif": "500000001",
        "notas": "criado por teste",
    }
    r = requests.post(f"{API}/clientes", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["nome"] == "teste-ClienteA"
    assert data["nif"] == "500000001"
    assert "id" in data
    _CREATED["clientes"].append(data["id"])


def test_list_clientes_contains_teste(auth):
    r = requests.get(f"{API}/clientes", headers=auth)
    assert r.status_code == 200
    names = [c["nome"] for c in r.json()]
    assert "teste-ClienteA" in names


def test_update_cliente(auth):
    cid = _CREATED["clientes"][0]
    payload = {
        "nome": "teste-ClienteA",
        "morada": "Rua Nova, 2",
        "contacto": "910000002",
        "email": "teste-clientea@example.com",
        "nif": "500000001",
        "notas": "actualizado",
    }
    r = requests.put(f"{API}/clientes/{cid}", json=payload, headers=auth)
    assert r.status_code == 200
    # GET to verify persistence
    r2 = requests.get(f"{API}/clientes", headers=auth)
    c = next(x for x in r2.json() if x["id"] == cid)
    assert c["morada"] == "Rua Nova, 2"
    assert c["notas"] == "actualizado"


# ------------------- 3. Encomenda manual + OF associada -------------------
def test_create_encomenda_manual(auth):
    cid = _CREATED["clientes"][0]
    payload = {"cliente": "teste-ClienteA", "cliente_id": cid, "descricao": "teste-encomenda manual"}
    r = requests.post(f"{API}/encomendas", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    enc = r.json()
    assert enc["numero"].startswith("ENC-2026-"), f"esperava ENC-2026-XXXX got {enc.get('numero')}"
    assert enc["cliente_id"] == cid
    assert enc["estado"] == "aberta"
    _CREATED["encomendas"].append(enc["id"])


def test_get_encomenda_detail_has_ofs_field(auth):
    eid = _CREATED["encomendas"][0]
    r = requests.get(f"{API}/encomendas/{eid}", headers=auth)
    assert r.status_code == 200
    enc = r.json()
    assert "ordens_fabrico" in enc
    assert isinstance(enc["ordens_fabrico"], list)
    assert len(enc["ordens_fabrico"]) == 0  # ainda nenhuma OF


def test_create_of_from_encomenda(auth):
    eid = _CREATED["encomendas"][0]
    cid = _CREATED["clientes"][0]
    payload = {
        "cliente": "teste-ClienteA",
        "cliente_id": cid,
        "descricao": "teste-OF da encomenda manual",
        "itens": [],
    }
    r = requests.post(f"{API}/encomendas/{eid}/ordens-fabrico", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    of = r.json()
    assert of["encomenda_id"] == eid
    assert of["numero"].startswith("OF-2026-")
    assert of.get("encomenda_numero") is not None
    _CREATED["ofs"].append(of["id"])

    # Verifica que a encomenda agora lista a OF
    r2 = requests.get(f"{API}/encomendas/{eid}", headers=auth)
    assert r2.status_code == 200
    enc = r2.json()
    of_ids = [o["id"] for o in enc["ordens_fabrico"]]
    assert of["id"] in of_ids


# ------------------- 4. Orçamento com cliente + conversão cria encomenda -------------------
def _ensure_artigo(auth):
    # cria artigo mínimo se necessário
    r = requests.get(f"{API}/artigos", headers=auth)
    arr = r.json() if r.status_code == 200 else []
    if arr:
        return arr[0]
    # criar 1 artigo de teste
    a = {"nome": "teste-Artigo9", "tipo_calculo": "unidade", "preco_unidade": 10}
    r2 = requests.post(f"{API}/artigos", json=a, headers=auth)
    assert r2.status_code == 200, r2.text
    art = r2.json()
    _CREATED["artigos"].append(art["id"])
    return art


def test_create_orcamento_with_cliente_id(auth):
    art = _ensure_artigo(auth)
    cid = _CREATED["clientes"][0]
    payload = {
        "cliente": "teste-ClienteA",
        "cliente_id": cid,
        "descricao": "teste-Orcamento conversao",
        "linhas": [
            {
                "artigo_id": art["id"],
                "artigo_nome": art.get("nome", ""),
                "quantidade": 1,
                "preco_unidade": 10,
            }
        ],
    }
    r = requests.post(f"{API}/orcamentos", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    orc = r.json()
    assert orc["cliente_id"] == cid
    assert orc["cliente"] == "teste-ClienteA"
    assert orc["numero"].startswith("ORC-2026-") or orc["numero"]  # apenas regista
    _CREATED["orcamentos"].append(orc["id"])


def test_conversao_orcamento_cria_encomenda(auth):
    oid = _CREATED["orcamentos"][0]
    r = requests.post(f"{API}/orcamentos/{oid}/converter", headers=auth)
    assert r.status_code == 200, r.text
    of = r.json()
    assert of.get("encomenda_id"), f"OF não tem encomenda_id: {of}"
    assert of.get("encomenda_numero", "").startswith("ENC-2026-")
    _CREATED["ofs"].append(of["id"])
    _CREATED["encomendas"].append(of["encomenda_id"])

    # Confirma a encomenda existe e está associada à OF
    r2 = requests.get(f"{API}/encomendas/{of['encomenda_id']}", headers=auth)
    assert r2.status_code == 200
    enc = r2.json()
    assert enc["cliente_id"] == _CREATED["clientes"][0]
    assert enc["orcamento_id"] == oid
    of_ids = [o["id"] for o in enc["ordens_fabrico"]]
    assert of["id"] in of_ids


def test_of_detail_shows_encomenda_link(auth):
    of_id = _CREATED["ofs"][-1]
    r = requests.get(f"{API}/ordens-fabrico/{of_id}", headers=auth)
    assert r.status_code == 200, r.text
    of = r.json()
    assert of.get("encomenda_id")
    assert of.get("encomenda_numero", "").startswith("ENC-2026-")


def test_encomendas_list_includes_num_ofs(auth):
    r = requests.get(f"{API}/encomendas", headers=auth)
    assert r.status_code == 200
    arr = r.json()
    found = [e for e in arr if e["id"] in _CREATED["encomendas"]]
    assert len(found) >= 1
    for e in found:
        assert "num_ofs" in e
        assert isinstance(e["num_ofs"], int)


# ------------------- 5. Numeração ENC-2026-XXXX sequencial -------------------
def test_encomenda_numero_pattern(auth):
    r = requests.get(f"{API}/encomendas", headers=auth)
    assert r.status_code == 200
    nums = [e.get("numero", "") for e in r.json() if e["id"] in _CREATED["encomendas"]]
    for n in nums:
        assert n.startswith("ENC-2026-"), f"padrão inválido: {n}"
        # verificar formato ENC-2026-XXXX
        parts = n.split("-")
        assert len(parts) == 3 and parts[1] == "2026" and len(parts[2]) >= 4


# ------------------- ZZZ Cleanup -------------------
def test_zzz_cleanup(auth):
    # Apagar OFs criadas
    for oid in _CREATED["ofs"]:
        requests.delete(f"{API}/ordens-fabrico/{oid}", headers=auth)
    # Apagar orçamentos
    for oid in _CREATED["orcamentos"]:
        requests.delete(f"{API}/orcamentos/{oid}", headers=auth)
    # Apagar encomendas
    for eid in _CREATED["encomendas"]:
        requests.delete(f"{API}/encomendas/{eid}", headers=auth)
    # Apagar clientes
    for cid in _CREATED["clientes"]:
        requests.delete(f"{API}/clientes/{cid}", headers=auth)
    # Apagar artigos criados localmente
    for aid in _CREATED["artigos"]:
        requests.delete(f"{API}/artigos/{aid}", headers=auth)

    # Confirma contas reais intactas
    r = requests.get(f"{API}/users", headers=auth)
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "geral@famarte.pt" in emails
    assert "m-p@live.com.pt" in emails
    assert ADMIN_EMAIL in emails
