"""Iteration 5 tests: Análise da Produção (monthly) + Orçamento line roteiro persistence."""
import requests
from conftest import get_base_url

BASE = get_base_url()


def test_producao_tempos_endpoint():
    """GET /api/producao/tempos returns array with the expected fields."""
    r = requests.get(f"{BASE}/api/producao/tempos", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        for k in ("id", "numero", "cliente", "status",
                  "tempo_estimado_maquina", "tempo_estimado_mao_obra",
                  "tempo_estimado_total", "tempo_real_min", "desvio_min",
                  "custo_estimado", "custo_real", "desvio_custo", "operacoes"):
            assert k in row, f"missing key {k} in tempos row"
        assert isinstance(row["operacoes"], list)


def test_producao_analise_monthly_endpoint():
    """GET /api/producao/analise returns monthly aggregation."""
    r = requests.get(f"{BASE}/api/producao/analise", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        for k in ("mes", "ofs_criadas", "ofs_concluidas", "taxa_conclusao",
                  "tempo_estimado", "tempo_real", "desvio_tempo",
                  "custo_estimado", "custo_real", "desvio_custo"):
            assert k in row, f"missing key {k} in analise row"
        # mes must be YYYY-MM
        assert len(row["mes"]) == 7 and row["mes"][4] == "-"


def _get_or_create_demo_quote():
    artigos = requests.get(f"{BASE}/api/artigos").json()
    tipos = requests.get(f"{BASE}/api/tipos-personalizacao").json()
    if not artigos or not tipos:
        requests.post(f"{BASE}/api/seed")
        artigos = requests.get(f"{BASE}/api/artigos").json()
        tipos = requests.get(f"{BASE}/api/tipos-personalizacao").json()
    art = artigos[0]
    tipo = tipos[0]
    payload = {
        "cliente": "TEST_IT5_Cliente",
        "descricao": "TEST_IT5",
        "numero_encomenda": "ENC-IT5",
        "status": "rascunho",
        "linhas": [{
            "artigo_id": art["id"],
            "artigo_nome": art["nome"],
            "quantidade": 2,
            "tipo_personalizacao_id": tipo["id"],
            "tipo_personalizacao_nome": tipo["nome"],
            "valor_personalizacao": float(tipo.get("valor") or 0),
            "custo_base_unit": round((art.get("custo_artigo", 0) or 0) + (art.get("custo_materiais", 0) or 0), 2),
            "margem": 30,
            "roteiro": [],
        }],
    }
    r = requests.post(f"{BASE}/api/orcamentos", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json(), artigos, tipos


def test_orcamento_line_roteiro_persists_and_converts_to_of():
    """Edit line roteiro on a quote, save, convert, ensure roteiro carries over to OF."""
    quote, artigos, _tipos = _get_or_create_demo_quote()
    maquinas = requests.get(f"{BASE}/api/maquinas").json()
    mao_obra = requests.get(f"{BASE}/api/mao-obra").json()
    assert maquinas and mao_obra, "need machines and labor seeded"
    mq, mo = maquinas[0], mao_obra[0]
    custom_op = {
        "nome": "TEST_IT5_OP",
        "maquina_id": mq["id"], "maquina_nome": mq["nome"],
        "tempo_maquina": 7, "tempo_maquina_unidade": "min",
        "mao_obra_id": mo["id"], "mao_obra_nome": mo["nome"],
        "tempo_mao_obra": 11, "tempo_mao_obra_unidade": "min",
    }
    linha = dict(quote["linhas"][0])
    linha["roteiro"] = [custom_op]
    body = {
        "cliente": quote["cliente"],
        "descricao": quote.get("descricao", ""),
        "numero_encomenda": quote.get("numero_encomenda", ""),
        "data": quote.get("data"),
        "validade": quote.get("validade"),
        "status": "aceite",
        "notas": quote.get("notas", ""),
        "linhas": [linha],
    }
    r = requests.put(f"{BASE}/api/orcamentos/{quote['id']}", json=body, timeout=30)
    assert r.status_code == 200, r.text
    # reload
    reloaded = requests.get(f"{BASE}/api/orcamentos/{quote['id']}", timeout=30).json()
    assert reloaded["linhas"][0]["roteiro"], "roteiro empty after reload"
    saved_op = reloaded["linhas"][0]["roteiro"][0]
    assert saved_op["nome"] == "TEST_IT5_OP"
    assert float(saved_op["tempo_maquina"]) == 7
    assert float(saved_op["tempo_mao_obra"]) == 11
    # convert
    r = requests.post(f"{BASE}/api/orcamentos/{quote['id']}/converter", timeout=30)
    assert r.status_code in (200, 201), r.text
    of = r.json()
    assert of.get("linhas") and of["linhas"][0].get("roteiro"), "OF roteiro empty"
    of_op = of["linhas"][0]["roteiro"][0]
    assert of_op["nome"] == "TEST_IT5_OP"
    assert float(of_op["tempo_maquina"]) == 7
    # cleanup
    try:
        requests.delete(f"{BASE}/api/ordens-fabrico/{of['id']}", timeout=15)
    except Exception:
        pass
    try:
        requests.delete(f"{BASE}/api/orcamentos/{quote['id']}", timeout=15)
    except Exception:
        pass
