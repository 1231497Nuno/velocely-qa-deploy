"""Testes de auditoria/histórico (timeline) — iteração 23.

Cobre:
- Clientes: criar/editar/eliminar → criado/editado(alteracoes)/eliminado
- Orçamentos: criar/editar/estado_alterado/duplicar/converter
- Encomendas: criar/editar/pagamento/producao_autorizada/estado_alterado
- Ordens de Fabrico: criar/estado_alterado/prioridade/concluido
- Catálogo: artigo/consumivel/maquina/mao_obra/tipo_personalizacao
- GET /historico global com filtro ?tipo=
- GET /historico/{tipo}/{id} exige autenticação
- Metadados de utilizador (login/nome)
"""
import time

import pytest
import requests
from conftest import get_base_url, get_admin_credentials, finalizar_e_aceitar

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"

ADMIN_LOGIN = "admin"
_, ADMIN_PASSWORD = get_admin_credentials()

# IDs criados nos testes, para limpeza
CREATED = {
    "clientes": [],
    "orcamentos": [],
    "encomendas": [],
    "ordens": [],
    "artigos": [],
    "consumiveis": [],
    "maquinas": [],
    "mao_obra": [],
    "tipos": [],
}


# ------------------ Fixtures ------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login falhou: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def cleanup(auth_headers):
    yield
    # Teardown: eliminar todos os recursos criados
    def _del(path, ids):
        for i in ids:
            try:
                requests.delete(f"{API}/{path}/{i}", headers=auth_headers, timeout=10)
            except Exception:
                pass
    _del("orcamentos", CREATED["orcamentos"])
    _del("encomendas", CREATED["encomendas"])
    _del("ordens-fabrico", CREATED["ordens"])
    _del("artigos", CREATED["artigos"])
    _del("consumiveis", CREATED["consumiveis"])
    _del("maquinas", CREATED["maquinas"])
    _del("mao-obra", CREATED["mao_obra"])
    _del("tipos-personalizacao", CREATED["tipos"])
    _del("clientes", CREATED["clientes"])


def _get_hist(entidade_tipo, entidade_id, headers):
    r = requests.get(f"{API}/historico/{entidade_tipo}/{entidade_id}", headers=headers, timeout=15)
    assert r.status_code == 200, f"GET /historico falhou: {r.status_code} {r.text}"
    return r.json()


def _acoes(eventos):
    return [e.get("acao") for e in eventos]


# ------------------ AUTH ------------------
class TestHistoricoAuth:
    def test_historico_global_requires_auth(self):
        r = requests.get(f"{API}/historico", timeout=15)
        assert r.status_code in (401, 403), f"Esperava 401/403 sem token, veio {r.status_code}"

    def test_historico_entidade_requires_auth(self):
        r = requests.get(f"{API}/historico/cliente/qualquer-id", timeout=15)
        assert r.status_code in (401, 403), f"Esperava 401/403 sem token, veio {r.status_code}"


