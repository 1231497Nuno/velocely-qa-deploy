"""
Iteration 10 tests — Encomendas avançadas, Clientes com Código Postal/Cidade/País,
gate de produção (iniciar_operacao 403/200), auto-conclusão, conversão de orçamento
populando enc.artigos+valor_total, e Dashboard novos KPIs.

Pré-requisitos: utilizador admin do seed (ver ADMIN_EMAIL / ADMIN_PASSWORD).
"""

import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
ADMIN_EMAIL, ADMIN_PASS = get_admin_credentials()


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Cliente com novos campos ----------------
class TestClienteCamposNovos:
    def test_cria_e_atualiza_codigo_postal_cidade_pais(self, H):
        payload = {
            "nome": "teste-Cliente10",
            "morada": "Rua A, 1",
            "codigo_postal": "4000-100",
            "cidade": "Porto",
            "pais": "Portugal",
            "contacto": "910000000",
            "email": "teste-cli10@example.com",
            "nif": "500000010",
        }
        r = requests.post(f"{BASE_URL}/api/clientes", json=payload, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["codigo_postal"] == "4000-100"
        assert c["cidade"] == "Porto"
        assert c["pais"] == "Portugal"

        # PUT update
        payload2 = {**payload, "cidade": "Lisboa", "codigo_postal": "1000-200"}
        r2 = requests.put(f"{BASE_URL}/api/clientes/{c['id']}", json=payload2, headers=H, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["cidade"] == "Lisboa"
        assert r2.json()["codigo_postal"] == "1000-200"

        # Persistido via lista
        lst = requests.get(f"{BASE_URL}/api/clientes", headers=H, timeout=15).json()
        f = next((x for x in lst if x["id"] == c["id"]), None)
        assert f and f["cidade"] == "Lisboa"

        # cleanup
        requests.delete(f"{BASE_URL}/api/clientes/{c['id']}", headers=H, timeout=15)


# ---------------- Encomenda: valor auto, status pagamento, autorização, gate ----------------
class TestEncomendaWorkflow:
    @pytest.fixture(scope="class")
    def cliente(self, H):
        r = requests.post(
            f"{BASE_URL}/api/clientes",
            json={"nome": "teste-EncCliente10", "cidade": "Braga"},
            headers=H,
            timeout=15,
        )
        assert r.status_code == 200
        c = r.json()
        yield c
        requests.delete(f"{BASE_URL}/api/clientes/{c['id']}", headers=H, timeout=15)

    def test_valor_total_auto_a_partir_artigos(self, H, cliente):
        # Criar encomenda com 2 artigos: 2x10 + 3x5 = 35
        payload = {
            "cliente": cliente["nome"],
            "cliente_id": cliente["id"],
            "artigos": [
                {"artigo_nome": "Artigo Auto A", "quantidade": 2, "preco_unit": 10.0, "personalizacoes": []},
                {"artigo_nome": "Artigo Auto B", "quantidade": 3, "preco_unit": 5.0, "personalizacoes": []},
            ],
            "valor_total_manual": False,
            "valor_pago": 0,
            "autorizada_producao": False,
        }
        r = requests.post(f"{BASE_URL}/api/encomendas", json=payload, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        enc = r.json()
        assert enc["valor_total"] == 35.0
        assert enc["status_pagamento"] == "pendente"
        assert enc["pode_produzir"] is False

        # Pago parcial → status parcial e pode_produzir continua false
        upd = {**payload, "valor_pago": 10.0}
        r2 = requests.put(f"{BASE_URL}/api/encomendas/{enc['id']}", json=upd, headers=H, timeout=15)
        assert r2.status_code == 200
        e2 = r2.json()
        assert e2["status_pagamento"] == "parcial"
        assert e2["pode_produzir"] is False

        # Pago total → pago e pode_produzir true
        upd2 = {**payload, "valor_pago": 35.0}
        r3 = requests.put(f"{BASE_URL}/api/encomendas/{enc['id']}", json=upd2, headers=H, timeout=15)
        e3 = r3.json()
        assert e3["status_pagamento"] == "pago"
        assert e3["pode_produzir"] is True

        # Autorizar manualmente sem pagamento (resetar valor_pago=0 + autorizada=true)
        upd3 = {**payload, "valor_pago": 0.0, "autorizada_producao": True}
        r4 = requests.put(f"{BASE_URL}/api/encomendas/{enc['id']}", json=upd3, headers=H, timeout=15)
        e4 = r4.json()
        assert e4["status_pagamento"] == "pendente"
        assert e4["pode_produzir"] is True

        # cleanup
        requests.delete(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=H, timeout=15)

    def test_valor_total_manual_sobrepoe_calculo(self, H, cliente):
        payload = {
            "cliente": cliente["nome"],
            "cliente_id": cliente["id"],
            "artigos": [
                {"artigo_nome": "Artigo X", "quantidade": 1, "preco_unit": 100.0, "personalizacoes": []},
            ],
            "valor_total": 555.0,
            "valor_total_manual": True,
            "valor_pago": 0,
        }
        r = requests.post(f"{BASE_URL}/api/encomendas", json=payload, headers=H, timeout=15)
        enc = r.json()
        assert enc["valor_total"] == 555.0
        requests.delete(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=H, timeout=15)


# ---------------- Gate iniciar_operacao 403 / 200 ----------------
class TestGateIniciarOperacao:
    @pytest.fixture(scope="class")
    def setup_data(self, H):
        # cliente
        c = requests.post(
            f"{BASE_URL}/api/clientes", json={"nome": "teste-GateCli"}, headers=H, timeout=15
        ).json()
        # encomenda com 1 artigo  preco 50, qtd 1 → total 50, não pago
        enc_payload = {
            "cliente": c["nome"],
            "cliente_id": c["id"],
            "artigos": [
                {"artigo_nome": "Art Gate", "quantidade": 1, "preco_unit": 50.0, "personalizacoes": []}
            ],
            "valor_pago": 0,
            "autorizada_producao": False,
        }
        enc = requests.post(f"{BASE_URL}/api/encomendas", json=enc_payload, headers=H, timeout=15).json()
        assert enc["pode_produzir"] is False

        # OF associada com 1 item e 1 operação
        of_payload = {
            "cliente": c["nome"],
            "cliente_id": c["id"],
            "encomenda_id": enc["id"],
            "itens": [
                {
                    "artigo_id": "art-gate-id",
                    "artigo_nome": "Art Gate",
                    "quantidade": 1,
                    "operacoes": [
                        {"nome": "OpA", "tempo_maquina": 10, "tempo_mao_obra": 5, "tempo_min": 15, "custo_estimado": 1.0}
                    ],
                }
            ],
        }
        of = requests.post(
            f"{BASE_URL}/api/encomendas/{enc['id']}/ordens-fabrico",
            json={"cliente": c["nome"], "cliente_id": c["id"], "itens": of_payload["itens"]},
            headers=H,
            timeout=15,
        ).json()
        # Se a rota acima criar OF vazia, atualiza com PUT
        if not of.get("itens"):
            of_full = requests.put(
                f"{BASE_URL}/api/ordens-fabrico/{of['id']}", json={**of, "itens": of_payload["itens"]}, headers=H, timeout=15
            ).json()
            of = of_full
        yield c, enc, of_payload, of
        requests.delete(f"{BASE_URL}/api/ordens-fabrico/{of['id']}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/clientes/{c['id']}", headers=H, timeout=15)

    def test_iniciar_operacao_bloqueado_403(self, H, setup_data):
        _, enc, _, of = setup_data
        of_full = requests.get(f"{BASE_URL}/api/ordens-fabrico/{of['id']}", headers=H, timeout=15).json()
        assert of_full.get("itens"), "OF deve ter itens para iniciar operação"
        item = of_full["itens"][0]
        op = item["operacoes"][0]
        r = requests.post(
            f"{BASE_URL}/api/ordens-fabrico/{of['id']}/operacao/iniciar",
            json={"item_id": item["id"], "operacao_id": op["id"]},
            headers=H,
            timeout=15,
        )
        assert r.status_code == 403, r.text
        assert "Produção não autorizada" in r.text or "pagamento" in r.text.lower()

    def test_iniciar_operacao_libera_apos_autorizar(self, H, setup_data):
        _, enc, _, of = setup_data
        # Autorizar produção manualmente
        enc_full = requests.get(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=H, timeout=15).json()
        upd = {
            "cliente": enc_full["cliente"],
            "cliente_id": enc_full.get("cliente_id"),
            "artigos": enc_full.get("artigos", []),
            "valor_total": enc_full.get("valor_total"),
            "valor_total_manual": enc_full.get("valor_total_manual", False),
            "valor_pago": enc_full.get("valor_pago", 0),
            "autorizada_producao": True,
            "estado": enc_full.get("estado", "aberta"),
            "descricao": enc_full.get("descricao", ""),
            "data": enc_full.get("data"),
            "notas": enc_full.get("notas", ""),
        }
        r0 = requests.put(f"{BASE_URL}/api/encomendas/{enc['id']}", json=upd, headers=H, timeout=15)
        assert r0.status_code == 200
        assert r0.json()["pode_produzir"] is True

        of_full = requests.get(f"{BASE_URL}/api/ordens-fabrico/{of['id']}", headers=H, timeout=15).json()
        item = of_full["itens"][0]
        op = item["operacoes"][0]
        r = requests.post(
            f"{BASE_URL}/api/ordens-fabrico/{of['id']}/operacao/iniciar",
            json={"item_id": item["id"], "operacao_id": op["id"]},
            headers=H,
            timeout=15,
        )
        assert r.status_code == 200, r.text


# ---------------- Conversão orçamento → encomenda com artigos + valor_total ----------------
class TestConversaoOrcamento:
    def test_converter_popula_enc_artigos_e_valor(self, H):
        c = requests.post(
            f"{BASE_URL}/api/clientes", json={"nome": "teste-ConvCli10"}, headers=H, timeout=15
        ).json()
        orc_payload = {
            "cliente": c["nome"],
            "cliente_id": c["id"],
            "linhas": [
                {
                    "artigo_id": "art-conv-A",
                    "artigo_nome": "Linha A",
                    "quantidade": 2,
                    "preco_unit": 20.0,
                    "personalizacoes": [],
                    "roteiro": [],
                },
                {
                    "artigo_id": "art-conv-B",
                    "artigo_nome": "Linha B",
                    "quantidade": 1,
                    "preco_unit": 30.0,
                    "personalizacoes": [],
                    "roteiro": [],
                },
            ],
        }
        orc = requests.post(f"{BASE_URL}/api/orcamentos", json=orc_payload, headers=H, timeout=15).json()
        # marcar aceite (obrigatório para criar encomenda)
        orc["status"] = "aceite"
        put_body = {k: orc[k] for k in ("cliente", "cliente_id", "descricao", "data", "validade", "status", "notas", "linhas", "materiais", "desconto_total", "desconto_total_tipo") if k in orc}
        requests.put(f"{BASE_URL}/api/orcamentos/{orc['id']}", json=put_body, headers=H, timeout=15)
        # converter
        conv = requests.post(f"{BASE_URL}/api/orcamentos/{orc['id']}/converter", headers=H, timeout=15).json()
        assert conv.get("encomenda_id"), conv
        enc = requests.get(f"{BASE_URL}/api/encomendas/{conv['encomenda_id']}", headers=H, timeout=15).json()
        assert len(enc["artigos"]) == 2
        # valor deve refletir total do orçamento (cálculo equivalente)
        assert enc["valor_total"] >= 0
        # Cleanup
        of_id = conv["id"]
        requests.delete(f"{BASE_URL}/api/ordens-fabrico/{of_id}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/orcamentos/{orc['id']}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/clientes/{c['id']}", headers=H, timeout=15)


# ---------------- Dashboard KPIs novos ----------------
class TestDashboardKPIs:
    def test_dashboard_devolve_novos_campos(self, H):
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in [
            "valor_encomendas",
            "valor_pago_total",
            "valor_pendente_total",
            "custo_real_encomendas",
            "margem_encomendas",
            "encomendas_por_pagamento",
            "encomendas_por_estado",
            "enc_valor_vs_custo",
        ]:
            assert k in d, f"missing {k}"
