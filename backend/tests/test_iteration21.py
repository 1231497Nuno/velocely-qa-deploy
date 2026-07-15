"""
Iteration 21 — Regressão pós-refactor Clean Architecture.
Objetivo: paridade funcional (mesma superfície HTTP) após split de server.py em
app/core, app/domain, app/repositories, app/services, app/api/routes.

Cobertura (numeração garante ordem/loadscope=classe):
  1  Auth: login admin + /auth/me
  2  Dashboard/Analytics endpoints
  3  Clientes CRUD (teste-)
  4  Artigos CRUD (teste-)
  5  Orçamentos: criar, editar preço unitário manual, converter em OF+Encomenda
  6  OF: nota da operação persiste
  7  OF: timer iniciar/parar/toggle
  8  PDFs: /orcamentos/{id}/pdf, /ordens-fabrico/{id}/pdf, /encomendas/{id}/pdf
  9  Admin/RBAC: /users, /perfis

Todos os testes num único class → pytest-xdist loadscope (default) mantém-nos no mesmo worker.
"""
import os
import pytest
import requests


def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not defined")
    return url.rstrip("/")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@prodcost.pt"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "Admin123!")


@pytest.fixture(scope="class")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login falhou: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"sem token: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    yield s


@pytest.fixture(scope="class")
def bag():
    """Bolsa de IDs criados durante a suite; teardown apaga tudo."""
    b = {"clientes": [], "artigos": [], "orcamentos": [], "ofs": [], "encomendas": []}
    yield b
    # cleanup
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    for oid in list(b["orcamentos"]):
        try: s.delete(f"{BASE_URL}/api/orcamentos/{oid}")
        except Exception: pass
    for oid in list(b["ofs"]):
        try: s.delete(f"{BASE_URL}/api/ordens-fabrico/{oid}")
        except Exception: pass
    for eid in list(b["encomendas"]):
        try: s.delete(f"{BASE_URL}/api/encomendas/{eid}")
        except Exception: pass
    for aid in list(b["artigos"]):
        try: s.delete(f"{BASE_URL}/api/artigos/{aid}")
        except Exception: pass
    for cid in list(b["clientes"]):
        try: s.delete(f"{BASE_URL}/api/clientes/{cid}")
        except Exception: pass


def _pick_artigo_with_roteiro(client):
    arts = client.get(f"{BASE_URL}/api/artigos").json()
    for a in arts:
        if a.get("nome") == "DTF Têxtil Metro" and a.get("roteiro"):
            return a
    for a in arts:
        if a.get("roteiro"):
            return a
    return arts[0] if arts else None


