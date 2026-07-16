"""Testes de iteração 26 — Velocely ERP FASE A/B/C.
Cobre:
- FASE A: /api/utilizadores-lista, /api/ordens-fabrico (responsavel_id/nome), campo status para Kanban
- FASE B: /api/search?q=, /api/notificacoes
- FASE C1: POST/DELETE /api/encomendas/{eid}/pagamentos, GET /api/encomendas/{eid}/pagamentos/{pid}/recibo (Auth header + ?auth= query)
- FASE C2: /api/clientes/{id}/historico-precos
"""
import pytest
import requests
from conftest import get_base_url

BASE_URL = get_base_url()


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"login": "admin", "password": "Admin123!"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def me(auth):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth)
    assert r.status_code == 200
    return r.json()


# ==================== FASE A ====================

class TestFaseAUtilizadoresLista:
    def test_utilizadores_lista_returns_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/utilizadores-lista", headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        for u in data:
            assert "id" in u
            assert "nome" in u

    def test_utilizadores_lista_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/utilizadores-lista")
        assert r.status_code == 401


class TestFaseAOrdensFabricoKanban:
    def test_ofs_have_status_field_for_kanban(self, auth):
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico", headers=auth)
        assert r.status_code == 200
        ofs = r.json()
        assert isinstance(ofs, list)
        valid_statuses = {"pendente", "em_producao", "concluido"}
        for o in ofs:
            assert o.get("status") in valid_statuses, f"OF {o.get('numero')} has invalid status: {o.get('status')}"

    def test_of_has_responsavel_fields(self, auth):
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico", headers=auth)
        assert r.status_code == 200
        ofs = r.json()
        for o in ofs:
            # both fields must be present as keys (may be None)
            assert "responsavel_id" in o
            assert "responsavel_nome" in o


class TestFaseAResponsavel:
    def test_atribuir_responsavel_a_of(self, auth, me):
        # Get first real OF
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico", headers=auth)
        ofs = r.json()
        if not ofs:
            pytest.skip("Sem OFs para testar responsavel")
        of = ofs[0]
        oid = of["id"]
        # Save the current state
        original_resp_id = of.get("responsavel_id")
        original_resp_nome = of.get("responsavel_nome")

        # Get full OF (with itens) for PUT
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico/{oid}", headers=auth)
        assert r.status_code == 200
        full = r.json()

        # Assign admin as responsavel
        payload = {
            "cliente": full.get("cliente") or "",
            "status": full.get("status") or "pendente",
            "itens": full.get("itens") or [],
            "responsavel_id": me["id"],
            "responsavel_nome": me.get("name") or me.get("nome") or me.get("login"),
        }
        # Preserve other required fields
        for k in ("prazo_entrega", "cliente_id", "encomenda_id", "encomenda_numero", "orcamento_id", "orcamento_numero", "prioritaria", "data", "notas", "imagens"):
            if k in full and full[k] is not None:
                payload[k] = full[k]

        r = requests.put(f"{BASE_URL}/api/ordens-fabrico/{oid}", json=payload, headers=auth)
        assert r.status_code == 200, r.text

        # Reload to verify persistence
        r = requests.get(f"{BASE_URL}/api/ordens-fabrico/{oid}", headers=auth)
        assert r.status_code == 200
        updated = r.json()
        assert updated.get("responsavel_id") == me["id"]
        assert updated.get("responsavel_nome") is not None

        # Restore original (do not touch real data)
        payload["responsavel_id"] = original_resp_id
        payload["responsavel_nome"] = original_resp_nome
        r = requests.put(f"{BASE_URL}/api/ordens-fabrico/{oid}", json=payload, headers=auth)
        assert r.status_code == 200


# ==================== FASE B ====================

