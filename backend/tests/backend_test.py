"""Backend tests for Production Costing ERP (Fase 2 + Fase 3)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://budgeting-orders.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Phase 0: Health + Seed ----------
class TestHealthAndSeed:
    def test_root(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200

    def test_seed_idempotent(self, client):
        r = client.post(f"{API}/seed")
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # second call
        r2 = client.post(f"{API}/seed")
        assert r2.status_code == 200
        assert r2.json().get("ok") is True

    def test_dashboard(self, client):
        r = client.get(f"{API}/dashboard")
        assert r.status_code == 200
        data = r.json()
        for k in ["total_artigos", "total_maquinas", "total_tipos", "custo_medio",
                  "total_orcamentos", "valor_orcamentos", "orcamentos_aceites",
                  "total_ofs", "ofs_em_producao", "ofs_concluidas"]:
            assert k in data
        assert data["total_artigos"] >= 2
        assert data["total_maquinas"] >= 3
        assert data["total_tipos"] >= 3


# ---------- CRUD: Máquinas ----------
class TestMaquinas:
    def test_crud_maquina(self, client):
        r = client.post(f"{API}/maquinas", json={"nome": "TEST_Maquina", "custo_hora": 10.0})
        assert r.status_code == 200
        m = r.json()
        assert m["nome"] == "TEST_Maquina"
        assert m["custo_hora"] == 10.0
        mid = m["id"]

        r = client.get(f"{API}/maquinas")
        assert r.status_code == 200
        assert any(x["id"] == mid for x in r.json())

        r = client.put(f"{API}/maquinas/{mid}", json={"nome": "TEST_Maquina2", "custo_hora": 25.5})
        assert r.status_code == 200
        assert r.json()["custo_hora"] == 25.5

        r = client.delete(f"{API}/maquinas/{mid}")
        assert r.status_code == 200


# ---------- CRUD: Tipos Personalizacao ----------
class TestTipos:
    def test_crud_tipo(self, client):
        r = client.post(f"{API}/tipos-personalizacao", json={"nome": "TEST_Tipo", "descricao": "x"})
        assert r.status_code == 200
        tid = r.json()["id"]

        r = client.put(f"{API}/tipos-personalizacao/{tid}", json={"nome": "TEST_Tipo2", "descricao": "y"})
        assert r.status_code == 200
        assert r.json()["nome"] == "TEST_Tipo2"

        r = client.get(f"{API}/tipos-personalizacao")
        assert any(t["id"] == tid for t in r.json())

        r = client.delete(f"{API}/tipos-personalizacao/{tid}")
        assert r.status_code == 200


# ---------- CRUD: Artigos with computed custo_producao_total ----------
class TestArtigos:
    def test_artigo_with_roteiro_cost(self, client):
        # Create a machine 60 €/h
        mr = client.post(f"{API}/maquinas", json={"nome": "TEST_M60", "custo_hora": 60.0})
        assert mr.status_code == 200
        m = mr.json()

        payload = {
            "nome": "TEST_Artigo",
            "descricao": "test",
            "custo_materiais": 1.0,
            "custo_mao_obra": 2.0,
            "custo_overhead": 0.5,
            "roteiro": [
                {"nome": "Op1", "maquina_id": m["id"], "maquina_nome": m["nome"], "tempo_min": 30}
            ],
        }
        r = client.post(f"{API}/artigos", json=payload)
        assert r.status_code == 200
        a = r.json()
        # custo_producao_total = 1 + 2 + 0.5 + (30/60)*60 = 33.5
        assert a["custo_producao_total"] == pytest.approx(33.5, abs=0.01)
        aid = a["id"]

        # GET single
        rg = client.get(f"{API}/artigos/{aid}")
        assert rg.status_code == 200
        assert rg.json()["custo_producao_total"] == pytest.approx(33.5, abs=0.01)

        # cleanup
        client.delete(f"{API}/artigos/{aid}")
        client.delete(f"{API}/maquinas/{m['id']}")


# ---------- Orcamentos ----------
class TestOrcamentos:
    def test_orcamento_flow_and_convert(self, client):
        # Get first artigo
        ars = client.get(f"{API}/artigos").json()
        assert ars, "Need seeded artigos"
        artigo = ars[0]
        custo = artigo["custo_producao_total"]

        # Create orcamento
        payload = {
            "cliente": "TEST_Cliente",
            "margem": 50.0,
            "status": "rascunho",
            "linhas": [
                {"artigo_id": artigo["id"], "quantidade": 10}
            ],
        }
        r = client.post(f"{API}/orcamentos", json=payload)
        assert r.status_code == 200, r.text
        orc = r.json()
        assert orc["numero"].startswith("ORC-")
        parts = orc["numero"].split("-")
        assert len(parts) == 3 and len(parts[2]) == 4

        # totals
        expected_sub = round(custo * 10, 2)
        expected_total = round(expected_sub * 1.5, 2)
        assert orc["subtotal_custo"] == pytest.approx(expected_sub, abs=0.05)
        assert orc["total"] == pytest.approx(expected_total, abs=0.05)
        assert orc["linhas"][0]["custo_producao_unit"] == pytest.approx(custo, abs=0.01)

        oid = orc["id"]

        # Convert should fail (status rascunho)
        rc = client.post(f"{API}/orcamentos/{oid}/converter")
        assert rc.status_code == 400

        # Update to aceite
        orc["status"] = "aceite"
        # send only OrcamentoInput fields
        up = {
            "cliente": orc["cliente"],
            "data": orc.get("data"),
            "validade": orc.get("validade"),
            "status": "aceite",
            "margem": orc["margem"],
            "notas": orc.get("notas", ""),
            "linhas": orc["linhas"],
        }
        ru = client.put(f"{API}/orcamentos/{oid}", json=up)
        assert ru.status_code == 200
        assert ru.json()["status"] == "aceite"

        # Convert now succeeds
        rc2 = client.post(f"{API}/orcamentos/{oid}/converter")
        assert rc2.status_code == 200, rc2.text
        of = rc2.json()
        assert of["numero"].startswith("OF-")
        assert of["orcamento_id"] == oid
        # OF should have items inherited and operations auto-loaded
        assert len(of["itens"]) == 1
        # If artigo has roteiro, ops are auto-loaded
        if artigo.get("roteiro"):
            assert len(of["itens"][0]["operacoes"]) == len(artigo["roteiro"])
        assert of["status"] == "pendente"

        # Idempotency: converting again returns existing OF
        rc3 = client.post(f"{API}/orcamentos/{oid}/converter")
        assert rc3.status_code == 200
        assert rc3.json()["id"] == of["id"]

        # Verify orcamento has of_id/of_numero linked
        rg = client.get(f"{API}/orcamentos/{oid}").json()
        assert rg["of_id"] == of["id"]
        assert rg["of_numero"] == of["numero"]

        # Save for next test
        TestOrcamentos.of_id = of["id"]
        TestOrcamentos.orc_id = oid

    def test_404_orcamento(self, client):
        assert client.get(f"{API}/orcamentos/does-not-exist").status_code == 404
        assert client.post(f"{API}/orcamentos/does-not-exist/converter").status_code == 404


# ---------- Ordens de Fabrico ----------
class TestOrdensFabrico:
    def test_toggle_operacoes_status_progression(self, client):
        # Self-contained: create an OF with auto-loaded roteiro from a seeded artigo
        ars = client.get(f"{API}/artigos").json()
        artigo = next((a for a in ars if a.get("roteiro")), ars[0])
        cr = client.post(
            f"{API}/ordens-fabrico",
            json={"cliente": "TEST_Toggle", "itens": [{"artigo_id": artigo["id"], "quantidade": 1}]},
        )
        assert cr.status_code == 200
        of_id = cr.json()["id"]

        of = client.get(f"{API}/ordens-fabrico/{of_id}").json()
        item = of["itens"][0]
        ops = item["operacoes"]
        assert len(ops) >= 1

        # Toggle first op -> em_producao (if more than 1 op) else concluido
        r = client.post(
            f"{API}/ordens-fabrico/{of_id}/toggle-operacao",
            json={"item_id": item["id"], "operacao_id": ops[0]["id"], "concluida": True},
        )
        assert r.status_code == 200
        after = r.json()
        if len(ops) > 1:
            assert after["status"] == "em_producao"
            assert 0 < after["progresso"] < 100
        else:
            assert after["status"] == "concluido"

        # Toggle all ops -> concluido
        for op in ops:
            client.post(
                f"{API}/ordens-fabrico/{of_id}/toggle-operacao",
                json={"item_id": item["id"], "operacao_id": op["id"], "concluida": True},
            )
        final = client.get(f"{API}/ordens-fabrico/{of_id}").json()
        assert final["status"] == "concluido"
        assert final["progresso"] == 100

        # Toggle one back -> em_producao
        if len(ops) > 1:
            client.post(
                f"{API}/ordens-fabrico/{of_id}/toggle-operacao",
                json={"item_id": item["id"], "operacao_id": ops[0]["id"], "concluida": False},
            )
            after2 = client.get(f"{API}/ordens-fabrico/{of_id}").json()
            assert after2["status"] == "em_producao"

    def test_create_of_manual_auto_roteiro(self, client):
        ars = client.get(f"{API}/artigos").json()
        artigo = ars[0]
        r = client.post(
            f"{API}/ordens-fabrico",
            json={
                "cliente": "TEST_OF_Cli",
                "itens": [{"artigo_id": artigo["id"], "quantidade": 2}],
            },
        )
        assert r.status_code == 200
        of = r.json()
        assert of["numero"].startswith("OF-")
        if artigo.get("roteiro"):
            assert len(of["itens"][0]["operacoes"]) == len(artigo["roteiro"])
        # cleanup
        client.delete(f"{API}/ordens-fabrico/{of['id']}")

    def test_of_numbering_per_year(self, client):
        ofs = client.get(f"{API}/ordens-fabrico").json()
        if ofs:
            year_part = ofs[0]["numero"].split("-")[1]
            assert len(year_part) == 4 and year_part.isdigit()


# ---------- Cleanup test orcamentos at end ----------
def test_cleanup(client=None):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    orcs = s.get(f"{API}/orcamentos").json()
    for o in orcs:
        if str(o.get("cliente", "")).startswith("TEST_"):
            if o.get("of_id"):
                s.delete(f"{API}/ordens-fabrico/{o['of_id']}")
            s.delete(f"{API}/orcamentos/{o['id']}")
