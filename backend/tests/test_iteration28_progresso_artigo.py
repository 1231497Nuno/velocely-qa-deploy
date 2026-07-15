"""Iteration 28: Testes para
- GET /api/artigos/{aid}/resumo (auth 401, shape completo, stats)
- GET /api/encomendas e /api/encomendas/{id} devolvem progresso_producao/qtd_em_ofs/qtd_total
"""
import os
import requests
import pytest

_env = os.environ.get("REACT_APP_BACKEND_URL")
if not _env:
    # Fallback: read from frontend/.env
    _env_path = "/app/frontend/.env"
    if os.path.exists(_env_path):
        with open(_env_path) as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    _env = line.split("=", 1)[1].strip()
                    break
assert _env, "REACT_APP_BACKEND_URL not defined"
BASE_URL = _env.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_LOGIN = "admin"
ADMIN_PASSWORD = "Admin123!"

# artigo de referência (do problem statement); se não existir, escolher outro
ARTIGO_REF_ID = "a643f9fb"  # prefixo, resolveremos abaixo


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"Sem token: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def artigo_id(headers):
    r = requests.get(f"{API}/artigos", headers=headers)
    assert r.status_code == 200
    arts = r.json()
    # tenta o do problem statement
    for a in arts:
        if str(a.get("id", "")).startswith(ARTIGO_REF_ID):
            return a["id"]
    # fallback: um que tenha nome DTF Têxtil Metro
    for a in arts:
        if "DTF" in (a.get("nome") or ""):
            return a["id"]
    # último fallback: qualquer artigo
    assert arts, "Não há artigos"
    return arts[0]["id"]


# --- /api/artigos/{aid}/resumo ---

class TestArtigoResumo:
    def test_resumo_requires_auth(self):
        r = requests.get(f"{API}/artigos/anything/resumo")
        assert r.status_code == 401, f"Esperado 401 sem token, got {r.status_code}"

    def test_resumo_404_for_unknown(self, headers):
        r = requests.get(f"{API}/artigos/nao-existe-xyz/resumo", headers=headers)
        assert r.status_code == 404

    def test_resumo_shape(self, headers, artigo_id):
        r = requests.get(f"{API}/artigos/{artigo_id}/resumo", headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("artigo", "orcamentos", "encomendas", "ordens_fabrico", "stats"):
            assert key in data, f"Falta chave '{key}' no resumo"

        stats = data["stats"]
        for key in ("num_orcamentos", "num_encomendas", "num_ofs",
                    "qtd_orcada", "qtd_encomendada", "qtd_produzida"):
            assert key in stats, f"Falta '{key}' em stats"

        # Consistência: num_X == len(listas)
        assert stats["num_orcamentos"] == len(data["orcamentos"])
        assert stats["num_encomendas"] == len(data["encomendas"])
        assert stats["num_ofs"] == len(data["ordens_fabrico"])

        # Cada linha de encomenda deve ter quantidade + campos-chave
        for e in data["encomendas"]:
            for k in ("id", "numero", "cliente", "quantidade", "estado"):
                assert k in e, f"Encomenda sem '{k}'"
        for o in data["orcamentos"]:
            for k in ("id", "numero", "cliente", "quantidade", "total"):
                assert k in o, f"Orçamento sem '{k}'"
        for f in data["ordens_fabrico"]:
            for k in ("id", "numero", "cliente", "quantidade", "status", "progresso"):
                assert k in f, f"OF sem '{k}'"

        # stats.qtd_encomendada deve bater com soma das encomendas
        soma_enc = sum((e.get("quantidade") or 0) for e in data["encomendas"])
        assert abs(stats["qtd_encomendada"] - round(soma_enc, 2)) < 0.01


# --- Encomendas: progresso_producao / qtd_em_ofs / qtd_total ---

class TestEncomendasProgresso:
    def test_lista_encomendas_tem_progresso(self, headers):
        r = requests.get(f"{API}/encomendas", headers=headers)
        assert r.status_code == 200
        encs = r.json()
        assert isinstance(encs, list)
        assert len(encs) > 0
        # Todas devem ter as 3 chaves novas
        for e in encs:
            for k in ("progresso_producao", "qtd_em_ofs", "qtd_total"):
                assert k in e, f"Encomenda {e.get('numero')} sem '{k}'"
            assert 0 <= (e.get("progresso_producao") or 0) <= 100

    def test_detalhe_encomenda_tem_progresso(self, headers):
        r = requests.get(f"{API}/encomendas", headers=headers)
        encs = r.json()
        assert encs
        eid = encs[0]["id"]
        r2 = requests.get(f"{API}/encomendas/{eid}", headers=headers)
        assert r2.status_code == 200
        d = r2.json()
        for k in ("progresso_producao", "qtd_em_ofs", "qtd_total"):
            assert k in d, f"Detalhe sem '{k}'"

    def test_progresso_consistente(self, headers):
        """Se qtd_em_ofs == qtd_total > 0 → progresso 100."""
        r = requests.get(f"{API}/encomendas", headers=headers)
        for e in r.json():
            total = e.get("qtd_total") or 0
            em = e.get("qtd_em_ofs") or 0
            prog = e.get("progresso_producao") or 0
            if total > 0:
                esperado = round(em / total * 100)
                # tolerância 1 devido a arredondamento
                assert abs(prog - esperado) <= 1, (
                    f"ENC {e.get('numero')}: prog={prog} vs esperado={esperado} "
                    f"(em_ofs={em}, total={total})"
                )
            else:
                assert prog == 0
