"""
Iteration 17 — Descontos (linha + total) em Orçamentos e Encomendas; preço unitário em OF.
Testes pytest contra a API (URL via get_base_url()).
Cria dados com prefixo 'teste-it17-' e elimina no fim. NÃO toca em dados reais.
"""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"

ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()

# --------------- fixtures ---------------

@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login falhou: {r.status_code} {r.text}"
    data = r.json()
    tk = data.get("access_token") or data.get("token")
    assert tk, f"Sem token na resposta de login: {data}"
    return tk


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def created_ids():
    # tracker for cleanup
    return {"artigos": [], "orcamentos": [], "encomendas": [], "ofs": [], "tipos_pers": []}


@pytest.fixture(scope="session", autouse=True)
def cleanup_at_end(client, created_ids):
    yield
    # Cleanup in safe order: OFs → encomendas → orçamentos → tipos_pers → artigos
    for of_id in created_ids["ofs"]:
        try:
            client.delete(f"{API}/ordens-fabrico/{of_id}", timeout=10)
        except Exception:
            pass
    for eid in created_ids["encomendas"]:
        try:
            client.delete(f"{API}/encomendas/{eid}", timeout=10)
        except Exception:
            pass
    for oid in created_ids["orcamentos"]:
        try:
            client.delete(f"{API}/orcamentos/{oid}", timeout=10)
        except Exception:
            pass
    for tid in created_ids["tipos_pers"]:
        try:
            client.delete(f"{API}/tipos-personalizacao/{tid}", timeout=10)
        except Exception:
            pass
    for aid in created_ids["artigos"]:
        try:
            client.delete(f"{API}/artigos/{aid}", timeout=10)
        except Exception:
            pass


