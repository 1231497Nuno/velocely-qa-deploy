"""Iteration 30 tests — BUG FIX crítico:
PUT/POST /encomendas e POST/DELETE /encomendas/{id}/pagamentos agora devolvem `ordens_fabrico`
igual ao GET, para que o frontend (que faz setEnc(updated)) não perca as OFs após edição/pagamento.
Também: GET /alertas inclui `encomendas_sem_of` (contagem de encomendas ativas com artigos sem OF).
"""
import copy
import requests
import pytest
from conftest import get_base_url, get_admin_credentials

BASE_URL = get_base_url()
API = f"{BASE_URL}/api"

ADMIN_LOGIN = "admin"
_, ADMIN_PASS = get_admin_credentials()


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _find_encomenda(hdr, numero):
    encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
    for e in encs:
        if e.get("numero") == numero:
            return e
    return None


def _get_enc(hdr, eid):
    r = requests.get(f"{API}/encomendas/{eid}", headers=hdr, timeout=15)
    assert r.status_code == 200
    return r.json()


# --------- 1) Alertas incluem encomendas_sem_of ---------
class TestAlertasEncomendasSemOf:
    def test_alertas_contains_encomendas_sem_of(self, hdr):
        r = requests.get(f"{API}/alertas", headers=hdr, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "encomendas_sem_of" in data, "alertas deve incluir campo encomendas_sem_of"
        assert isinstance(data["encomendas_sem_of"], int)
        assert data["encomendas_sem_of"] >= 0

    def test_encomendas_sem_of_alinha_com_lista(self, hdr):
        """A contagem em /alertas deve bater certo com contagem manual sobre /encomendas ativas."""
        encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
        manual = sum(
            1 for e in encs
            if e.get("estado") not in ("concluida", "cancelada") and e.get("tem_artigos_sem_of")
        )
        al = requests.get(f"{API}/alertas", headers=hdr, timeout=15).json()
        assert al["encomendas_sem_of"] == manual, (
            f"encomendas_sem_of={al['encomendas_sem_of']} vs manual={manual}"
        )


# --------- 2) BUG FIX: PUT devolve ordens_fabrico ---------
class TestPutEncomendaDevolveOfs:
    """Cenário real: ENC-2026-0046 (Marco) tem 1 OF; editar deve manter ordens_fabrico na resposta."""

    def test_put_encomenda_com_ofs_devolve_ordens_fabrico(self, hdr):
        # localizar a encomenda de referência (que sabemos ter 1 OF)
        enc = _find_encomenda(hdr, "ENC-2026-0046")
        assert enc is not None, "ENC-2026-0046 não existe no ambiente"
        eid = enc["id"]

        # GET completo para pegar payload de edição (não vamos mudar valores relevantes)
        full = _get_enc(hdr, eid)
        assert full.get("ordens_fabrico"), "GET deveria já devolver ordens_fabrico"
        num_ofs_before = len(full["ordens_fabrico"])
        of_ids_before = sorted(o["id"] for o in full["ordens_fabrico"])

        # progresso ANTES
        prog_before = full.get("progresso_producao")

        # PUT com uma edição minima (apenas altera 'notas' — preservando tudo o resto)
        payload = copy.deepcopy(full)
        original_notas = payload.get("notas", "")
        payload["notas"] = (original_notas or "") + " [teste-iter30-marker]"
        # Remove campos derivados (não fazem parte do input, mas o backend só grava os campos aceites)
        for k in ("ordens_fabrico", "num_ofs", "progresso_producao", "sobreproducao",
                  "artigos_sobreproducao", "tem_artigos_sem_of", "artigos_sem_of",
                  "qtd_em_ofs", "qtd_total", "custo_producao_real", "custo_producao_estimado",
                  "margem_producao", "valor_pendente", "status_pagamento", "pode_produzir",
                  "num_pagamentos"):
            payload.pop(k, None)

        r = requests.put(f"{API}/encomendas/{eid}", json=payload, headers=hdr, timeout=20)
        assert r.status_code == 200, f"PUT falhou: {r.status_code} {r.text}"
        updated = r.json()

        # ---- Assert principal do bug fix ----
        assert "ordens_fabrico" in updated, "PUT deve devolver campo 'ordens_fabrico' (bug fix iter 30)"
        assert isinstance(updated["ordens_fabrico"], list)
        assert len(updated["ordens_fabrico"]) == num_ofs_before, (
            f"OFs desapareceram após PUT: antes={num_ofs_before} depois={len(updated['ordens_fabrico'])}"
        )
        of_ids_after = sorted(o["id"] for o in updated["ordens_fabrico"])
        assert of_ids_after == of_ids_before, "IDs das OFs não devem mudar após PUT"

        # progresso e flags devem manter-se coerentes
        assert updated.get("progresso_producao") == prog_before, (
            f"progresso mudou após edição de notas: {prog_before} → {updated.get('progresso_producao')}"
        )
        # Como o artigo 'DTF Têxtil Metro' está sem OF, deve continuar true
        assert updated.get("tem_artigos_sem_of") is True

        # Rollback: repor notas originais
        payload["notas"] = original_notas
        requests.put(f"{API}/encomendas/{eid}", json=payload, headers=hdr, timeout=20)


# --------- 3) Pagamentos na encomenda devolvem ordens_fabrico ---------
class TestPagamentoDevolveOfs:
    def test_post_e_delete_pagamento_preservam_ofs(self, hdr):
        enc = _find_encomenda(hdr, "ENC-2026-0046")
        full = _get_enc(hdr, enc["id"]) if enc else None
        if not (full and full.get("ordens_fabrico")):
            encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
            enc = next((e for e in encs if e.get("num_ofs") or (e.get("ordens_resumo") or [])), None)
            assert enc is not None, "sem encomenda para o teste"
            full = _get_enc(hdr, enc["id"])
        if not full.get("ordens_fabrico"):
            pytest.skip("nenhuma encomenda com OFs disponível")
        eid = enc["id"]
        of_ids_before = sorted(o["id"] for o in full["ordens_fabrico"])

        r = requests.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 1.0, "metodo": "transferencia", "nota": "teste-iter30"},
            headers=hdr,
            timeout=20,
        )
        assert r.status_code == 200, f"esperado 200, obteve {r.status_code}: {r.text}"
        data = r.json()
        assert "ordens_fabrico" in data, "POST pagamento deve devolver ordens_fabrico"
        assert sorted(o["id"] for o in data["ordens_fabrico"]) == of_ids_before
        pags = data.get("pagamentos") or []
        pag = next((p for p in pags if p.get("nota") == "teste-iter30"), pags[-1] if pags else None)
        assert pag, "pagamento de teste não encontrado"
        pid = pag["id"]

        r2 = requests.delete(f"{API}/encomendas/{eid}/pagamentos/{pid}", headers=hdr, timeout=20)
        assert r2.status_code == 200, r2.text
        deleted = r2.json()
        assert "ordens_fabrico" in deleted
        assert sorted(o["id"] for o in deleted["ordens_fabrico"]) == of_ids_before
        assert pid not in [p["id"] for p in (deleted.get("pagamentos") or [])]



# --------- 4) POST /encomendas devolve ordens_fabrico (mesmo que vazio) ---------
class TestCreateEncomendaDevolveOfs:
    def test_create_encomenda_devolve_lista_ordens_fabrico(self, hdr):
        # cliente qualquer
        cs = requests.get(f"{API}/clientes", headers=hdr, timeout=15).json()
        assert cs
        cliente = cs[0]
        payload = {
            "cliente": cliente["nome"],
            "cliente_id": cliente["id"],
            "descricao": "teste-iter30 criar",
            "notas": "teste-iter30",
        }
        r = requests.post(f"{API}/encomendas", json=payload, headers=hdr, timeout=20)
        assert r.status_code == 200, f"POST enc falhou: {r.status_code} {r.text}"
        created = r.json()
        try:
            assert "ordens_fabrico" in created, "POST /encomendas deve devolver ordens_fabrico"
            assert created["ordens_fabrico"] == []
            assert created.get("num_ofs") == 0
        finally:
            # cleanup
            requests.delete(f"{API}/encomendas/{created['id']}", headers=hdr, timeout=15)
