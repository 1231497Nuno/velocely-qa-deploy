"""Iteration 29 tests:
- POST /orcamentos/{oid}/converter agora cria APENAS Encomenda (não cria OF).
- Idempotência: 2x converter devolve mesma encomenda.
- compute_encomenda expõe sobreproducao / artigos_sobreproducao / tem_artigos_sem_of / artigos_sem_of.
- GET /artigos/{aid}/resumo stats inclui receita, custo, ganho.
- E2E sobreproducao: OF com qtd superior ao total do artigo → encomenda reporta sobreproducao=True.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_LOGIN = "admin"
ADMIN_PASS = "Admin123!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"login": ADMIN_LOGIN, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Helpers ----------
def _pick_cliente(hdr):
    cs = requests.get(f"{API}/clientes", headers=hdr, timeout=15).json()
    assert cs, "sem clientes no ambiente"
    return cs[0]


def _pick_artigo(hdr, prefer_id=None):
    arts = requests.get(f"{API}/artigos", headers=hdr, timeout=15).json()
    if prefer_id:
        found = [a for a in arts if a["id"] == prefer_id]
        if found:
            return found[0]
    return arts[0]


# ---------- 1) Conversão de orçamento cria APENAS encomenda ----------
class TestConverterOrcamentoSoCriaEncomenda:
    """Cria orçamento teste, converte → deve criar Encomenda (não OF), idempotente. Limpa no fim."""

    def test_converter_cria_encomenda_sem_of_e_idempotente(self, hdr):
        cliente = _pick_cliente(hdr)
        artigo = _pick_artigo(hdr)

        # 1. Contar OFs antes da conversão
        ofs_antes = requests.get(f"{API}/ordens-fabrico", headers=hdr, timeout=20).json()
        num_ofs_antes = len(ofs_antes)

        # 2. Criar orçamento teste
        payload = {
            "cliente": cliente["nome"],
            "cliente_id": cliente["id"],
            "descricao": "teste-iter29 converter",
            "status": "aceite",
            "linhas": [{
                "artigo_id": artigo["id"],
                "artigo_nome": artigo["nome"],
                "quantidade": 1,
                "preco_unit": 10.0,
            }],
        }
        r = requests.post(f"{API}/orcamentos", headers=hdr, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        orc = r.json()
        oid = orc["id"]

        try:
            # 3. Converter (1a vez)
            r1 = requests.post(f"{API}/orcamentos/{oid}/converter", headers=hdr, timeout=20)
            assert r1.status_code == 200, r1.text
            enc1 = r1.json()
            assert enc1.get("numero", "").startswith("ENC-"), f"esperado numero ENC-... got {enc1.get('numero')}"
            assert enc1.get("orcamento_id") == oid
            assert "id" in enc1

            # 4. Orçamento agora tem encomenda_id/encomenda_numero preenchidos
            r_orc = requests.get(f"{API}/orcamentos/{oid}", headers=hdr, timeout=15)
            assert r_orc.status_code == 200
            orc_after = r_orc.json()
            assert orc_after.get("encomenda_id") == enc1["id"]
            assert orc_after.get("encomenda_numero") == enc1["numero"]

            # 5. NÃO deve criar OF nova
            ofs_depois = requests.get(f"{API}/ordens-fabrico", headers=hdr, timeout=20).json()
            num_ofs_depois = len(ofs_depois)
            assert num_ofs_depois == num_ofs_antes, (
                f"conversão NÃO deveria criar OF; antes={num_ofs_antes} depois={num_ofs_depois}"
            )
            # A encomenda também não deve ter OFs
            r_enc = requests.get(f"{API}/encomendas/{enc1['id']}", headers=hdr, timeout=15)
            assert r_enc.status_code == 200
            enc_full = r_enc.json()
            assert (enc_full.get("num_ofs") or 0) == 0

            # 6. Idempotência: 2a chamada → devolve mesma encomenda
            r2 = requests.post(f"{API}/orcamentos/{oid}/converter", headers=hdr, timeout=20)
            assert r2.status_code == 200, r2.text
            enc2 = r2.json()
            assert enc2["id"] == enc1["id"], "conversão não é idempotente — id diferente"
            assert enc2["numero"] == enc1["numero"]

            # E ainda não há OF nova
            ofs_final = requests.get(f"{API}/ordens-fabrico", headers=hdr, timeout=20).json()
            assert len(ofs_final) == num_ofs_antes

            # Cleanup encomenda
            requests.delete(f"{API}/encomendas/{enc1['id']}", headers=hdr, timeout=15)
        finally:
            # Cleanup orçamento
            requests.delete(f"{API}/orcamentos/{oid}", headers=hdr, timeout=15)


# ---------- 2) compute_encomenda expõe alertas ----------
class TestEncomendaAlertasFields:
    def test_encomendas_list_tem_campos_alerta(self, hdr):
        r = requests.get(f"{API}/encomendas", headers=hdr, timeout=20)
        assert r.status_code == 200
        encs = r.json()
        assert encs, "sem encomendas no ambiente"
        for e in encs[:5]:  # amostra
            assert "sobreproducao" in e
            assert "tem_artigos_sem_of" in e
            assert "artigos_sem_of" in e
            assert "artigos_sobreproducao" in e
            assert isinstance(e["sobreproducao"], bool)
            assert isinstance(e["tem_artigos_sem_of"], bool)
            assert isinstance(e["artigos_sem_of"], list)
            assert isinstance(e["artigos_sobreproducao"], list)

    def test_encomenda_detalhe_tem_campos_alerta(self, hdr):
        encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
        assert encs
        e = encs[0]
        r = requests.get(f"{API}/encomendas/{e['id']}", headers=hdr, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("sobreproducao", "tem_artigos_sem_of", "artigos_sem_of", "artigos_sobreproducao"):
            assert k in d, f"campo {k} em falta"

    def test_encomenda_semof_flag_correto(self, hdr):
        """Se a encomenda está ativa e tem_artigos_sem_of, artigos_sem_of não pode estar vazio."""
        encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
        for e in encs:
            if e.get("tem_artigos_sem_of"):
                assert e.get("estado") not in ("concluida", "cancelada"), (
                    f"tem_artigos_sem_of=True mas estado={e.get('estado')} (deveria ser só quando ativa)"
                )
                assert e.get("artigos_sem_of"), "flag True mas lista vazia"
                return
        pytest.skip("nenhuma encomenda com tem_artigos_sem_of no ambiente")


# ---------- 3) Artigo resumo com receita/custo/ganho ----------
class TestArtigoResumoStats:
    def test_resumo_stats_tem_receita_custo_ganho(self, hdr):
        arts = requests.get(f"{API}/artigos", headers=hdr, timeout=15).json()
        assert arts
        # Preferir "DTF Têxtil Metro" se existir
        aid = next((a["id"] for a in arts if "DTF" in (a.get("nome") or "")), arts[0]["id"])
        r = requests.get(f"{API}/artigos/{aid}/resumo", headers=hdr, timeout=25)
        assert r.status_code == 200
        d = r.json()
        stats = d.get("stats", {})
        for k in ("receita", "custo", "ganho"):
            assert k in stats, f"stats.{k} em falta"
            assert isinstance(stats[k], (int, float)), f"stats.{k} tipo errado"
        # ganho = receita - custo (tolerância de arredondamento)
        assert abs(stats["ganho"] - (stats["receita"] - stats["custo"])) < 0.02, (
            f"ganho != receita-custo: {stats}"
        )

    def test_resumo_requires_auth(self):
        arts_pub = requests.get(f"{API}/artigos", timeout=15)
        assert arts_pub.status_code == 200
        aid = arts_pub.json()[0]["id"]
        r = requests.get(f"{API}/artigos/{aid}/resumo", timeout=15)
        assert r.status_code in (401, 403), f"esperado 401/403 sem auth, got {r.status_code}"


# ---------- 4) E2E sobreproducao ----------
class TestSobreproducaoE2E:
    def test_of_com_qtd_superior_marca_sobreproducao(self, hdr):
        # Encontrar uma encomenda ativa com pelo menos um artigo
        encs = requests.get(f"{API}/encomendas", headers=hdr, timeout=20).json()
        target = None
        for e in encs:
            if e.get("estado") in ("concluida", "cancelada"):
                continue
            full = requests.get(f"{API}/encomendas/{e['id']}", headers=hdr, timeout=15).json()
            arts = [a for a in (full.get("artigos") or []) if a.get("artigo_id")]
            if arts:
                target = full
                target_art = arts[0]
                break
        if not target:
            pytest.skip("sem encomenda ativa com artigos para teste")

        qtd_enc = float(target_art.get("quantidade") or 0)
        qtd_of_teste = qtd_enc + 999  # bem acima
        of_criada_id = None
        try:
            # Criar OF via endpoint /encomendas/{id}/ordens-fabrico
            payload = {
                "cliente": target["cliente"],
                "itens": [{
                    "artigo_id": target_art["artigo_id"],
                    "artigo_nome": target_art.get("artigo_nome") or "",
                    "quantidade": qtd_of_teste,
                    "personalizacoes": target_art.get("personalizacoes") or [],
                    "operacoes": [],
                }],
                "notas": "teste-iter29 sobreproducao (temporária)",
            }
            r = requests.post(
                f"{API}/encomendas/{target['id']}/ordens-fabrico",
                headers=hdr, json=payload, timeout=20,
            )
            assert r.status_code in (200, 201), f"falha criar OF: {r.status_code} {r.text}"
            of = r.json()
            of_criada_id = of["id"]

            # Re-buscar encomenda e verificar sobreproducao
            enc_after = requests.get(f"{API}/encomendas/{target['id']}", headers=hdr, timeout=15).json()
            assert enc_after.get("sobreproducao") is True, (
                f"sobreproducao esperada True, artigos_sobreproducao={enc_after.get('artigos_sobreproducao')}"
            )
            assert enc_after.get("artigos_sobreproducao"), "lista vazia"
        finally:
            if of_criada_id:
                r_del = requests.delete(f"{API}/ordens-fabrico/{of_criada_id}", headers=hdr, timeout=15)
                assert r_del.status_code in (200, 204), f"cleanup falhou: {r_del.status_code} {r_del.text}"