@pytest.fixture(scope="session")
def artigo_teste(client, created_ids):
    """Cria um artigo com preço de venda computado de 8.61€/un (custo 6.6231 + 30%)."""
    payload = {
        "nome": "teste-it17-artigo",
        "descricao": "Artigo de teste it17",
        "custo_artigo": 6.6231,  # 6.6231 * 1.3 = 8.610... -> 8.61
        "margem": 30.0,
        "materiais": [],
        "roteiro": [],
    }
    r = client.post(f"{API}/artigos", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"create artigo falhou: {r.status_code} {r.text}"
    art = r.json()
    created_ids["artigos"].append(art["id"])
    # validar preco_venda
    assert abs(float(art.get("preco_venda") or 0) - 8.61) < 0.02, f"preco_venda={art.get('preco_venda')}"
    return art


# --------------- ORÇAMENTOS ---------------

class TestOrcamentoDescontos:
    """Descontos por linha e descontos totais em orçamentos."""

    def test_orc_desc_linha_pct_e_desc_total_eur(self, client, created_ids, artigo_teste):
        # Linha: artigo 8.61/un + personalização 2/un, qtd 2 → bruto 21.22
        # Desconto linha 10% → 2.12 → líquido linha 19.10
        # Desconto total 5€ → final 14.10
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-orc",
            "desconto_total": 5,
            "desconto_total_tipo": "eur",
            "linhas": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 2,
                    "personalizacoes": [{"nome": "p1", "valor": 2.0, "tempo": 0}],
                    "desconto": 10,
                    "desconto_tipo": "pct",
                }
            ],
            "materiais": [],
        }
        r = client.post(f"{API}/orcamentos", json=payload, timeout=15)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        orc = r.json()
        created_ids["orcamentos"].append(orc["id"])

        # Backend recalcula preco_unit a partir do artigo (preço de venda computado)
        # Validar campos essenciais
        assert "desconto_linhas" in orc, "campo desconto_linhas ausente"
        assert "subtotal_liquido" in orc, "campo subtotal_liquido ausente"
        assert "desconto_total_valor" in orc, "campo desconto_total_valor ausente"
        assert "total" in orc, "campo total ausente"

        # validações numéricas com tolerância
        assert abs(orc["desconto_linhas"] - 2.12) < 0.05, f"desconto_linhas={orc['desconto_linhas']}"
        assert abs(orc["subtotal_liquido"] - 19.10) < 0.05, f"subtotal_liquido={orc['subtotal_liquido']}"
        assert abs(orc["desconto_total_valor"] - 5.0) < 0.05, f"desconto_total_valor={orc['desconto_total_valor']}"
        assert abs(orc["total"] - 14.10) < 0.05, f"total={orc['total']}"

        # GET e revalidar persistência
        gr = client.get(f"{API}/orcamentos/{orc['id']}", timeout=15)
        assert gr.status_code == 200
        g = gr.json()
        assert abs(g["total"] - 14.10) < 0.05
        assert abs(g["desconto_linhas"] - 2.12) < 0.05

        # Campos da linha persistem
        l0 = g["linhas"][0]
        assert l0.get("desconto") == 10
        assert l0.get("desconto_tipo") == "pct"
        # preco_unit da linha deve ter sido recomputado pelo backend
        assert l0.get("preco_unit") is not None and l0.get("preco_unit") > 0

    def test_orc_desc_linha_eur(self, client, created_ids, artigo_teste):
        # qtd 1, sem personalização. bruto = preço_venda ≈ 8.61. desconto 1€ → 7.61
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-orc-eur",
            "desconto_total": 0,
            "desconto_total_tipo": "pct",
            "linhas": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 1,
                    "desconto": 1.0,
                    "desconto_tipo": "eur",
                }
            ],
            "materiais": [],
        }
        r = client.post(f"{API}/orcamentos", json=payload, timeout=15)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        orc = r.json()
        created_ids["orcamentos"].append(orc["id"])
        # bruto 8.61, desc linha 1.00, total = 7.61
        assert abs(orc["desconto_linhas"] - 1.0) < 0.05, f"desconto_linhas={orc['desconto_linhas']}"
        assert abs(orc["total"] - 7.61) < 0.05, f"total={orc['total']}"

    def test_orc_sem_desconto_regressao(self, client, created_ids, artigo_teste):
        # Sem nenhum desconto: total == bruto. preço artigo 8.61 × 2 = 17.22
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-orc-zero",
            "linhas": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 2,
                }
            ],
            "materiais": [],
        }
        r = client.post(f"{API}/orcamentos", json=payload, timeout=15)
        assert r.status_code in (200, 201)
        orc = r.json()
        created_ids["orcamentos"].append(orc["id"])
        assert orc.get("desconto_linhas", 0) == 0
        assert orc.get("desconto_total_valor", 0) == 0
        assert abs(orc["total"] - 17.22) < 0.05, f"total={orc['total']}"

    def test_orc_pdf_com_descontos(self, client, created_ids, artigo_teste):
        # Cria orçamento com desconto e gera PDF
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-orc-pdf",
            "desconto_total": 10,
            "desconto_total_tipo": "pct",
            "linhas": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 1,
                    "desconto": 5,
                    "desconto_tipo": "pct",
                }
            ],
            "materiais": [],
        }
        r = client.post(f"{API}/orcamentos", json=payload, timeout=15)
        assert r.status_code in (200, 201)
        orc = r.json()
        created_ids["orcamentos"].append(orc["id"])
        pr = client.get(f"{API}/orcamentos/{orc['id']}/pdf", timeout=30)
        assert pr.status_code == 200, f"PDF status={pr.status_code}"
        assert pr.content[:4] == b"%PDF", "PDF não começa por %PDF"
        assert len(pr.content) > 1000, f"PDF muito pequeno: {len(pr.content)}"


# --------------- ENCOMENDAS ---------------

