"""Iteration 8: RBAC perfis + material margem por linha + lista endpoints (pesquisa)."""
import os
import time
import requests
import pytest
from pathlib import Path

def _load_react_url():
    if os.environ.get('REACT_APP_BACKEND_URL'):
        return os.environ['REACT_APP_BACKEND_URL']
    envf = Path('/app/frontend/.env')
    for line in envf.read_text().splitlines():
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError('REACT_APP_BACKEND_URL not set')

BASE_URL = _load_react_url().rstrip('/')
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@prodcost.pt"
ADMIN_PASS = "Admin123!"

TESTE_PREFIX = "teste-"

session = requests.Session()


def _login(email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASS)
    assert r.status_code == 200, f"admin login: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --- Pesquisa: list endpoints alive ---
def test_lists_alive_for_search(admin_headers):
    for path in ["/mao-obra", "/tipos-personalizacao", "/producao/tempos"]:
        r = requests.get(API + path, headers=admin_headers)
        assert r.status_code == 200, f"{path}: {r.status_code}"
        assert isinstance(r.json(), list)


# --- RBAC: perfis ---
def test_rbac_modulos(admin_headers):
    r = requests.get(f"{API}/rbac/modulos", headers=admin_headers)
    assert r.status_code == 200
    j = r.json()
    keys = {m["key"] for m in j["modulos"]}
    for required in ["dashboard", "orcamentos", "utilizadores", "maquinas", "artigos",
                     "materiais", "mao_obra", "personalizacao", "ordens_fabrico", "analise_producao"]:
        assert required in keys, f"módulo em falta: {required}"
    assert set(j["acoes"]) == {"view", "create", "edit", "delete"}


def _cleanup_perfis(admin_headers):
    r = requests.get(f"{API}/perfis", headers=admin_headers)
    if r.status_code == 200:
        for p in r.json():
            if p.get("nome", "").startswith(TESTE_PREFIX):
                requests.delete(f"{API}/perfis/{p['id']}", headers=admin_headers)


def _cleanup_users(admin_headers):
    r = requests.get(f"{API}/users", headers=admin_headers)
    if r.status_code == 200:
        for u in r.json():
            if u.get("email", "").startswith(TESTE_PREFIX) or "teste-" in u.get("email", ""):
                requests.delete(f"{API}/users/{u['id']}", headers=admin_headers)


def test_create_perfil_and_user_with_perfil(admin_headers):
    _cleanup_users(admin_headers)
    _cleanup_perfis(admin_headers)

    # Build permissoes: orcamentos view+create, dashboard view; nada mais.
    permissoes = {}
    perm_payload = {
        "nome": f"{TESTE_PREFIX}Vendas",
        "admin": False,
        "permissoes": {
            "dashboard": {"view": True},
            "orcamentos": {"view": True, "create": True},
        },
    }
    r = requests.post(f"{API}/perfis", json=perm_payload, headers=admin_headers)
    assert r.status_code == 200, r.text
    perfil = r.json()
    assert perfil["nome"] == f"{TESTE_PREFIX}Vendas"
    assert perfil["sistema"] is False
    assert perfil["permissoes"]["orcamentos"]["create"] is True
    assert perfil["permissoes"]["orcamentos"]["delete"] is False
    assert perfil["permissoes"]["maquinas"]["view"] is False
    assert perfil["permissoes"]["utilizadores"]["view"] is False

    # System perfil "Administrador" deve existir e ser sistema=True
    r = requests.get(f"{API}/perfis", headers=admin_headers)
    assert r.status_code == 200
    perfis = r.json()
    admin_sys = [p for p in perfis if p.get("admin") and p.get("sistema")]
    assert admin_sys, "Falta perfil sistema Administrador"

    # Criar utilizador com este perfil
    user_payload = {
        "email": f"{TESTE_PREFIX}vend@prodcost.pt",
        "name": "Teste Vendas",
        "password": "teste123",
        "perfil_id": perfil["id"],
    }
    r = requests.post(f"{API}/users", json=user_payload, headers=admin_headers)
    assert r.status_code == 200, r.text
    user = r.json()
    assert user["email"] == user_payload["email"]
    assert user["perfil_id"] == perfil["id"]
    assert user["perfil"]["nome"] == f"{TESTE_PREFIX}Vendas"
    assert user["role"] == "colaborador"