class TestFaseBSearch:
    def test_search_encomendas(self, auth):
        r = requests.get(f"{BASE_URL}/api/search", params={"q": "ENC"}, headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert "resultados" in data
        assert isinstance(data["resultados"], list)
        if data["resultados"]:
            tipos = {x["tipo"] for x in data["resultados"]}
            # deve haver encomendas nos resultados
            assert any("nc" in t.lower() for t in tipos)  # "Encomenda"
            for x in data["resultados"]:
                assert "id" in x and "titulo" in x and "url" in x

    def test_search_ofs(self, auth):
        r = requests.get(f"{BASE_URL}/api/search", params={"q": "OF"}, headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert "resultados" in data

    def test_search_empty_q(self, auth):
        r = requests.get(f"{BASE_URL}/api/search", params={"q": ""}, headers=auth)
        # deve devolver 200 com lista vazia ou similar (não deve rebentar)
        assert r.status_code == 200

    def test_search_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/search", params={"q": "ENC"})
        assert r.status_code == 401


class TestFaseBNotificacoes:
    def test_notificacoes_endpoint(self, auth):
        r = requests.get(f"{BASE_URL}/api/notificacoes", headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert "total" in data
        assert "notificacoes" in data
        assert isinstance(data["notificacoes"], list)
        assert isinstance(data["total"], int)
        for n in data["notificacoes"]:
            assert "id" in n
            assert "titulo" in n
            assert "url" in n

    def test_notificacoes_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/notificacoes")
        assert r.status_code == 401


# ==================== FASE C1 - Pagamentos ====================

@pytest.fixture(scope="class")
def encomenda_for_pag(auth):
    """Find an encomenda with pending value to test payments (partial).
    Any pagamentos criados serão eliminados no teardown."""
    r = requests.get(f"{BASE_URL}/api/encomendas", headers=auth)
    assert r.status_code == 200
    encs = r.json()
    # pick one with valor_total > 0 and valor_pago == 0 (safe)
    candidates = [e for e in encs if (e.get("valor_total") or 0) > 0 and (e.get("valor_pago") or 0) == 0]
    if not candidates:
        pytest.skip("Sem encomendas apropriadas para teste de pagamento")
    return candidates[0]


class TestFaseC1PagamentosParciais:
    _created_pids = []

    def test_add_pagamento_parcial(self, auth, encomenda_for_pag):
        eid = encomenda_for_pag["id"]
        total = encomenda_for_pag["valor_total"]
        valor_parcial = round(total * 0.3, 2)
        r = requests.post(
            f"{BASE_URL}/api/encomendas/{eid}/pagamentos",
            json={"valor": valor_parcial, "metodo": "transferencia", "nota": "teste-parcial"},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("valor_pago") == valor_parcial
        pags = data.get("pagamentos", [])
        assert len(pags) >= 1
        pag = pags[-1]
        assert pag["valor"] == valor_parcial
        assert pag["metodo"] == "transferencia"
        assert pag.get("recibo_numero", "").startswith("REC-")
        TestFaseC1PagamentosParciais._created_pids.append((eid, pag["id"]))

    def test_add_pagamento_rejects_negative(self, auth, encomenda_for_pag):
        eid = encomenda_for_pag["id"]
        r = requests.post(
            f"{BASE_URL}/api/encomendas/{eid}/pagamentos",
            json={"valor": -1, "metodo": "transferencia"},
            headers=auth,
        )
        assert r.status_code == 400

    def test_recibo_pdf_via_header(self, auth, encomenda_for_pag):
        if not TestFaseC1PagamentosParciais._created_pids:
            pytest.skip("Sem pagamento criado")
        eid, pid = TestFaseC1PagamentosParciais._created_pids[0]
        r = requests.get(
            f"{BASE_URL}/api/encomendas/{eid}/pagamentos/{pid}/recibo",
            headers=auth,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")

    def test_recibo_pdf_via_query_auth(self, token):
        """A UI abre o recibo em nova tab via ?auth=<token>.
        Este endpoint DEVE aceitar auth via query, tal como /files/{path}."""
        if not TestFaseC1PagamentosParciais._created_pids:
            pytest.skip("Sem pagamento criado")
        eid, pid = TestFaseC1PagamentosParciais._created_pids[0]
        r = requests.get(
            f"{BASE_URL}/api/encomendas/{eid}/pagamentos/{pid}/recibo?auth={token}"
        )
        assert r.status_code == 200, f"Recibo com ?auth= devolveu {r.status_code}"
        assert r.headers.get("content-type", "").startswith("application/pdf")

    def test_delete_pagamento_recalcula(self, auth):
        if not TestFaseC1PagamentosParciais._created_pids:
            pytest.skip("Sem pagamento criado")
        eid, pid = TestFaseC1PagamentosParciais._created_pids[0]
        r = requests.delete(
            f"{BASE_URL}/api/encomendas/{eid}/pagamentos/{pid}",
            headers=auth,
        )
        assert r.status_code == 200
        data = r.json()
        # o pagamento eliminado não deve constar
        ids = [p["id"] for p in data.get("pagamentos", [])]
        assert pid not in ids
        TestFaseC1PagamentosParciais._created_pids.remove((eid, pid))

    @classmethod
    def teardown_class(cls):
        # Cleanup: eliminar pagamentos de teste que restem
        try:
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"login": "admin", "password": "Admin123!"})
            tok = r.json()["token"]
            h = {"Authorization": f"Bearer {tok}"}
            for eid, pid in list(cls._created_pids):
                requests.delete(f"{BASE_URL}/api/encomendas/{eid}/pagamentos/{pid}", headers=h)
        except Exception:
            pass


# ==================== FASE C2 - Histórico de Preços ====================

class TestFaseC2HistoricoPrecos:
    def test_historico_precos_endpoint(self, auth):
        # find first cliente
        r = requests.get(f"{BASE_URL}/api/clientes", headers=auth)
        assert r.status_code == 200
        clientes = r.json()
        if not clientes:
            pytest.skip("Sem clientes")
        cid = clientes[0]["id"]
        r = requests.get(f"{BASE_URL}/api/clientes/{cid}/historico-precos", headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for h in data:
            assert "artigo_id" in h
            assert "ultimo_preco" in h
            assert "ocorrencias" in h
            assert "ultima_data" in h

    def test_historico_precos_requires_auth(self, auth):
        r = requests.get(f"{BASE_URL}/api/clientes", headers=auth)
        clientes = r.json()
        if not clientes:
            pytest.skip("Sem clientes")
        cid = clientes[0]["id"]
        r = requests.get(f"{BASE_URL}/api/clientes/{cid}/historico-precos")
        assert r.status_code == 401