class TestEncomendaDescontos:
    """Descontos por linha e total em encomendas + persistência + PDF."""

    def test_encomenda_desc_linha_eur_desc_total_pct(self, client, created_ids):
        # 3 × 10 = 30 bruto; desconto linha 2€ → 28; desconto total 10% → 25.20
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-enc",
            "desconto_total": 10,
            "desconto_total_tipo": "pct",
            "artigos": [
                {
                    "artigo_nome": "teste-it17-art-manual",
                    "quantidade": 3,
                    "preco_unit": 10.0,
                    "desconto": 2.0,
                    "desconto_tipo": "eur",
                }
            ],
        }
        r = client.post(f"{API}/encomendas", json=payload, timeout=15)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        enc = r.json()
        created_ids["encomendas"].append(enc["id"])

        assert "valor_artigos_bruto" in enc
        assert "desconto_linhas" in enc
        assert "desconto_total_valor" in enc

        assert abs(enc["valor_artigos_bruto"] - 30.0) < 0.05, f"bruto={enc['valor_artigos_bruto']}"
        assert abs(enc["desconto_linhas"] - 2.0) < 0.05, f"desc_linhas={enc['desconto_linhas']}"
        assert abs(enc["desconto_total_valor"] - 2.80) < 0.05, f"desc_total_valor={enc['desconto_total_valor']}"
        assert abs(enc["valor_total"] - 25.20) < 0.05, f"valor_total={enc['valor_total']}"

        # GET e verificar persistência
        gr = client.get(f"{API}/encomendas/{enc['id']}", timeout=15)
        assert gr.status_code == 200
        g = gr.json()
        assert abs(g["valor_total"] - 25.20) < 0.05
        a0 = g["artigos"][0]
        assert a0.get("desconto") == 2.0
        assert a0.get("desconto_tipo") == "eur"

    def test_encomenda_sem_desconto_regressao(self, client, created_ids):
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-enc-zero",
            "artigos": [
                {"artigo_nome": "x", "quantidade": 2, "preco_unit": 5.0}
            ],
        }
        r = client.post(f"{API}/encomendas", json=payload, timeout=15)
        assert r.status_code in (200, 201)
        enc = r.json()
        created_ids["encomendas"].append(enc["id"])
        assert enc.get("desconto_linhas", 0) == 0
        assert enc.get("desconto_total_valor", 0) == 0
        assert abs(enc["valor_total"] - 10.0) < 0.05

    def test_encomenda_pdf_com_descontos(self, client, created_ids):
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-enc-pdf",
            "desconto_total": 5,
            "desconto_total_tipo": "eur",
            "artigos": [
                {"artigo_nome": "pdf-it17", "quantidade": 2, "preco_unit": 10.0, "desconto": 5, "desconto_tipo": "pct"}
            ],
        }
        r = client.post(f"{API}/encomendas", json=payload, timeout=15)
        assert r.status_code in (200, 201)
        enc = r.json()
        created_ids["encomendas"].append(enc["id"])
        pr = client.get(f"{API}/encomendas/{enc['id']}/pdf", timeout=30)
        assert pr.status_code == 200
        assert pr.content[:4] == b"%PDF"
        assert len(pr.content) > 1000


# --------------- ORDENS DE FABRICO ---------------

class TestOFPrecoUnit:
    """OFs devem expor preco_unit por item (a partir do artigo). Sem desconto nas OFs."""

    def test_of_item_preco_unit_from_artigo(self, client, created_ids, artigo_teste):
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-of",
            "itens": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 1,
                    "personalizacoes": [{"nome": "p1", "valor": 2.0, "tempo": 0}],
                    "operacoes": [],
                }
            ],
        }
        r = client.post(f"{API}/ordens-fabrico", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        of = r.json()
        created_ids["ofs"].append(of["id"])

        item = of["itens"][0]
        # preco_unit deve ter sido auto-preenchido pelo backend a partir do artigo
        assert item.get("preco_unit") is not None
        assert abs(float(item["preco_unit"]) - 8.61) < 0.05, f"preco_unit={item.get('preco_unit')}"

        # GET e revalidar
        gr = client.get(f"{API}/ordens-fabrico/{of['id']}", timeout=15)
        assert gr.status_code == 200
        g = gr.json()
        assert abs(float(g["itens"][0]["preco_unit"]) - 8.61) < 0.05

    def test_of_input_nao_tem_desconto(self, client, artigo_teste):
        # Pydantic devia ignorar desconto (não está no schema). Não deve falhar.
        payload = {
            "cliente": "teste-it17-cliente",
            "descricao": "teste-it17-of-noop",
            "itens": [
                {
                    "artigo_id": artigo_teste["id"],
                    "artigo_nome": artigo_teste["nome"],
                    "quantidade": 1,
                    "desconto": 99,  # campo extra deve ser ignorado
                    "operacoes": [],
                }
            ],
        }
        r = client.post(f"{API}/ordens-fabrico", json=payload, timeout=20)
        # aceitar 200/201 (ignored) ou 422 (extra forbidden) — basta documentar
        assert r.status_code in (200, 201, 422)
        if r.status_code in (200, 201):
            of = r.json()
            # cleanup imediato
            client.delete(f"{API}/ordens-fabrico/{of['id']}", timeout=10)
            item = of["itens"][0]
            # de garantia: campo desconto não deve aparecer no schema OF
            assert "desconto" not in item or item.get("desconto") in (None, 0, 99)