def test_rbac_enforcement_backend_for_restricted_user(admin_headers):
    # Login com o user de teste criado
    r = _login(f"{TESTE_PREFIX}vend@prodcost.pt", "teste123")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    # Esperar 403 em users e perfis
    for path in ["/users", "/perfis"]:
        r = requests.get(API + path, headers=h)
        assert r.status_code == 403, f"{path} devia ser 403, foi {r.status_code}"

    # auth/me OK
    r = requests.get(f"{API}/auth/me", headers=h)
    assert r.status_code == 200
    me = r.json()
    assert me["perfil"]["admin"] is False
    assert me["perfil"]["permissoes"]["orcamentos"]["create"] is True
    assert me["perfil"]["permissoes"]["orcamentos"]["delete"] is False


def test_admin_can_access_users_and_perfis(admin_headers):
    r = requests.get(f"{API}/users", headers=admin_headers)
    assert r.status_code == 200
    r = requests.get(f"{API}/perfis", headers=admin_headers)
    assert r.status_code == 200


# --- Material margem por linha ---
def test_orcamento_material_margem_por_linha(admin_headers):
    # Criar consumível m² a 20€/m²
    cons_payload = {"nome": f"{TESTE_PREFIX}MDF-it8", "unidade": "m²", "custo_unitario": 20.0}
    r = requests.post(f"{API}/consumiveis", json=cons_payload)
    assert r.status_code == 200, r.text
    cons = r.json()
    cid = cons["id"]

    try:
        # Orçamento com material: Comp=500 Larg=1000 (=0.5m²) custo 20 → custo=10. Margem 50 → valor=15
        orc_payload = {
            "cliente": f"{TESTE_PREFIX}cliente",
            "descricao": "test margem por linha",
            "linhas": [],
            "materiais": [{
                "consumivel_id": cid,
                "nome": cons["nome"],
                "unidade": "m²",
                "custo_unitario": 20.0,
                "quantidade": 1,
                "comprimento_mm": 500,
                "largura_mm": 1000,
                "margem": 50,
            }],
        }
        r = requests.post(f"{API}/orcamentos", json=orc_payload)
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]
        mat = orc["materiais"][0]
        assert mat["custo"] == 10.0
        assert mat["valor"] == 15.0
        assert orc["custo_materiais"] == 10.0
        assert orc["total_materiais"] == 15.0
        assert orc["total"] == 15.0

        # Update margem para 100 → valor=20
        orc_payload["materiais"][0]["margem"] = 100
        r = requests.put(f"{API}/orcamentos/{oid}", json=orc_payload)
        assert r.status_code == 200, r.text
        upd = r.json()
        mat = upd["materiais"][0]
        assert mat["custo"] == 10.0
        assert mat["valor"] == 20.0
        assert upd["total_materiais"] == 20.0
        assert upd["total"] == 20.0

        # GET para confirmar persistência
        r = requests.get(f"{API}/orcamentos/{oid}")
        assert r.status_code == 200
        got = r.json()
        assert got["materiais"][0]["margem"] == 100
        assert got["materiais"][0]["valor"] == 20.0

        # Cleanup orçamento
        requests.delete(f"{API}/orcamentos/{oid}")
    finally:
        requests.delete(f"{API}/consumiveis/{cid}")


def test_default_margem_is_50(admin_headers):
    cons_payload = {"nome": f"{TESTE_PREFIX}MDF-default", "unidade": "m²", "custo_unitario": 20.0}
    r = requests.post(f"{API}/consumiveis", json=cons_payload)
    cid = r.json()["id"]
    try:
        # Sem margem definida na linha
        orc_payload = {
            "cliente": f"{TESTE_PREFIX}cliente2",
            "linhas": [],
            "materiais": [{
                "consumivel_id": cid,
                "nome": "x", "unidade": "m²",
                "custo_unitario": 20.0, "quantidade": 1,
                "comprimento_mm": 500, "largura_mm": 1000,
            }],
        }
        r = requests.post(f"{API}/orcamentos", json=orc_payload)
        assert r.status_code == 200, r.text
        orc = r.json()
        assert orc["materiais"][0]["margem"] == 50.0
        assert orc["materiais"][0]["valor"] == 15.0
        requests.delete(f"{API}/orcamentos/{orc['id']}")
    finally:
        requests.delete(f"{API}/consumiveis/{cid}")


# --- Cleanup final ---
def test_zzz_cleanup(admin_headers):
    _cleanup_users(admin_headers)
    _cleanup_perfis(admin_headers)
    # Verificar que ficaram limpos
    r = requests.get(f"{API}/users", headers=admin_headers)
    if r.status_code == 200:
        assert not any(u.get("email", "").startswith(TESTE_PREFIX) for u in r.json())
    r = requests.get(f"{API}/perfis", headers=admin_headers)
    if r.status_code == 200:
        assert not any(p.get("nome", "").startswith(TESTE_PREFIX) for p in r.json())
