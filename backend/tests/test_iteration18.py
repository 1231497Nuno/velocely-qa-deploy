"""
Iteration 18 — Velocely ERP:
1) Artigo.unidade (m²/un/kg) persiste e propaga para Orçamentos/Encomendas/OFs
2) Encomenda — personalizacoes por linha (lista) com valor editável; subtotal reflete
3) Regressão descontos (linha + total) em encomenda
4) OF mostra unidade + preco_unit por item (build_of_itens + GET backfill runtime)
5) PDFs orçamento e encomenda geram (%PDF)
"""

import os
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        # Load from frontend/.env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert url, "REACT_APP_BACKEND_URL não definido"
    return url.rstrip("/")


BASE_URL = _load_backend_url()


def _load_admin_creds():
    from pathlib import Path
    email = os.environ.get("TEST_ADMIN_EMAIL")
    password = os.environ.get("TEST_ADMIN_PASSWORD")
    if email and password:
        return email, password
    e = p = None
    creds = Path("/app/memory/test_credentials.md")
    if creds.exists():
        for line in creds.read_text().splitlines():
            s = line.strip()
            if s.startswith("- Email:") and e is None:
                e = s.split("`")[1] if "`" in s else s.split(":", 1)[1].strip()
            elif s.startswith("- Password:") and p is None:
                p = s.split("`")[1] if "`" in s else s.split(":", 1)[1].strip()
            if e and p:
                break
    return email or e, password or p


ADMIN_EMAIL, ADMIN_PASSWORD = _load_admin_creds()

CREATED = {"artigos": [], "orcamentos": [], "encomendas": [], "ordens_fabrico": []}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login falhou: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def cleanup(hdr):
    yield
    # Best-effort cleanup
    for oid in CREATED["ordens_fabrico"]:
        try:
            requests.delete(f"{BASE_URL}/api/ordens-fabrico/{oid}", headers=hdr, timeout=10)
        except Exception:
            pass
    for eid in CREATED["encomendas"]:
        try:
            requests.delete(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr, timeout=10)
        except Exception:
            pass
    for oid in CREATED["orcamentos"]:
        try:
            requests.delete(f"{BASE_URL}/api/orcamentos/{oid}", headers=hdr, timeout=10)
        except Exception:
            pass
    for aid in CREATED["artigos"]:
        try:
            requests.delete(f"{BASE_URL}/api/artigos/{aid}", headers=hdr, timeout=10)
        except Exception:
            pass


# --- Module-level shared state across tests ---
shared = {"artigo_id": None, "preco_venda": None}


