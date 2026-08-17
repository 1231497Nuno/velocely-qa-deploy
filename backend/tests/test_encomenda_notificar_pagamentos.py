"""Notificar prazo/pronta e pagamentos na encomenda (independentes do módulo de faturas)."""
import pytest
import requests
from conftest import get_base_url, get_admin_credentials

BASE = get_base_url()
API = f"{BASE}/api"
ADMIN_EMAIL, ADMIN_PASSWORD = get_admin_credentials()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    yield s


def test_email_templates_incluem_prazo_e_pronta(client):
    r = client.get(f"{API}/settings/email-templates")
    assert r.status_code == 200, r.text
    tipos = {t["tipo"] for t in r.json()}
    assert "encomenda_pronta" in tipos
    assert "encomenda_prazo" in tipos
    for tipo in ("encomenda_pronta", "encomenda_prazo"):
        tpl = next(t for t in r.json() if t["tipo"] == tipo)
        keys = {p["key"] for p in (tpl.get("placeholders") or [])}
        assert "valores_faturar" in keys
        assert "valor_a_faturar" in keys


def test_notificar_prazo_exige_data_entrega(client):
    r = client.post(f"{API}/encomendas", json={"cliente": "Teste Notificar Prazo", "artigos": []})
    assert r.status_code == 200, r.text
    enc = r.json()
    eid = enc["id"]
    try:
        re = client.post(
            f"{API}/encomendas/{eid}/enviar-email-prazo",
            json={"to": "cliente@example.com"},
        )
        assert re.status_code == 400, re.text
        detail = (re.json() or {}).get("detail") or ""
        assert "entrega" in detail.lower() or "prazo" in detail.lower()
    finally:
        client.delete(f"{API}/encomendas/{eid}")


def test_pagamento_na_encomenda_sem_fatura(client):
    r = client.post(f"{API}/encomendas", json={"cliente": "Teste Pagamento Enc", "artigos": []})
    assert r.status_code == 200, r.text
    enc = r.json()
    eid = enc["id"]
    try:
        rp = client.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 12.5, "metodo": "transferencia", "nota": "sinal"},
        )
        assert rp.status_code == 200, rp.text
        data = rp.json()
        assert data.get("valor_pago") == 12.5
        pags = data.get("pagamentos") or []
        assert len(pags) == 1
        pag = pags[0]
        assert pag["valor"] == 12.5
        assert (pag.get("recibo_numero") or "").startswith("REC-")
        assert pag.get("origem") in (None, "", "encomenda")
        assert pag.get("tipo") in (None, "", "pagamento")
        assert (data.get("percentual_pago") or 0) >= 0

        rd = client.delete(f"{API}/encomendas/{eid}/pagamentos/{pag['id']}")
        assert rd.status_code == 200, rd.text
        assert pag["id"] not in [p["id"] for p in (rd.json().get("pagamentos") or [])]
        assert (rd.json().get("valor_pago") or 0) == 0
    finally:
        client.delete(f"{API}/encomendas/{eid}")


def test_devolucao_reduz_pago_e_percentual(client):
    r = client.post(
        f"{API}/encomendas",
        json={
            "cliente": "Teste Devolucao Enc",
            "artigos": [],
            "valor_total": 100.0,
            "valor_total_manual": True,
        },
    )
    assert r.status_code == 200, r.text
    enc = r.json()
    eid = enc["id"]
    try:
        rp = client.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 40, "metodo": "transferencia", "nota": "sinal"},
        )
        assert rp.status_code == 200, rp.text
        pago = rp.json()
        assert pago.get("valor_pago") == 40
        assert pago.get("status_pagamento") == "parcial"
        base = pago.get("total_com_iva") or 100
        expected_pct = round(min(100.0, (40 / base) * 100) + 1e-9, 2)
        assert pago.get("percentual_pago") == expected_pct
        assert (pago.get("valor_devolvido") or 0) == 0

        too_much = client.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 40.01, "tipo": "devolucao"},
        )
        assert too_much.status_code == 400, too_much.text

        rd = client.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 10, "metodo": "transferencia", "tipo": "devolucao", "nota": "anulação parcial"},
        )
        assert rd.status_code == 200, rd.text
        data = rd.json()
        assert data.get("valor_pago") == 30
        assert data.get("valor_devolvido") == 10
        assert data.get("status_pagamento") == "parcial"
        expected_pct2 = round(min(100.0, (30 / base) * 100) + 1e-9, 2)
        assert data.get("percentual_pago") == expected_pct2
        devs = [p for p in (data.get("pagamentos") or []) if p.get("tipo") == "devolucao"]
        assert len(devs) == 1
        assert (devs[0].get("recibo_numero") or "").startswith("DEV-")

        none = client.post(
            f"{API}/encomendas/{eid}/pagamentos",
            json={"valor": 10, "tipo": "outro"},
        )
        assert none.status_code == 400, none.text
    finally:
        client.delete(f"{API}/encomendas/{eid}")
