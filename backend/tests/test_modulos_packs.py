"""Módulos do sistema / packs por cliente."""
import requests
from conftest import get_base_url, get_admin_credentials

BASE = get_base_url()
API = f"{BASE}/api"


def test_ordens_fabrico_e_modulo_do_catalogo():
    email, password = get_admin_credentials()
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})

    me = s.get(f"{API}/auth/me").json()
    assert "ordens_fabrico" in (me.get("modulos_ativos") or [])

    cat = s.get(f"{API}/settings/modulos")
    assert cat.status_code == 200, cat.text
    data = cat.json()
    keys = {m["key"] for m in data["modulos"]}
    assert "ordens_fabrico" in keys
    of = next(m for m in data["modulos"] if m["key"] == "ordens_fabrico")
    assert of["pack"] == "producao"
    assert of["core"] is False
    assert "ordens_fabrico" in data["ativos"]

    rbac = s.get(f"{API}/rbac/modulos")
    assert rbac.status_code == 200
    assert "ordens_fabrico" in {m["key"] for m in rbac.json()["modulos"]}
    assert "nao_conformidades" in {m["key"] for m in rbac.json()["modulos"]}
    nc = next(m for m in data["modulos"] if m["key"] == "nao_conformidades")
    assert nc["pack"] == "producao"
    assert nc["core"] is False

    fin = next(m for m in data["modulos"] if m["key"] == "financeiro")
    assert fin["core"] is False
    assert fin["pack"] == "financeiro"
    assert "fatura" in (fin["label"] or "").lower() or "recibo" in (fin["label"] or "").lower()

    contas = next(m for m in data["modulos"] if m["key"] == "contas")
    assert contas["core"] is False
    assert contas["pack"] == "contas"
    assert "pagar" in (contas["label"] or "").lower() or "receber" in (contas["label"] or "").lower()
    assert "contas" in {m["key"] for m in rbac.json()["modulos"]}