# 1) ARTIGO — unidade persists
class TestArtigoUnidade:
    def test_create_artigo_with_unidade_m2(self, hdr):
        payload = {
            "nome": "teste-it18-artigo-m2",
            "descricao": "Artigo de teste com unidade m²",
            "unidade": "m²",
            "custo_artigo": 5.0,
            "margem": 50.0,
            "materiais": [],
            "roteiro": [],
        }
        r = requests.post(f"{BASE_URL}/api/artigos", headers=hdr, json=payload)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["unidade"] == "m²"
        assert data["nome"] == payload["nome"]
        assert "id" in data
        CREATED["artigos"].append(data["id"])
        shared["artigo_id"] = data["id"]
        shared["preco_venda"] = data.get("preco_venda") or 7.5  # 5 * 1.5

    def test_get_artigo_unidade_persisted(self, hdr):
        aid = shared["artigo_id"]
        r = requests.get(f"{BASE_URL}/api/artigos/{aid}", headers=hdr)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["unidade"] == "m²"

    def test_update_artigo_unidade_kg(self, hdr):
        aid = shared["artigo_id"]
        # PUT with full body to change unidade
        get_r = requests.get(f"{BASE_URL}/api/artigos/{aid}", headers=hdr)
        body = get_r.json()
        payload = {
            "nome": body["nome"],
            "descricao": body.get("descricao", ""),
            "unidade": "kg",
            "custo_artigo": body.get("custo_artigo", 0),
            "margem": body.get("margem", 30),
            "materiais": body.get("materiais", []),
            "roteiro": body.get("roteiro", []),
        }
        r = requests.put(f"{BASE_URL}/api/artigos/{aid}", headers=hdr, json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["unidade"] == "kg"

        # Restore back to m² for following tests
        payload["unidade"] = "m²"
        r = requests.put(f"{BASE_URL}/api/artigos/{aid}", headers=hdr, json=payload)
        assert r.status_code == 200
        assert r.json()["unidade"] == "m²"


# 2) ORÇAMENTO — uses artigo.unidade
class TestOrcamentoUnidade:
    def test_orcamento_with_artigo_unidade(self, hdr):
        aid = shared["artigo_id"]
        # Get artigo's computed preco_venda from breakdown via list
        r_art = requests.get(f"{BASE_URL}/api/artigos/{aid}", headers=hdr)
        art = r_art.json()
        pv = art.get("preco_venda") or 7.5
        shared["preco_venda"] = pv

        payload = {
            "cliente": "teste-it18-cliente",
            "descricao": "teste-it18-orc",
            "status": "rascunho",
            "linhas": [
                {
                    "artigo_id": aid,
                    "artigo_nome": art["nome"],
                    "quantidade": 2,
                    "preco_unit": pv,
                    "personalizacoes": [],
                }
            ],
            "materiais": [],
        }
        r = requests.post(f"{BASE_URL}/api/orcamentos", headers=hdr, json=payload)
        assert r.status_code in (200, 201), r.text
        orc = r.json()
        CREATED["orcamentos"].append(orc["id"])

        # Backend includes total
        assert orc.get("total") is not None

        # GET orcamento and confirm linha has artigo_id (frontend reads artigo.unidade via /api/artigos)
        r2 = requests.get(f"{BASE_URL}/api/orcamentos/{orc['id']}", headers=hdr)
        assert r2.status_code == 200
        orc_full = r2.json()
        assert orc_full["linhas"][0]["artigo_id"] == aid

    def test_pdf_orcamento_generates(self, hdr):
        oid = CREATED["orcamentos"][-1]
        r = requests.get(f"{BASE_URL}/api/orcamentos/{oid}/pdf", headers=hdr)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF", "PDF inválido"
        assert len(r.content) > 1000


# 3) ENCOMENDA — personalizacoes per line + descontos
class TestEncomendaPersonalizacoes:
    def test_create_encomenda_with_pers_lista(self, hdr):
        aid = shared["artigo_id"]
        pv = shared["preco_venda"]
        # Linha: 2x  (pv + 3) = (pv+3)*2 ; for pv=7.5 → (7.5+3)*2=21.0
        payload = {
            "cliente": "teste-it18-cliente",
            "descricao": "teste-it18-enc-pers",
            "estado": "aberta",
            "artigos": [
                {
                    "artigo_id": aid,
                    "artigo_nome": "teste-it18-artigo-m2",
                    "quantidade": 2,
                    "preco_unit": pv,
                    "personalizacoes": [
                        {"nome": "Bordado", "valor": 3.0},
                    ],
                }
            ],
        }
        r = requests.post(f"{BASE_URL}/api/encomendas", headers=hdr, json=payload)
        assert r.status_code in (200, 201), r.text
        enc = r.json()
        CREATED["encomendas"].append(enc["id"])

        expected_bruto = round((pv + 3.0) * 2, 2)
        assert enc.get("valor_artigos_bruto") == expected_bruto, f"esperado {expected_bruto}, obtido {enc.get('valor_artigos_bruto')}"
        assert enc.get("valor_total") == expected_bruto

        # Confirm personalizacoes persisted as list
        r2 = requests.get(f"{BASE_URL}/api/encomendas/{enc['id']}", headers=hdr)
        assert r2.status_code == 200
        body = r2.json()
        a = body["artigos"][0]
        assert isinstance(a["personalizacoes"], list)
        assert len(a["personalizacoes"]) == 1
        assert a["personalizacoes"][0]["nome"] == "Bordado"
        assert a["personalizacoes"][0]["valor"] == 3.0

    def test_add_second_personalizacao_and_recompute(self, hdr):
        eid = CREATED["encomendas"][-1]
        pv = shared["preco_venda"]
        r = requests.get(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr)
        body = r.json()
        # Add Estampagem 2€ to existing artigo
        body["artigos"][0]["personalizacoes"].append({"nome": "Estampagem", "valor": 2.0})
        # PUT update
        put_body = {
            "cliente": body["cliente"],
            "descricao": body.get("descricao", ""),
            "estado": body.get("estado", "aberta"),
            "artigos": body["artigos"],
            "desconto_total": body.get("desconto_total", 0),
            "desconto_total_tipo": body.get("desconto_total_tipo", "pct"),
        }
        r2 = requests.put(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr, json=put_body)
        assert r2.status_code == 200, r2.text
        enc = r2.json()
        # (pv + 3 + 2) * 2 = (pv+5)*2; for pv=7.5 → 25.0
        expected = round((pv + 3.0 + 2.0) * 2, 2)
        assert enc["valor_artigos_bruto"] == expected
        assert enc["valor_total"] == expected

    def test_edit_personalizacao_valor(self, hdr):
        eid = CREATED["encomendas"][-1]
        pv = shared["preco_venda"]
        r = requests.get(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr)
        body = r.json()
        # Edit Bordado valor from 3 → 5
        for p in body["artigos"][0]["personalizacoes"]:
            if p["nome"] == "Bordado":
                p["valor"] = 5.0
        put_body = {
            "cliente": body["cliente"],
            "descricao": body.get("descricao", ""),
            "estado": body.get("estado", "aberta"),
            "artigos": body["artigos"],
        }
        r2 = requests.put(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr, json=put_body)
        assert r2.status_code == 200
        # (pv + 5 + 2) * 2; for pv=7.5 → (14.5)*2 = 29.0
        expected = round((pv + 5.0 + 2.0) * 2, 2)
        assert r2.json()["valor_artigos_bruto"] == expected

    def test_remove_personalizacao(self, hdr):
        eid = CREATED["encomendas"][-1]
        pv = shared["preco_venda"]
        r = requests.get(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr)
        body = r.json()
        # Remove all personalizacoes
        body["artigos"][0]["personalizacoes"] = []
        put_body = {
            "cliente": body["cliente"],
            "estado": body.get("estado", "aberta"),
            "artigos": body["artigos"],
        }
        r2 = requests.put(f"{BASE_URL}/api/encomendas/{eid}", headers=hdr, json=put_body)
        assert r2.status_code == 200
        # pv * 2 = 15.0
        expected = round(pv * 2, 2)
        assert r2.json()["valor_artigos_bruto"] == expected
        assert r2.json()["valor_total"] == expected


# 4) ENCOMENDA — regressao descontos (linha + total) com personalizacao
class TestEncomendaDescontos:
    def test_desconto_linha_e_total(self, hdr):
        aid = shared["artigo_id"]
        pv = shared["preco_venda"]
        # Linha: 3 × (pv + 1) = (pv+1)*3 ; pv=7.5 → (8.5)*3 = 25.5
        # desconto linha 10% → 22.95
        # desconto total 2€ → 20.95
        payload = {
            "cliente": "teste-it18-cliente",
            "descricao": "teste-it18-enc-desc",
            "estado": "aberta",
            "desconto_total": 2.0,
            "desconto_total_tipo": "eur",
            "artigos": [
                {
                    "artigo_id": aid,
                    "artigo_nome": "teste-it18-artigo-m2",
                    "quantidade": 3,
                    "preco_unit": pv,
                    "desconto": 10.0,
                    "desconto_tipo": "pct",
                    "personalizacoes": [{"nome": "Vinil", "valor": 1.0}],
                }
            ],
        }
        r = requests.post(f"{BASE_URL}/api/encomendas", headers=hdr, json=payload)
        assert r.status_code in (200, 201), r.text
        enc = r.json()
        CREATED["encomendas"].append(enc["id"])
        bruto = round((pv + 1.0) * 3, 2)
        desc_l = round(bruto * 0.10, 2)
        subliq = round(bruto - desc_l, 2)
        total = round(subliq - 2.0, 2)
        assert enc["valor_artigos_bruto"] == bruto, f"bruto esperado {bruto}, obtido {enc['valor_artigos_bruto']}"
        assert enc["desconto_linhas"] == desc_l
        assert enc["desconto_total_valor"] == 2.0
        assert enc["valor_total"] == total

    def test_pdf_encomenda_generates(self, hdr):
        eid = CREATED["encomendas"][-1]
        r = requests.get(f"{BASE_URL}/api/encomendas/{eid}/pdf", headers=hdr)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 1000


# 5) OF — unidade + preco_unit per item
class TestOFUnidadePrecoUnit:
    def test_create_of_from_encomenda_and_check_unidade_precounit(self, hdr):
        aid = shared["artigo_id"]
        pv = shared["preco_venda"]
        # Create simple encomenda with artigo first
        enc_payload = {
            "cliente": "teste-it18-cliente",
            "descricao": "teste-it18-enc-of",
            "estado": "aberta",
            "artigos": [
                {
                    "artigo_id": aid,
                    "artigo_nome": "teste-it18-artigo-m2",
                    "quantidade": 4,
                    "preco_unit": pv,
                    "personalizacoes": [{"nome": "Bordado", "valor": 3.0}],
                }
            ],
        }
        r_enc = requests.post(f"{BASE_URL}/api/encomendas", headers=hdr, json=enc_payload)
        assert r_enc.status_code in (200, 201), r_enc.text
        enc = r_enc.json()
        CREATED["encomendas"].append(enc["id"])

        # Create OF from encomenda
        of_payload = {
            "cliente": enc["cliente"],
            "itens": [
                {
                    "artigo_id": aid,
                    "quantidade": 4,
                    "personalizacoes": [{"nome": "Bordado", "valor": 3.0}],
                    "operacoes": [],
                }
            ],
        }
        r_of = requests.post(
            f"{BASE_URL}/api/encomendas/{enc['id']}/ordens-fabrico",
            headers=hdr,
            json=of_payload,
        )
        assert r_of.status_code in (200, 201), r_of.text
        of = r_of.json()
        CREATED["ordens_fabrico"].append(of["id"])

        # GET OF and check item has unidade + preco_unit
        r_get = requests.get(f"{BASE_URL}/api/ordens-fabrico/{of['id']}", headers=hdr)
        assert r_get.status_code == 200
        of_full = r_get.json()
        assert len(of_full["itens"]) == 1
        it = of_full["itens"][0]
        assert it.get("unidade") == "m²", f"unidade esperada m², obtida {it.get('unidade')}"
        assert it.get("preco_unit") == pv, f"preco_unit esperado {pv}, obtido {it.get('preco_unit')}"
        assert it.get("quantidade") == 4
        # personalizacoes preservadas
        assert isinstance(it.get("personalizacoes"), list) and len(it["personalizacoes"]) == 1
        assert it["personalizacoes"][0]["valor"] == 3.0