class TestIteration21Refactor:
    """Suite única (loadscope pin) — cobre paridade funcional pós-refactor."""

    # 1 — Auth
    def test_01_auth_me(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text
        assert r.json().get("email") == ADMIN_EMAIL

    # 2 — Dashboard/analytics
    def test_02_dashboard_analise_producao(self, client):
        for path in ("/api/analise-producao", "/api/dashboard", "/api/analytics"):
            r = client.get(f"{BASE_URL}{path}")
            if r.status_code == 200:
                data = r.json()
                assert isinstance(data, (dict, list))
                return
        pytest.fail("Nenhum endpoint de dashboard/analytics respondeu 200")

    # 3 — Clientes CRUD
    def test_03_clientes_crud(self, client, bag):
        payload = {"nome": "teste-cliente-refactor", "email": "teste@x.pt", "nif": "999999999"}
        r = client.post(f"{BASE_URL}/api/clientes", json=payload)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["nome"] == payload["nome"]
        cid = c["id"]
        bag["clientes"].append(cid)

        r = client.get(f"{BASE_URL}/api/clientes")
        assert r.status_code == 200
        assert any(x["id"] == cid for x in r.json())

        upd = {**payload, "nome": "teste-cliente-refactor-2", "cidade": "Porto"}
        r = client.put(f"{BASE_URL}/api/clientes/{cid}", json=upd)
        assert r.status_code == 200, r.text
        assert r.json()["nome"] == "teste-cliente-refactor-2"
        assert r.json()["cidade"] == "Porto"

        r = client.delete(f"{BASE_URL}/api/clientes/{cid}")
        assert r.status_code == 200
        bag["clientes"].remove(cid)
        r = client.get(f"{BASE_URL}/api/clientes")
        assert not any(x["id"] == cid for x in r.json())

    # 4 — Artigos CRUD
    def test_04_artigos_crud(self, client, bag):
        payload = {"nome": "teste-artigo-refactor", "unidade": "un", "custo_artigo": 10.0, "margem": 25.0}
        r = client.post(f"{BASE_URL}/api/artigos", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["nome"] == payload["nome"]
        assert a["unidade"] == "un"
        assert a["margem"] == 25.0
        aid = a["id"]
        bag["artigos"].append(aid)

        upd = {**payload, "custo_artigo": 15.0, "margem": 40.0}
        r = client.put(f"{BASE_URL}/api/artigos/{aid}", json=upd)
        assert r.status_code == 200, r.text
        r = client.get(f"{BASE_URL}/api/artigos")
        found = next((x for x in r.json() if x["id"] == aid), None)
        assert found and found["custo_artigo"] == 15.0

        r = client.delete(f"{BASE_URL}/api/artigos/{aid}")
        assert r.status_code == 200
        bag["artigos"].remove(aid)

    # 5 — Orçamento: criar, editar preço unitário manual (feature core do refactor), converter
    def test_05_orcamento_create_edit_preco_convert(self, client, bag):
        artigo = _pick_artigo_with_roteiro(client)
        assert artigo, "Sem artigos no sistema"

        payload = {
            "cliente": "teste-cli-orc",
            "descricao": "teste-refactor",
            "linhas": [{
                "artigo_id": artigo["id"], "artigo_nome": artigo["nome"],
                "quantidade": 2, "personalizacoes": [], "roteiro": artigo.get("roteiro", []),
                "margem": artigo.get("margem") or 30,
            }],
        }
        r = client.post(f"{BASE_URL}/api/orcamentos", json=payload)
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]
        bag["orcamentos"].append(oid)
        assert orc.get("numero", "").startswith("ORC")
        assert orc["total"] > 0
        auto_preco = orc["linhas"][0]["preco_unit"]
        assert auto_preco > 0

        r = client.get(f"{BASE_URL}/api/orcamentos/{oid}")
        assert r.status_code == 200
        orc = r.json()

        # EDITAR preço unitário manual (feature: linha "Preço Unit." editável)
        novo_preco = round(auto_preco + 5.0, 2)
        orc["linhas"][0]["preco_unit"] = novo_preco
        orc["linhas"][0]["preco_unit_manual"] = True
        put_body = {k: orc[k] for k in ("cliente", "cliente_id", "descricao", "data", "validade", "status", "notas", "linhas", "materiais", "desconto_total", "desconto_total_tipo") if k in orc}
        r = client.put(f"{BASE_URL}/api/orcamentos/{oid}", json=put_body)
        assert r.status_code == 200, r.text
        orc2 = client.get(f"{BASE_URL}/api/orcamentos/{oid}").json()
        assert orc2["linhas"][0].get("preco_unit_manual") is True
        assert abs(orc2["linhas"][0]["preco_unit"] - novo_preco) < 0.01

        # RESET preço para automático (botão RotateCcw no UI)
        orc2["linhas"][0]["preco_unit_manual"] = False
        put_body = {k: orc2[k] for k in ("cliente", "cliente_id", "descricao", "data", "validade", "status", "notas", "linhas", "materiais", "desconto_total", "desconto_total_tipo") if k in orc2}
        r = client.put(f"{BASE_URL}/api/orcamentos/{oid}", json=put_body)
        assert r.status_code == 200
        orc3 = client.get(f"{BASE_URL}/api/orcamentos/{oid}").json()
        assert orc3["linhas"][0].get("preco_unit_manual") is False
        assert orc3["linhas"][0]["preco_unit"] > 0

        # CONVERTER em OF + Encomenda
        r = client.post(f"{BASE_URL}/api/orcamentos/{oid}/converter")
        assert r.status_code == 200, r.text
        of = r.json()
        assert of.get("numero", "").startswith("OF")
        assert of.get("orcamento_id") == oid
        assert of.get("encomenda_id")
        bag["ofs"].append(of["id"])
        bag["encomendas"].append(of["encomenda_id"])

        # OF persistiu com itens
        of_full = client.get(f"{BASE_URL}/api/ordens-fabrico/{of['id']}").json()
        assert len(of_full["itens"]) >= 1
        # Encomenda com OFs associadas + estado pagamento
        enc = client.get(f"{BASE_URL}/api/encomendas/{of['encomenda_id']}").json()
        assert enc["valor_total"] >= 0
        assert enc["status_pagamento"] in ("pendente", "parcial", "pago")
        assert any(o["id"] == of["id"] for o in enc.get("ordens_fabrico", []))

    # 6 — OF: nota da operação persiste (feature key do refactor)
    def test_06_of_nota_operacao_persiste(self, client, bag):
        assert bag["ofs"], "Sem OF (test_05 tem que passar antes)"
        ofid = bag["ofs"][0]
        of = client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        item = None; op = None
        for it in of["itens"]:
            if it.get("operacoes"):
                item = it; op = it["operacoes"][0]; break
        if not op:
            pytest.skip("OF sem operações")

        nota_txt = "teste-nota-refactor xyz"
        r = client.post(f"{BASE_URL}/api/ordens-fabrico/{ofid}/operacao/nota", json={
            "item_id": item["id"], "operacao_id": op["id"], "nota": nota_txt,
        })
        assert r.status_code == 200, r.text
        of2 = client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        op2 = next(o for it in of2["itens"] if it["id"] == item["id"] for o in it["operacoes"] if o["id"] == op["id"])
        assert op2.get("nota") == nota_txt

        # limpar
        r = client.post(f"{BASE_URL}/api/ordens-fabrico/{ofid}/operacao/nota", json={
            "item_id": item["id"], "operacao_id": op["id"], "nota": "",
        })
        assert r.status_code == 200

    # 7 — Timer da OF: iniciar/parar/toggle
    def test_07_of_timer(self, client, bag):
        assert bag["ofs"]
        ofid = bag["ofs"][0]
        of = client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()

        # autorizar produção (encomenda pendente bloqueia iniciar)
        enc_id = of.get("encomenda_id")
        if enc_id:
            enc = client.get(f"{BASE_URL}/api/encomendas/{enc_id}").json()
            enc["autorizada_producao"] = True
            put_body = {k: enc[k] for k in ("cliente", "cliente_id", "descricao", "data", "prazo_entrega", "estado", "notas", "desconto_total", "desconto_total_tipo", "artigos", "valor_total", "valor_total_manual", "valor_pago", "autorizada_producao") if k in enc}
            r = client.put(f"{BASE_URL}/api/encomendas/{enc_id}", json=put_body)
            assert r.status_code == 200, r.text

        item = None; op = None
        for it in of["itens"]:
            if it.get("operacoes"):
                item = it; op = it["operacoes"][0]; break
        if not op:
            pytest.skip("Sem operação")

        r = client.post(f"{BASE_URL}/api/ordens-fabrico/{ofid}/operacao/iniciar", json={
            "item_id": item["id"], "operacao_id": op["id"],
        })
        assert r.status_code == 200, r.text
        op2 = next(o for it in r.json()["itens"] if it["id"] == item["id"] for o in it["operacoes"] if o["id"] == op["id"])
        assert op2.get("timer_inicio")
        assert r.json().get("timer_estado") == "em_curso"

        r = client.post(f"{BASE_URL}/api/ordens-fabrico/{ofid}/operacao/parar", json={
            "item_id": item["id"], "operacao_id": op["id"],
        })
        assert r.status_code == 200
        op3 = next(o for it in r.json()["itens"] if it["id"] == item["id"] for o in it["operacoes"] if o["id"] == op["id"])
        assert not op3.get("timer_inicio")

        r = client.post(f"{BASE_URL}/api/ordens-fabrico/{ofid}/toggle-operacao", json={
            "item_id": item["id"], "operacao_id": op["id"], "concluida": True,
        })
        assert r.status_code == 200
        op4 = next(o for it in r.json()["itens"] if it["id"] == item["id"] for o in it["operacoes"] if o["id"] == op["id"])
        assert op4.get("concluida") is True

    # 8 — PDFs (application/pdf, começa com %PDF)
    def test_08_pdf_orcamento(self, client, bag):
        assert bag["orcamentos"]
        r = client.get(f"{BASE_URL}/api/orcamentos/{bag['orcamentos'][0]}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_09_pdf_of(self, client, bag):
        assert bag["ofs"]
        r = client.get(f"{BASE_URL}/api/ordens-fabrico/{bag['ofs'][0]}/pdf")
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_10_pdf_encomenda(self, client, bag):
        assert bag["encomendas"]
        r = client.get(f"{BASE_URL}/api/encomendas/{bag['encomendas'][0]}/pdf")
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    # 9 — Admin/RBAC
    def test_11_users_and_perfis(self, client):
        r = client.get(f"{BASE_URL}/api/users")
        assert r.status_code == 200, r.text
        users = r.json()
        assert any(u.get("email") == ADMIN_EMAIL for u in users), "admin não listado"

        r = client.get(f"{BASE_URL}/api/perfis")
        assert r.status_code == 200
        nomes = [p.get("nome") for p in r.json()]
        assert "Administrador" in nomes and "Colaborador" in nomes

    def test_12_users_forbidden_without_auth(self):
        r = requests.get(f"{BASE_URL}/api/users")
        assert r.status_code in (401, 403)
