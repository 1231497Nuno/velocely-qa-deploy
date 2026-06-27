"""Backend tests for Production Costing ERP - Iteration 4

New surfaces:
- TipoPersonalizacao.valor (€/unidade)
- Orcamento.descricao + numero_encomenda + linha.valor_personalizacao
- compute_orcamento_totais: subtotal_custo, total_personalizacao, total, lucro
- OrdemFabrico.descricao + numero_encomenda
- converter_orcamento copies descricao + numero_encomenda
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.post(f"{API}/seed")
    return s


# ---------- Tipos de Personalização: valor field ----------
class TestTipoPersonalizacaoValor:
    def test_create_with_valor(self, client):
        body = {"nome": "TEST_TipoV", "descricao": "Tipo com valor", "valor": 2.5}
        r = client.post(f"{API}/tipos-personalizacao", json=body)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["valor"] == pytest.approx(2.5)
        tid = t["id"]

        # GET verifies persistence
        ts = client.get(f"{API}/tipos-personalizacao").json()
        got = next((x for x in ts if x["id"] == tid), None)
        assert got is not None
        assert got["valor"] == pytest.approx(2.5)

        # PUT updates valor
        ru = client.put(f"{API}/tipos-personalizacao/{tid}",
                        json={"nome": "TEST_TipoV2", "descricao": "x", "valor": 4.75})
        assert ru.status_code == 200
        assert ru.json()["valor"] == pytest.approx(4.75)

        ts2 = client.get(f"{API}/tipos-personalizacao").json()
        got2 = next((x for x in ts2 if x["id"] == tid), None)
        assert got2["valor"] == pytest.approx(4.75)

        client.delete(f"{API}/tipos-personalizacao/{tid}")


# ---------- Orçamento: descricao, numero_encomenda, valor_personalizacao, totals ----------
class TestOrcamentoIteration4:
    def test_create_orcamento_with_new_fields_and_totals(self, client):
        artigos = client.get(f"{API}/artigos").json()
        dtf = next((a for a in artigos if a["nome"] == "DTF UV"), artigos[0])
        unit = dtf["custo_producao_total"]  # e.g. 4.53
        pers_val = 2.5
        qtd = 10
        margem = 50.0

        payload = {
            "cliente": "TEST_OrcI4",
            "descricao": "Etiquetas para vinhos",
            "numero_encomenda": "ENC-9001",
            "status": "rascunho",
            "margem": margem,
            "linhas": [{
                "artigo_id": dtf["id"],
                "quantidade": qtd,
                "tipo_personalizacao_id": None,
                "tipo_personalizacao_nome": None,
                "valor_personalizacao": pers_val,
            }],
        }
        r = client.post(f"{API}/orcamentos", json=payload)
        assert r.status_code == 200, r.text
        orc = r.json()

        # persistence of new fields
        assert orc["descricao"] == "Etiquetas para vinhos"
        assert orc["numero_encomenda"] == "ENC-9001"
        assert orc["linhas"][0]["valor_personalizacao"] == pytest.approx(pers_val)

        # totals math: subtotal_custo + total_personalizacao -> *(1+margem/100)
        exp_subtotal = round(unit * qtd, 2)
        exp_pers = round(pers_val * qtd, 2)
        exp_base = exp_subtotal + exp_pers
        exp_total = round(exp_base * (1 + margem / 100.0), 2)
        exp_lucro = round(exp_total - exp_base, 2)

        assert orc["subtotal_custo"] == pytest.approx(exp_subtotal, abs=0.05)
        assert orc["total_personalizacao"] == pytest.approx(exp_pers, abs=0.05)
        assert orc["total"] == pytest.approx(exp_total, abs=0.05)
        assert orc["lucro"] == pytest.approx(exp_lucro, abs=0.05)

        # GET verifies persistence + recomputes totals
        g = client.get(f"{API}/orcamentos/{orc['id']}").json()
        assert g["descricao"] == "Etiquetas para vinhos"
        assert g["numero_encomenda"] == "ENC-9001"
        assert g["linhas"][0]["valor_personalizacao"] == pytest.approx(pers_val)
        assert g["total"] == pytest.approx(exp_total, abs=0.05)

        # PUT updates descricao/encomenda/valor_personalizacao
        new_payload = {**payload, "descricao": "Atualizada", "numero_encomenda": "ENC-9002"}
        new_payload["linhas"] = [dict(payload["linhas"][0])]
        new_payload["linhas"][0]["valor_personalizacao"] = 3.0
        ru = client.put(f"{API}/orcamentos/{orc['id']}", json=new_payload)
        assert ru.status_code == 200, ru.text
        uorc = ru.json()
        assert uorc["descricao"] == "Atualizada"
        assert uorc["numero_encomenda"] == "ENC-9002"
        assert uorc["linhas"][0]["valor_personalizacao"] == pytest.approx(3.0)
        exp_pers2 = round(3.0 * qtd, 2)
        assert uorc["total_personalizacao"] == pytest.approx(exp_pers2, abs=0.05)

        client.delete(f"{API}/orcamentos/{orc['id']}")

    def test_concrete_example_from_brief(self, client):
        """Brief example: 2.5 * 10 = 25 added to base, then margin."""
        artigos = client.get(f"{API}/artigos").json()
        artigo = artigos[0]
        unit = artigo["custo_producao_total"]
        payload = {
            "cliente": "TEST_Brief",
            "descricao": "d",
            "numero_encomenda": "n",
            "status": "rascunho",
            "margem": 0.0,  # zero margin to isolate
            "linhas": [{
                "artigo_id": artigo["id"],
                "quantidade": 10,
                "valor_personalizacao": 2.5,
            }],
        }
        r = client.post(f"{API}/orcamentos", json=payload)
        orc = r.json()
        assert orc["total_personalizacao"] == pytest.approx(25.0, abs=0.05)
        assert orc["total"] == pytest.approx(round(unit * 10 + 25.0, 2), abs=0.05)
        assert orc["lucro"] == pytest.approx(0.0, abs=0.05)  # zero margin
        client.delete(f"{API}/orcamentos/{orc['id']}")


# ---------- OF: descricao + numero_encomenda ----------
class TestOrdemFabricoIteration4:
    def test_of_persists_new_fields(self, client):
        artigos = client.get(f"{API}/artigos").json()
        artigo = artigos[0]
        payload = {
            "cliente": "TEST_OF4",
            "descricao": "Produzir 100 etiquetas",
            "numero_encomenda": "ENC-7777",
            "status": "pendente",
            "itens": [{"artigo_id": artigo["id"], "quantidade": 1}],
        }
        r = client.post(f"{API}/ordens-fabrico", json=payload)
        assert r.status_code == 200, r.text
        of = r.json()
        assert of["descricao"] == "Produzir 100 etiquetas"
        assert of["numero_encomenda"] == "ENC-7777"

        # GET verifies persistence
        g = client.get(f"{API}/ordens-fabrico/{of['id']}").json()
        assert g["descricao"] == "Produzir 100 etiquetas"
        assert g["numero_encomenda"] == "ENC-7777"

        # PUT update
        upd = {**payload, "descricao": "Editada", "numero_encomenda": "ENC-7778"}
        ru = client.put(f"{API}/ordens-fabrico/{of['id']}", json=upd)
        assert ru.json()["descricao"] == "Editada"
        assert ru.json()["numero_encomenda"] == "ENC-7778"

        client.delete(f"{API}/ordens-fabrico/{of['id']}")


# ---------- Conversion: descricao + numero_encomenda carry over ----------
class TestConversionCarriesFields:
    def test_converter_carries_descricao_encomenda(self, client):
        artigos = client.get(f"{API}/artigos").json()
        artigo = next((a for a in artigos if a.get("roteiro")), artigos[0])
        body = {
            "cliente": "TEST_ConvI4",
            "descricao": "Encomenda especial",
            "numero_encomenda": "ENC-CARRY",
            "status": "aceite",
            "margem": 20.0,
            "linhas": [{
                "artigo_id": artigo["id"], "quantidade": 2,
                "valor_personalizacao": 1.5,
            }],
        }
        r = client.post(f"{API}/orcamentos", json=body)
        oid = r.json()["id"]

        rc = client.post(f"{API}/orcamentos/{oid}/converter")
        assert rc.status_code == 200, rc.text
        of = rc.json()
        assert of["descricao"] == "Encomenda especial"
        assert of["numero_encomenda"] == "ENC-CARRY"
        assert of["cliente"] == "TEST_ConvI4"
        # Verify roteiro auto-loaded
        assert of["itens"] and of["itens"][0]["operacoes"]

        client.delete(f"{API}/ordens-fabrico/{of['id']}")
        client.delete(f"{API}/orcamentos/{oid}")


# ---------- Cleanup ----------
def test_zz_cleanup_iter4():
    s = requests.Session()
    for orc in s.get(f"{API}/orcamentos").json():
        if str(orc.get("cliente", "")).startswith("TEST_"):
            if orc.get("of_id"):
                s.delete(f"{API}/ordens-fabrico/{orc['of_id']}")
            s.delete(f"{API}/orcamentos/{orc['id']}")
    for of in s.get(f"{API}/ordens-fabrico").json():
        if str(of.get("cliente", "")).startswith("TEST_"):
            s.delete(f"{API}/ordens-fabrico/{of['id']}")
    for t in s.get(f"{API}/tipos-personalizacao").json():
        if str(t.get("nome", "")).startswith("TEST_"):
            s.delete(f"{API}/tipos-personalizacao/{t['id']}")
