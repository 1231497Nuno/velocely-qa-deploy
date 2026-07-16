"""Backend tests for Production Costing ERP - Iteration 3
New: máquinas have custo_amortizacao_hora + custo_energia_hora; operações use
tempo_maquina + tempo_maquina_unidade + tempo_mao_obra + tempo_mao_obra_unidade;
Artigo has margem and returns preco_venda.
"""
import pytest
import requests
from conftest import get_base_url

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
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
        for k in ["total_artigos", "total_maquinas", "total_tipos", "custo_medio"]:
            assert k in d


# ---------- Máquinas with new amort+energia fields ----------
class TestMaquinasNewFields:
    def test_seeded_machines_have_split_costs(self, client):
        ms = client.get(f"{API}/maquinas").json()
        nomes = {m["nome"] for m in ms}
        assert {"Impressora DTF UV", "Prensa Térmica", "Plotter de Corte"}.issubset(nomes)
        dtf = next(m for m in ms if m["nome"] == "Impressora DTF UV")
        assert dtf["custo_amortizacao_hora"] == pytest.approx(14.0)
        assert dtf["custo_energia_hora"] == pytest.approx(6.0)

    def test_crud_with_new_fields(self, client):
        body = {"nome": "TEST_MQ", "custo_amortizacao_hora": 12.5, "custo_energia_hora": 7.5}
        r = client.post(f"{API}/maquinas", json=body)
        assert r.status_code == 200
        m = r.json()
        assert m["custo_amortizacao_hora"] == 12.5
        assert m["custo_energia_hora"] == 7.5
        mid = m["id"]

        # GET verifies persistence
        ms = client.get(f"{API}/maquinas").json()
        got = next((x for x in ms if x["id"] == mid), None)
        assert got is not None
        assert got["custo_amortizacao_hora"] == 12.5
        assert got["custo_energia_hora"] == 7.5

        # PUT
        ru = client.put(f"{API}/maquinas/{mid}",
                        json={"nome": "TEST_MQ2", "custo_amortizacao_hora": 5, "custo_energia_hora": 2})
        assert ru.status_code == 200
        assert ru.json()["custo_amortizacao_hora"] == 5
        assert ru.json()["custo_energia_hora"] == 2

        assert client.delete(f"{API}/maquinas/{mid}").status_code == 200


# ---------- Artigo cost calc with new model: unidades + margem + preco_venda ----------
class TestArtigosNewModel:
    def test_seeded_dtf_uv_breakdown_and_preco_venda(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf_uv = next((a for a in artigos if a["nome"] == "DTF UV"), None)
        assert dtf_uv, "DTF UV seeded artigo expected"
        assert dtf_uv["custo_materiais"] == pytest.approx(1.60, abs=0.01)
        assert dtf_uv["custo_maquinas"] == pytest.approx(1.73, abs=0.02)
        assert dtf_uv["custo_mao_obra"] == pytest.approx(1.20, abs=0.02)
        assert dtf_uv["custo_producao_total"] == pytest.approx(4.53, abs=0.05)
        assert dtf_uv["margem"] == pytest.approx(40.0)
        # 4.53 * 1.40 = 6.342 -> 6.34
        assert dtf_uv["preco_venda"] == pytest.approx(6.34, abs=0.02)

    def test_seeded_dtf_textil_breakdown_and_preco_venda(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf_t = next((a for a in artigos if a["nome"] == "DTF Têxtil"), None)
        assert dtf_t
        assert dtf_t["custo_producao_total"] == pytest.approx(2.80, abs=0.05)
        assert dtf_t["margem"] == pytest.approx(35.0)
        # 2.80 * 1.35 = 3.78
        assert dtf_t["preco_venda"] == pytest.approx(3.78, abs=0.02)

    def test_hour_unit_counts_as_full_hour(self, client):
        """1h on a 20€/h machine should yield 20€."""
        maq = client.post(f"{API}/maquinas",
                          json={"nome": "TEST_MQH", "custo_amortizacao_hora": 15, "custo_energia_hora": 5}).json()
        mo = client.post(f"{API}/mao-obra", json={"nome": "TEST_MOH", "custo_hora": 10}).json()
        payload = {
            "nome": "TEST_ArtH",
            "margem": 50.0,
            "materiais": [],
            "roteiro": [{
                "nome": "Op1", "maquina_id": maq["id"], "maquina_nome": maq["nome"],
                "tempo_maquina": 1, "tempo_maquina_unidade": "h",
                "mao_obra_id": mo["id"], "mao_obra_nome": mo["nome"],
                "tempo_mao_obra": 30, "tempo_mao_obra_unidade": "min",
            }],
        }
        r = client.post(f"{API}/artigos", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["custo_maquinas"] == pytest.approx(20.0, abs=0.01)
        assert a["custo_mao_obra"] == pytest.approx(5.0, abs=0.01)  # 0.5h * 10 = 5
        assert a["custo_producao_total"] == pytest.approx(25.0, abs=0.01)
        # margem 50% -> 25 * 1.5 = 37.5
        assert a["preco_venda"] == pytest.approx(37.5, abs=0.02)

        # PUT changes unit min->h on labor and verify recompute
        payload2 = dict(payload)
        payload2["roteiro"] = [dict(payload["roteiro"][0])]
        payload2["roteiro"][0]["tempo_mao_obra"] = 1
        payload2["roteiro"][0]["tempo_mao_obra_unidade"] = "h"
        ru = client.put(f"{API}/artigos/{a['id']}", json=payload2)
        assert ru.json()["custo_mao_obra"] == pytest.approx(10.0, abs=0.01)
        assert ru.json()["custo_producao_total"] == pytest.approx(30.0, abs=0.01)
        assert ru.json()["preco_venda"] == pytest.approx(45.0, abs=0.02)

        client.delete(f"{API}/artigos/{a['id']}")
        client.delete(f"{API}/maquinas/{maq['id']}")
        client.delete(f"{API}/mao-obra/{mo['id']}")


# ---------- Orcamento regression: still pulls custo_producao_unit from artigo ----------
class TestOrcamentoRegression:
    def test_line_autofill_unit(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf = next((a for a in artigos if a["nome"] == "DTF UV"), artigos[0])
        expected_unit = dtf["custo_producao_total"]
        r = client.post(f"{API}/orcamentos", json={
            "cliente": "TEST_OrcInt", "margem": 50.0, "status": "rascunho",
            "linhas": [{"artigo_id": dtf["id"], "quantidade": 10}],
        })
        assert r.status_code == 200, r.text
        orc = r.json()
        assert orc["linhas"][0]["custo_producao_unit"] == pytest.approx(expected_unit, abs=0.01)
        assert orc["subtotal_custo"] == pytest.approx(round(expected_unit * 10, 2), abs=0.05)
        assert orc["total"] == pytest.approx(round(expected_unit * 10 * 1.5, 2), abs=0.05)
        assert orc["numero"].startswith("ORC-")
        client.delete(f"{API}/orcamentos/{orc['id']}")

    def test_convert_to_of_loads_roteiro(self, client):
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


# ---------- Cleanup TEST_ leftovers ----------
def test_zz_cleanup():
    s = requests.Session()
    for orc in s.get(f"{API}/orcamentos").json():
        if str(orc.get("cliente", "")).startswith("TEST_"):
            if orc.get("of_id"):
                s.delete(f"{API}/ordens-fabrico/{orc['of_id']}")
            s.delete(f"{API}/orcamentos/{orc['id']}")
