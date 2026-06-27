"""Tests for JWT auth, RBAC users, material markup (50%) in orçamento."""
import os
import requests
import pytest

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://budgeting-orders.preview.emergentagent.com').rstrip('/')
API = BASE + '/api'

ADMIN_EMAIL = 'admin@prodcost.pt'
ADMIN_PASS = 'Admin123!'


@pytest.fixture(scope='module')
def admin_token():
    r = requests.post(f'{API}/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert 'token' in data and data['user']['role'] == 'admin'
    return data['token']


@pytest.fixture(scope='module')
def admin_headers(admin_token):
    return {'Authorization': f'Bearer {admin_token}'}


def test_login_invalid():
    r = requests.post(f'{API}/auth/login', json={'email': 'admin@prodcost.pt', 'password': 'wrong'}, timeout=15)
    assert r.status_code == 401


def test_me_no_token():
    r = requests.get(f'{API}/auth/me', timeout=15)
    assert r.status_code == 401


def test_me_with_token(admin_headers):
    r = requests.get(f'{API}/auth/me', headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()['email'] == ADMIN_EMAIL


def test_list_users_requires_admin_no_token():
    r = requests.get(f'{API}/users', timeout=15)
    assert r.status_code == 401


def test_users_crud_and_colaborador_403(admin_headers):
    email = 'test_colab@prodcost.pt'
    # Cleanup if exists - list and delete
    r = requests.get(f'{API}/users', headers=admin_headers, timeout=15)
    assert r.status_code == 200
    for u in r.json():
        if u['email'] == email:
            requests.delete(f"{API}/users/{u['id']}", headers=admin_headers, timeout=15)

    # CREATE colaborador
    r = requests.post(f'{API}/users', headers=admin_headers, json={
        'email': email, 'name': 'Colab Teste', 'password': 'colab123', 'role': 'colaborador'
    }, timeout=15)
    assert r.status_code == 200, r.text
    uid = r.json()['id']
    assert r.json()['role'] == 'colaborador'

    # GET via list to verify persistence
    r = requests.get(f'{API}/users', headers=admin_headers, timeout=15)
    emails = [u['email'] for u in r.json()]
    assert email in emails

    # LOGIN as colaborador and verify 403 on /users
    r = requests.post(f'{API}/auth/login', json={'email': email, 'password': 'colab123'}, timeout=15)
    assert r.status_code == 200
    col_tok = r.json()['token']
    r = requests.get(f'{API}/users', headers={'Authorization': f'Bearer {col_tok}'}, timeout=15)
    assert r.status_code == 403

    # UPDATE
    r = requests.put(f'{API}/users/{uid}', headers=admin_headers, json={'name': 'Renomeado'}, timeout=15)
    assert r.status_code == 200 and r.json()['name'] == 'Renomeado'

    # DELETE
    r = requests.delete(f'{API}/users/{uid}', headers=admin_headers, timeout=15)
    assert r.status_code == 200


def test_create_user_duplicate(admin_headers):
    r = requests.post(f'{API}/users', headers=admin_headers, json={
        'email': ADMIN_EMAIL, 'password': 'x', 'role': 'admin'
    }, timeout=15)
    assert r.status_code == 400


def _ensure_m2_consumivel():
    r = requests.get(f'{API}/consumiveis', timeout=15)
    assert r.status_code == 200
    for c in r.json():
        if (c.get('unidade') or '').lower() in ('m²', 'm2'):
            return c
    r = requests.post(f'{API}/consumiveis', json={
        'nome': 'TEST_Chapa m2', 'unidade': 'm²', 'custo_unitario': 20.0
    }, timeout=15)
    assert r.status_code == 200
    return r.json()


def _ensure_un_consumivel():
    r = requests.get(f'{API}/consumiveis', timeout=15)
    for c in r.json():
        if (c.get('unidade') or '').lower() == 'un':
            return c
    r = requests.post(f'{API}/consumiveis', json={
        'nome': 'TEST_Parafuso', 'unidade': 'un', 'custo_unitario': 0.5
    }, timeout=15)
    return r.json()


def test_orcamento_materiais_markup_m2_and_un():
    m2 = _ensure_m2_consumivel()
    un = _ensure_un_consumivel()

    payload = {
        'cliente': 'TEST_Cliente Materiais',
        'descricao': 'Teste markup materiais',
        'linhas': [],
        'materiais': [
            {
                'consumivel_id': m2['id'], 'nome': m2['nome'], 'unidade': 'm²',
                'custo_unitario': 20.0, 'quantidade': 1,
                'comprimento_mm': 500, 'largura_mm': 1000,
            },
            {
                'consumivel_id': un['id'], 'nome': un['nome'], 'unidade': 'un',
                'custo_unitario': 2.0, 'quantidade': 3,
                'comprimento_mm': 0, 'largura_mm': 0,
            },
        ],
    }
    r = requests.post(f'{API}/orcamentos', json=payload, timeout=20)
    assert r.status_code == 200, r.text
    o = r.json()
    oid = o['id']

    # m²: 0.5 * 1.0 * 20 * 1 = 10 custo; valor = 10 * 1.5 = 15
    # un: 3 * 2 = 6 custo; valor = 6 * 1.5 = 9
    materiais = o.get('materiais') or []
    assert len(materiais) == 2
    m2_line = next(m for m in materiais if (m.get('unidade') or '').lower() in ('m²', 'm2'))
    un_line = next(m for m in materiais if (m.get('unidade') or '').lower() == 'un')
    assert m2_line['custo'] == 10.0, m2_line
    assert m2_line['valor'] == 15.0, m2_line
    assert un_line['custo'] == 6.0, un_line
    assert un_line['valor'] == 9.0, un_line

    assert o['custo_materiais'] == 16.0
    assert o['total_materiais'] == 24.0
    assert o['total'] == 24.0  # only materiais, no linhas

    # GET to verify persistence
    r = requests.get(f'{API}/orcamentos/{oid}', timeout=15)
    assert r.status_code == 200
    o2 = r.json()
    assert o2['total_materiais'] == 24.0
    assert o2['custo_materiais'] == 16.0

    # Cleanup
    requests.delete(f'{API}/orcamentos/{oid}', timeout=15)


def test_search_endpoints_alive():
    """Sanity check that list endpoints (used by search) respond."""
    for ep in ['/orcamentos', '/ordens-fabrico', '/artigos', '/consumiveis', '/maquinas']:
        r = requests.get(f'{API}{ep}', timeout=15)
        assert r.status_code == 200, ep
        assert isinstance(r.json(), list)
