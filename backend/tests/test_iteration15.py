"""Iteration 15 tests:
(1) TEMPO NAS PERSONALIZAÇÕES — Tipo de Personalização ganha campo `tempo`;
    Mão de Obra ganha flag `responsavel_personalizacoes`. Em OF, tempo da
    personalização (× qtd) é somado à operação cuja mão de obra é responsável.
(2) CALENDÁRIO DE PRAZOS — GET /api/prazos (auth) + dashboard prazos_atrasadas/proximos_7.
"""
import os
import pytest
import requests
from pathlib import Path

def _load_env():
    p = Path("/app/frontend/.env")
    for ln in p.read_text().splitlines():
        if ln.startswith("REACT_APP_BACKEND_URL"):
            return ln.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _load_env()).rstrip("/")


def _load_admin_creds():
    """Lê credenciais de teste de env ou /app/memory/test_credentials.md (evita secret hardcoded)."""
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


_e, _p = _load_admin_creds()
ADMIN = {"email": _e, "password": _p}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- /api/prazos ----------
def test_prazos_requires_auth():
    r = requests.get(f"{BASE}/api/prazos", timeout=30)
    assert r.status_code == 401


def test_prazos_with_auth_returns_list_with_required_fields(h):
    r = requests.get(f"{BASE}/api/prazos", headers=h, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for it in data:
        for k in ("tipo", "numero", "cliente", "prazo_entrega",
                  "dias_restantes", "estado_prazo"):
            assert k in it, f"campo {k} ausente em {it}"
        assert it["tipo"] in ("encomenda", "of")
        assert it["estado_prazo"] in ("atrasada", "proxima", "futura")


def test_dashboard_has_prazos_counters(h):
    r = requests.get(f"{BASE}/api/dashboard", headers=h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert "prazos_atrasadas" in d and isinstance(d["prazos_atrasadas"], int)
    assert "prazos_proximos_7" in d and isinstance(d["prazos_proximos_7"], int)
    assert d["prazos_atrasadas"] >= 0 and d["prazos_proximos_7"] >= 0


# ---------- Mão de Obra: responsavel_personalizacoes ----------
def test_mao_obra_crud_persiste_responsavel_personalizacoes(h):
    # CREATE com flag=True
    r = requests.post(f"{BASE}/api/mao-obra", headers=h, json={
        "nome": "teste-it15-mo-resp", "custo_hora": 12.0,
        "responsavel_personalizacoes": True,
    }, timeout=30)
    assert r.status_code == 200, r.text
    mo = r.json()
    assert mo["responsavel_personalizacoes"] is True
    mo_id = mo["id"]
    try:
        # GET (lista) verifica persistência
        r2 = requests.get(f"{BASE}/api/mao-obra", headers=h, timeout=30)
        assert r2.status_code == 200
        found = next((x for x in r2.json() if x["id"] == mo_id), None)
        assert found and found["responsavel_personalizacoes"] is True

        # PUT alterar para False
        r3 = requests.put(f"{BASE}/api/mao-obra/{mo_id}", headers=h, json={
            "nome": "teste-it15-mo-resp", "custo_hora": 12.0,
            "responsavel_personalizacoes": False,
        }, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["responsavel_personalizacoes"] is False
    finally:
        requests.delete(f"{BASE}/api/mao-obra/{mo_id}", headers=h, timeout=30)


# ---------- Tipo de Personalização: tempo ----------
def test_tipo_pers_crud_persiste_tempo(h):
    r = requests.post(f"{BASE}/api/tipos-personalizacao", headers=h, json={
        "nome": "teste-it15-tp", "descricao": "", "valor": 0.0, "tempo": 5.0,
    }, timeout=30)
    assert r.status_code == 200, r.text
    tp = r.json()
    assert tp["tempo"] == 5.0
    tp_id = tp["id"]
    try:
        r2 = requests.get(f"{BASE}/api/tipos-personalizacao", headers=h, timeout=30)
        assert r2.status_code == 200
        found = next((x for x in r2.json() if x["id"] == tp_id), None)
        assert found and found["tempo"] == 5.0

        r3 = requests.put(f"{BASE}/api/tipos-personalizacao/{tp_id}", headers=h, json={
            "nome": "teste-it15-tp", "descricao": "", "valor": 0.0, "tempo": 7.5,
        }, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["tempo"] == 7.5
    finally:
        requests.delete(f"{BASE}/api/tipos-personalizacao/{tp_id}", headers=h, timeout=30)


# ---------- CRÍTICO: OF aplica tempo de personalização à operação responsável ----------
def test_of_aplica_tempo_pers_e_idempotencia(h):
    created = {"mo": [], "tp": None, "art": None, "of": None}
    try:
        # 1) Mão de Obra normal (não responsável)
        r = requests.post(f"{BASE}/api/mao-obra", headers=h, json={
            "nome": "teste-it15-mo-normal", "custo_hora": 10.0,
            "responsavel_personalizacoes": False,
        }, timeout=30)
        assert r.status_code == 200
        mo_normal = r.json(); created["mo"].append(mo_normal["id"])

        # 2) Mão de Obra responsável pelas personalizações (12€/h)
        r = requests.post(f"{BASE}/api/mao-obra", headers=h, json={
            "nome": "teste-it15-mo-resp", "custo_hora": 12.0,
            "responsavel_personalizacoes": True,
        }, timeout=30)
        assert r.status_code == 200
        mo_resp = r.json(); created["mo"].append(mo_resp["id"])

        # 3) Tipo de personalização com tempo=5min
        r = requests.post(f"{BASE}/api/tipos-personalizacao", headers=h, json={
            "nome": "teste-it15-tp-tempo", "descricao": "", "valor": 0.0, "tempo": 5.0,
        }, timeout=30)
        assert r.status_code == 200
        tp = r.json(); created["tp"] = tp["id"]

        # 4) Artigo com roteiro: 1 operação usa a mão de obra responsável (base 2min)
        artigo_payload = {
            "nome": "teste-it15-art", "descricao": "", "custo_artigo": 1.0, "margem": 30.0,
            "materiais": [],
            "roteiro": [{
                "nome": "Op A", "maquina_id": None, "maquina_nome": None,
                "tempo_maquina": 0.0, "tempo_maquina_unidade": "min",
                "mao_obra_id": mo_resp["id"], "mao_obra_nome": mo_resp["nome"],
                "tempo_mao_obra": 2.0, "tempo_mao_obra_unidade": "min",
            }],
        }
        r = requests.post(f"{BASE}/api/artigos", headers=h, json=artigo_payload, timeout=30)
        assert r.status_code == 200, r.text
        art = r.json(); created["art"] = art["id"]

        # 5) Criar OF com item Q=2 e personalização -> tempo total na op = 2 + 5*2 = 12min
        of_payload = {
            "cliente": "teste-it15-cliente",
            "descricao": "OF de teste it15",
            "itens": [{
                "artigo_id": art["id"], "artigo_nome": art["nome"], "quantidade": 2,
                "personalizacoes": [{"id": tp["id"], "nome": tp["nome"], "valor": 0.0, "tempo": 5.0}],
                "operacoes": [],
            }],
        }
        r = requests.post(f"{BASE}/api/ordens-fabrico", headers=h, json=of_payload, timeout=30)
        assert r.status_code == 200, r.text
        of = r.json(); created["of"] = of["id"]

        item = of["itens"][0]
        ops = item["operacoes"]
        assert len(ops) == 1
        op = ops[0]
        # 12min na op responsável
        assert op["tempo_mao_obra"] == pytest.approx(12.0, abs=0.01), op
        assert op["tempo_mao_obra_base"] == pytest.approx(2.0, abs=0.01)
        # custo: 12/60 * 12€ = 2.4€
        assert op["custo_mao_obra_estimado"] == pytest.approx(2.4, abs=0.01)

        # 6) IDEMPOTÊNCIA: PUT a OF novamente sem mudar nada
        put_payload = {
            "cliente": of["cliente"],
            "descricao": of["descricao"],
            "itens": [{
                "artigo_id": art["id"], "artigo_nome": art["nome"], "quantidade": 2,
                "personalizacoes": [{"id": tp["id"], "nome": tp["nome"], "valor": 0.0, "tempo": 5.0}],
                "operacoes": item["operacoes"],
            }],
        }
        r = requests.put(f"{BASE}/api/ordens-fabrico/{of['id']}", headers=h, json=put_payload, timeout=30)
        assert r.status_code == 200, r.text
        of2 = r.json()
        op2 = of2["itens"][0]["operacoes"][0]
        assert op2["tempo_mao_obra"] == pytest.approx(12.0, abs=0.01), \
            f"NÃO idempotente: {op2['tempo_mao_obra']}"
        assert op2["tempo_mao_obra_base"] == pytest.approx(2.0, abs=0.01)
        assert op2["custo_mao_obra_estimado"] == pytest.approx(2.4, abs=0.01)

        # 7) PUT outra vez — confirma ainda não duplica
        r = requests.put(f"{BASE}/api/ordens-fabrico/{of['id']}", headers=h, json=put_payload, timeout=30)
        assert r.status_code == 200
        op3 = r.json()["itens"][0]["operacoes"][0]
        assert op3["tempo_mao_obra"] == pytest.approx(12.0, abs=0.01)

    finally:
        # cleanup — ordem inversa, sempre
        if created["of"]:
            requests.delete(f"{BASE}/api/ordens-fabrico/{created['of']}", headers=h, timeout=30)
        if created["art"]:
            requests.delete(f"{BASE}/api/artigos/{created['art']}", headers=h, timeout=30)
        if created["tp"]:
            requests.delete(f"{BASE}/api/tipos-personalizacao/{created['tp']}", headers=h, timeout=30)
        for mo_id in created["mo"]:
            requests.delete(f"{BASE}/api/mao-obra/{mo_id}", headers=h, timeout=30)
