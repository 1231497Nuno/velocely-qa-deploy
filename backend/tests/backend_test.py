"""Backend tests for Production Costing ERP - Iteration 2 (Materiais + Mão de Obra + new Artigo model)."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # ensure seed
    s.post(f"{API}/seed")
    return s


# ---------- Health + Seed ----------
class TestHealthAndSeed:
    def test_root(self, client):
        assert client.get(f"{API}/").status_code == 200

    def test_seed_idempotent(self, client):
        r1 = client.post(f"{API}/seed")
        r2 = client.post(f"{API}/seed")
        assert r1.status_code == 200 and r2.status_code == 200

    def test_dashboard(self, client):
        r = client.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["total_artigos", "total_maquinas", "total_tipos", "custo_medio",
                  "total_orcamentos", "valor_orcamentos", "total_ofs"]:
            assert k in d


# ---------- CRUD: Consumiveis ----------
class TestConsumiveis:
    def test_crud(self, client):
        r = client.post(f"{API}/consumiveis", json={"nome": "TEST_Mat", "unidade": "ml", "custo_unitario": 0.5})
        assert r.status_code == 200
        c = r.json()
        assert c["nome"] == "TEST_Mat"
        assert c["unidade"] == "ml"
        assert c["custo_unitario"] == 0.5
        cid = c["id"]

        rl = client.get(f"{API}/consumiveis")
        assert any(x["id"] == cid for x in rl.json())

        ru = client.put(f"{API}/consumiveis/{cid}", json={"nome": "TEST_Mat2", "unidade": "g", "custo_unitario": 1.25})
        assert ru.status_code == 200
        assert ru.json()["custo_unitario"] == 1.25

        assert client.delete(f"{API}/consumiveis/{cid}").status_code == 200


# ---------- CRUD: Mao de Obra ----------
class TestMaoObra:
    def test_crud(self, client):
        r = client.post(f"{API}/mao-obra", json={"nome": "TEST_MO", "custo_hora": 15.0})
        assert r.status_code == 200
        m = r.json()
        assert m["nome"] == "TEST_MO"
        assert m["custo_hora"] == 15.0
        mid = m["id"]

        rl = client.get(f"{API}/mao-obra")
        assert any(x["id"] == mid for x in rl.json())

        ru = client.put(f"{API}/mao-obra/{mid}", json={"nome": "TEST_MO2", "custo_hora": 22.5})
        assert ru.status_code == 200
        assert ru.json()["custo_hora"] == 22.5

        assert client.delete(f"{API}/mao-obra/{mid}").status_code == 200


# ---------- New Artigo model: materiais + roteiro + computed breakdown ----------
class TestArtigosNewModel:
    def test_seeded_dtf_uv_breakdown(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf_uv = next((a for a in artigos if a["nome"] == "DTF UV"), None)
        assert dtf_uv, "DTF UV seeded artigo expected"
        # 1 filme @ 1.20 + 5 ml @ 0.08 = 1.20 + 0.40 = 1.60
        assert dtf_uv["custo_materiais"] == pytest.approx(1.60, abs=0.01)
        # Impressao: 4min @ 20€/h = 1.333..., Prensagem: 2min @ 12€/h = 0.4 -> 1.73
        assert dtf_uv["custo_maquinas"] == pytest.approx(1.73, abs=0.02)
        # Mão de obra 6 min @ 12€/h = 1.20
        assert dtf_uv["custo_mao_obra"] == pytest.approx(1.20, abs=0.02)
        assert dtf_uv["custo_producao_total"] == pytest.approx(4.53, abs=0.05)

    def test_create_artigo_with_materiais_roteiro(self, client):
        # Create deps
        mat = client.post(f"{API}/consumiveis", json={"nome": "TEST_C", "unidade": "un", "custo_unitario": 2.0}).json()
        maq = client.post(f"{API}/maquinas", json={"nome": "TEST_MQ", "custo_hora": 60.0}).json()
        mo = client.post(f"{API}/mao-obra", json={"nome": "TEST_MOA", "custo_hora": 30.0}).json()

        payload = {
            "nome": "TEST_Art",
            "descricao": "x",
            "materiais": [
                {"material_id": mat["id"], "material_nome": mat["nome"], "unidade": mat["unidade"],
                 "quantidade": 3, "custo_unitario": 2.0}
            ],
            "roteiro": [
                {"nome": "Op", "maquina_id": maq["id"], "maquina_nome": maq["nome"], "min_maquina": 30,
                 "mao_obra_id": mo["id"], "mao_obra_nome": mo["nome"], "min_mao_obra": 60}
            ],
        }
        r = client.post(f"{API}/artigos", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        # 3*2 = 6 mat; 30/60*60 = 30 maq; 60/60*30 = 30 mo -> 66
        assert a["custo_materiais"] == pytest.approx(6.0, abs=0.01)
        assert a["custo_maquinas"] == pytest.approx(30.0, abs=0.01)
        assert a["custo_mao_obra"] == pytest.approx(30.0, abs=0.01)
        assert a["custo_producao_total"] == pytest.approx(66.0, abs=0.05)

        aid = a["id"]
        # GET enrichment
        rg = client.get(f"{API}/artigos/{aid}").json()
        assert rg["custo_producao_total"] == pytest.approx(66.0, abs=0.05)

        # PUT update quantity
        payload2 = dict(payload)
        payload2["materiais"] = [{**payload["materiais"][0], "quantidade": 5}]
        ru = client.put(f"{API}/artigos/{aid}", json=payload2)
        assert ru.status_code == 200
        assert ru.json()["custo_materiais"] == pytest.approx(10.0, abs=0.01)

        # cleanup
        client.delete(f"{API}/artigos/{aid}")
        client.delete(f"{API}/consumiveis/{mat['id']}")
        client.delete(f"{API}/maquinas/{maq['id']}")
        client.delete(f"{API}/mao-obra/{mo['id']}")


# ---------- Orcamento integration with new model ----------
class TestOrcamentoIntegration:
    def test_line_autofill_from_artigo(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf = next((a for a in artigos if a["nome"] == "DTF UV"), artigos[0])
        expected_unit = dtf["custo_producao_total"]

        payload = {
            "cliente": "TEST_OrcInt",
            "margem": 50.0,
            "status": "rascunho",
            "linhas": [{"artigo_id": dtf["id"], "quantidade": 10}],
        }
        r = client.post(f"{API}/orcamentos", json=payload)
        assert r.status_code == 200, r.text
        orc = r.json()
        assert orc["linhas"][0]["custo_producao_unit"] == pytest.approx(expected_unit, abs=0.01)
        expected_sub = round(expected_unit * 10, 2)
        assert orc["subtotal_custo"] == pytest.approx(expected_sub, abs=0.05)
        assert orc["total"] == pytest.approx(round(expected_sub * 1.5, 2), abs=0.05)
        assert orc["numero"].startswith("ORC-")
        # cleanup
        client.delete(f"{API}/orcamentos/{orc['id']}")

    def test_convert_orcamento_to_of_with_roteiro(self, client):
        artigos = client.get(f"{API}/artigos").json()
        artigo = next((a for a in artigos if a.get("roteiro")), artigos[0])
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "TEST_Conv", "margem": 30.0, "status": "aceite",
            "linhas": [{"artigo_id": artigo["id"], "quantidade": 1}],
        })
        oid = r.json()["id"]
        rc = client.post(f"{API}/orcamentos/{oid}/converter")
        assert rc.status_code == 200, rc.text
        of = rc.json()
        assert of["numero"].startswith("OF-")
        ops = of["itens"][0]["operacoes"]
        assert len(ops) == len(artigo["roteiro"])
        # tempo_min should equal min_maquina + min_mao_obra
        for src, dst in zip(artigo["roteiro"], ops):
            assert dst["tempo_min"] == pytest.approx((src.get("min_maquina") or 0) + (src.get("min_mao_obra") or 0))
            assert dst.get("maquina_nome") == src.get("maquina_nome")
            assert dst.get("mao_obra_nome") == src.get("mao_obra_nome")
        # cleanup
        client.delete(f"{API}/ordens-fabrico/{of['id']}")
        client.delete(f"{API}/orcamentos/{oid}")


# ---------- OF toggle regression ----------
class TestOFToggle:
    def test_toggle_progression(self, client):
        artigos = client.get(f"{API}/artigos").json()
        artigo = next((a for a in artigos if a.get("roteiro")), artigos[0])
        cr = client.post(f"{API}/ordens-fabrico", json={
            "cliente": "TEST_Tog", "itens": [{"artigo_id": artigo["id"], "quantidade": 1}],
        })
        of = cr.json()
        item = of["itens"][0]
        ops = item["operacoes"]
        assert len(ops) >= 2

        client.post(f"{API}/ordens-fabrico/{of['id']}/toggle-operacao",
                    json={"item_id": item["id"], "operacao_id": ops[0]["id"], "concluida": True})
        after = client.get(f"{API}/ordens-fabrico/{of['id']}").json()
        assert after["status"] == "em_producao"

        for op in ops:
            client.post(f"{API}/ordens-fabrico/{of['id']}/toggle-operacao",
                        json={"item_id": item["id"], "operacao_id": op["id"], "concluida": True})
        final = client.get(f"{API}/ordens-fabrico/{of['id']}").json()
        assert final["status"] == "concluido"
        assert final["progresso"] == 100
        client.delete(f"{API}/ordens-fabrico/{of['id']}")


# ---------- Cleanup ----------
def test_zz_cleanup():
    s = requests.Session()
    for orc in s.get(f"{API}/orcamentos").json():
        if str(orc.get("cliente", "")).startswith("TEST_"):
            if orc.get("of_id"):
                s.delete(f"{API}/ordens-fabrico/{orc['of_id']}")
            s.delete(f"{API}/orcamentos/{orc['id']}")