# ------------------ CLIENTES ------------------
class TestClienteHistorico:
    def test_ciclo_completo(self, auth_headers):
        # criar
        payload = {"nome": "teste-cliente-hist", "email": "teste-hist@example.com", "nif": "999999990"}
        r = requests.post(f"{API}/clientes", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        CREATED["clientes"].append(cid)

        # editar (alteracao no email e nif)
        upd = {**payload, "email": "teste-hist-2@example.com", "nif": "999999991"}
        r = requests.put(f"{API}/clientes/{cid}", json=upd, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # ver histórico
        ev = _get_hist("cliente", cid, auth_headers)
        acoes = _acoes(ev)
        assert "criado" in acoes, f"Falta 'criado' — {acoes}"
        assert "editado" in acoes, f"Falta 'editado' — {acoes}"

        edit = next(e for e in ev if e.get("acao") == "editado")
        assert isinstance(edit.get("alteracoes"), list) and len(edit["alteracoes"]) >= 2
        campos = {a["campo"] for a in edit["alteracoes"]}
        assert "email" in campos and "nif" in campos
        # verifica de/para
        email_alt = next(a for a in edit["alteracoes"] if a["campo"] == "email")
        assert email_alt["de"] == "teste-hist@example.com"
        assert email_alt["para"] == "teste-hist-2@example.com"

        # user metadata
        criado = next(e for e in ev if e.get("acao") == "criado")
        assert criado.get("utilizador_login") == "admin"
        assert criado.get("utilizador_nome")  # não vazio

        # eliminar
        r = requests.delete(f"{API}/clientes/{cid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        CREATED["clientes"].remove(cid)

        ev = _get_hist("cliente", cid, auth_headers)
        assert "eliminado" in _acoes(ev)


# ------------------ CATÁLOGO ------------------
class TestCatalogHistorico:
    def test_artigo_crud_historico(self, auth_headers):
        r = requests.post(f"{API}/artigos", json={"nome": "teste-art-hist", "custo_artigo": 10.0, "margem": 30.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        aid = r.json()["id"]
        CREATED["artigos"].append(aid)

        # edit
        r = requests.put(f"{API}/artigos/{aid}", json={"nome": "teste-art-hist-2", "custo_artigo": 12.0, "margem": 40.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        ev = _get_hist("artigo", aid, auth_headers)
        acoes = _acoes(ev)
        assert "criado" in acoes and "editado" in acoes
        edit = next(e for e in ev if e.get("acao") == "editado")
        campos = {a["campo"] for a in edit["alteracoes"]}
        assert "nome" in campos or "custo_artigo" in campos or "margem" in campos

        # delete
        requests.delete(f"{API}/artigos/{aid}", headers=auth_headers, timeout=15)
        CREATED["artigos"].remove(aid)
        ev = _get_hist("artigo", aid, auth_headers)
        assert "eliminado" in _acoes(ev)

    def test_consumivel_historico(self, auth_headers):
        r = requests.post(f"{API}/consumiveis", json={"nome": "teste-cons-hist", "unidade": "un", "custo_unitario": 1.5}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]
        CREATED["consumiveis"].append(cid)
        # edit
        r = requests.put(f"{API}/consumiveis/{cid}", json={"nome": "teste-cons-hist-2", "unidade": "un", "custo_unitario": 2.5}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        # delete
        requests.delete(f"{API}/consumiveis/{cid}", headers=auth_headers, timeout=15)
        CREATED["consumiveis"].remove(cid)

        ev = _get_hist("consumivel", cid, auth_headers)
        assert set(_acoes(ev)) >= {"criado", "editado", "eliminado"}

    def test_maquina_historico(self, auth_headers):
        r = requests.post(f"{API}/maquinas", json={"nome": "teste-maq-hist", "custo_amortizacao_hora": 2.0, "custo_energia_hora": 1.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        mid = r.json()["id"]
        CREATED["maquinas"].append(mid)
        r = requests.put(f"{API}/maquinas/{mid}", json={"nome": "teste-maq-hist-2", "custo_amortizacao_hora": 3.0, "custo_energia_hora": 1.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        requests.delete(f"{API}/maquinas/{mid}", headers=auth_headers, timeout=15)
        CREATED["maquinas"].remove(mid)
        ev = _get_hist("maquina", mid, auth_headers)
        assert set(_acoes(ev)) >= {"criado", "editado", "eliminado"}

    def test_mao_obra_historico(self, auth_headers):
        r = requests.post(f"{API}/mao-obra", json={"nome": "teste-mo-hist", "custo_hora": 10.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        mid = r.json()["id"]
        CREATED["mao_obra"].append(mid)
        r = requests.put(f"{API}/mao-obra/{mid}", json={"nome": "teste-mo-hist-2", "custo_hora": 12.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        requests.delete(f"{API}/mao-obra/{mid}", headers=auth_headers, timeout=15)
        CREATED["mao_obra"].remove(mid)
        ev = _get_hist("mao_obra", mid, auth_headers)
        assert set(_acoes(ev)) >= {"criado", "editado", "eliminado"}

    def test_tipo_personalizacao_historico(self, auth_headers):
        r = requests.post(f"{API}/tipos-personalizacao", json={"nome": "teste-tipo-hist", "valor": 1.0, "tempo": 1.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        tid = r.json()["id"]
        CREATED["tipos"].append(tid)
        r = requests.put(f"{API}/tipos-personalizacao/{tid}", json={"nome": "teste-tipo-hist-2", "valor": 2.0, "tempo": 1.0}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        requests.delete(f"{API}/tipos-personalizacao/{tid}", headers=auth_headers, timeout=15)
        CREATED["tipos"].remove(tid)
        ev = _get_hist("tipo_personalizacao", tid, auth_headers)
        assert set(_acoes(ev)) >= {"criado", "editado", "eliminado"}


# ------------------ ORÇAMENTOS ------------------
class TestOrcamentoHistorico:
    def test_criar_editar_estado_duplicar(self, auth_headers):
        # criar
        payload = {"cliente": "teste-cli-orc", "descricao": "teste-desc", "status": "rascunho", "linhas": [], "materiais": []}
        r = requests.post(f"{API}/orcamentos", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]
        CREATED["orcamentos"].append(oid)

        # editar campos (descricao)
        upd = {**payload, "descricao": "teste-desc-editada"}
        r = requests.put(f"{API}/orcamentos/{oid}", json=upd, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # finalizar (obtém número) e mudar estado
        r = requests.post(f"{API}/orcamentos/{oid}/finalizar", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        upd2 = {**upd, "status": "enviado"}
        r = requests.put(f"{API}/orcamentos/{oid}", json=upd2, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # duplicar
        r = requests.post(f"{API}/orcamentos/{oid}/duplicar", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        novo_id = r.json()["id"]
        CREATED["orcamentos"].append(novo_id)

        ev = _get_hist("orcamento", oid, auth_headers)
        acoes = _acoes(ev)
        assert "criado" in acoes
        assert "editado" in acoes
        assert "estado_alterado" in acoes

        # duplicado no NOVO
        ev_novo = _get_hist("orcamento", novo_id, auth_headers)
        assert "duplicado" in _acoes(ev_novo)

    def test_converter_orcamento(self, auth_headers):
        arts = requests.get(f"{API}/artigos?lite=1", headers=auth_headers, timeout=15).json()
        arts = arts if isinstance(arts, list) else arts.get("items") or []
        assert arts, "sem artigos"
        art = arts[0]
        payload = {
            "cliente": "teste-cli-conv",
            "descricao": "teste-conv",
            "status": "aceite",
            "linhas": [{"artigo_id": art["id"], "artigo_nome": art.get("nome") or "x", "quantidade": 1}],
            "materiais": [],
        }
        r = requests.post(f"{API}/orcamentos", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        oid = r.json()["id"]
        CREATED["orcamentos"].append(oid)

        finalizar_e_aceitar(requests, API, oid, headers=auth_headers, timeout=15)

        r = requests.post(f"{API}/orcamentos/{oid}/converter", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        enc = r.json()
        # Fluxo atual: converter devolve Encomenda (não OF)
        enc_id = enc["id"] if not enc.get("encomenda_id") else enc.get("encomenda_id")
        if enc.get("numero", "").startswith("OF"):
            CREATED["ordens"].append(enc["id"])
            enc_id = enc.get("encomenda_id")
        if enc_id:
            CREATED["encomendas"].append(enc_id)

        # orçamento: convertido
        ev_orc = _get_hist("orcamento", oid, auth_headers)
        assert "convertido" in _acoes(ev_orc), f"Esperava 'convertido' no orçamento — {_acoes(ev_orc)}"

        # Encomenda: criado
        if enc_id:
            ev_enc = _get_hist("encomenda", enc_id, auth_headers)
            assert "criado" in _acoes(ev_enc)


# ------------------ ENCOMENDAS ------------------
class TestEncomendaHistorico:
    def test_criar_pagamento_producao_estado(self, auth_headers):
        payload = {
            "cliente": "teste-cli-enc", "descricao": "teste-enc",
            "estado": "aberta", "valor_total": 100.0, "valor_total_manual": True,
            "artigos": []
        }
        r = requests.post(f"{API}/encomendas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        CREATED["encomendas"].append(eid)

        # pagamento
        upd = {**payload, "valor_pago": 50.0}
        r = requests.put(f"{API}/encomendas/{eid}", json=upd, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # autorização de produção
        upd2 = {**upd, "autorizada_producao": True}
        r = requests.put(f"{API}/encomendas/{eid}", json=upd2, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # estado
        upd3 = {**upd2, "estado": "em_producao"}
        r = requests.put(f"{API}/encomendas/{eid}", json=upd3, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # edição de outro campo (descricao)
        upd4 = {**upd3, "descricao": "teste-enc-editada"}
        r = requests.put(f"{API}/encomendas/{eid}", json=upd4, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        ev = _get_hist("encomenda", eid, auth_headers)
        acoes = _acoes(ev)
        assert "criado" in acoes
        assert "pagamento" in acoes, f"Falta 'pagamento' — {acoes}"
        assert "producao_autorizada" in acoes, f"Falta 'producao_autorizada' — {acoes}"
        assert "estado_alterado" in acoes, f"Falta 'estado_alterado' — {acoes}"
        assert "editado" in acoes, f"Falta 'editado' — {acoes}"


# ------------------ ORDENS DE FABRICO ------------------
class TestOFHistorico:
    def test_criar_estado_prioridade_finalizar(self, auth_headers):
        payload = {
            "cliente": "teste-cli-of", "descricao": "teste-of",
            "status": "pendente", "itens": []
        }
        r = requests.post(f"{API}/ordens-fabrico", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        of_id = r.json()["id"]
        CREATED["ordens"].append(of_id)

        # PUT com mudança de estado
        upd = {**payload, "status": "em_producao"}
        r = requests.put(f"{API}/ordens-fabrico/{of_id}", json=upd, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # prioridade
        r = requests.post(f"{API}/ordens-fabrico/{of_id}/prioridade", json={"prioritaria": True}, headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # finalizar
        r = requests.post(f"{API}/ordens-fabrico/{of_id}/finalizar", headers=auth_headers, timeout=15)
        assert r.status_code == 200

        ev = _get_hist("ordem_fabrico", of_id, auth_headers)
        acoes = _acoes(ev)
        assert "criado" in acoes
        assert "estado_alterado" in acoes, f"Falta 'estado_alterado' — {acoes}"
        assert "prioridade" in acoes, f"Falta 'prioridade' — {acoes}"
        assert "concluido" in acoes, f"Falta 'concluido' — {acoes}"


# ------------------ GLOBAL & FILTRO ------------------
class TestHistoricoGlobal:
    def test_global_ordem_desc(self, auth_headers):
        # cria um cliente para garantir evento recente
        r = requests.post(f"{API}/clientes", json={"nome": "teste-cli-global"}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]
        CREATED["clientes"].append(cid)

        time.sleep(0.5)
        r = requests.get(f"{API}/historico?limit=50", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        eventos = r.json()
        assert isinstance(eventos, list) and len(eventos) > 0
        # verificar ordenação desc por timestamp
        timestamps = [e.get("timestamp") for e in eventos if e.get("timestamp")]
        assert timestamps == sorted(timestamps, reverse=True), "Eventos devem estar ordenados por timestamp desc"

    def test_global_filtro_tipo(self, auth_headers):
        r = requests.get(f"{API}/historico?tipo=cliente&limit=100", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        eventos = r.json()
        assert isinstance(eventos, list)
        for e in eventos:
            assert e.get("entidade_tipo") == "cliente"

    def test_user_metadata(self, auth_headers):
        r = requests.get(f"{API}/historico?limit=20", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        eventos = r.json()
        assert len(eventos) > 0
        # pelo menos um evento recente do admin
        recentes_admin = [e for e in eventos if e.get("utilizador_login") == "admin"]
        assert len(recentes_admin) > 0, "Nenhum evento com utilizador_login=admin"
        e0 = recentes_admin[0]
        assert e0.get("utilizador_nome"), "utilizador_nome vazio"
