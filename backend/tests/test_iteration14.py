"""Iteration 14 tests — Encomendas filter by estado, prazo_entrega, OF ordering, OF prioritaria.

Covers:
- EncomendaInput accepts prazo_entrega and is persisted
- OF list returns prazo_entrega + encomenda_numero attached
- OF list sorted: prioritaria first, then prazo_entrega asc, then created_at
- POST /api/ordens-fabrico/{id}/prioridade toggles flag
- PUT preserves prioritaria
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


def _load_admin_creds():
    email = os.environ.get("TEST_ADMIN_EMAIL")
    pwd = os.environ.get("TEST_ADMIN_PASSWORD")
    if email and pwd:
        return email, pwd
    txt = open("/app/memory/test_credentials.md").read()
    m_e = re.search(r"Email:\s*`([^`]+)`", txt)
    m_p = re.search(r"Password:\s*`([^`]+)`", txt)
    if m_e and m_p:
        return m_e.group(1), m_p.group(1)
    raise RuntimeError("Credenciais de teste em falta (TEST_ADMIN_* ou test_credentials.md)")


@pytest.fixture(scope="module")
def auth_token():
    email, pwd = _load_admin_creds()
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(auth_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {auth_token}"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    return {"encs": [], "ofs": []}


def test_create_encomendas_with_prazo(client, created_ids):
    """Create two encomendas with different prazos."""
    payloads = [
        {"cliente": "teste-cli-it14-A", "descricao": "teste-it14-A",
         "prazo_entrega": "2026-07-01", "artigos": []},
        {"cliente": "teste-cli-it14-B", "descricao": "teste-it14-B",
         "prazo_entrega": "2026-12-31", "artigos": []},
    ]
    for p in payloads:
        r = client.post(f"{BASE_URL}/api/encomendas", json=p)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["prazo_entrega"] == p["prazo_entrega"]
        assert "id" in data and "numero" in data
        created_ids["encs"].append(data["id"])

    # GET verifies persistence
    for eid, expected in zip(created_ids["encs"], ["2026-07-01", "2026-12-31"]):
        r = client.get(f"{BASE_URL}/api/encomendas/{eid}")
        assert r.status_code == 200
        assert r.json()["prazo_entrega"] == expected


def test_create_ofs_and_check_ordering(client, created_ids):
    """Create 1 OF for each encomenda. Then OF list should have the one with
    closest prazo first."""
    # encs[0] = 2026-07-01 (closer), encs[1] = 2026-12-31
    for eid in created_ids["encs"]:
        enc = client.get(f"{BASE_URL}/api/encomendas/{eid}").json()
        r = client.post(f"{BASE_URL}/api/ordens-fabrico", json={
            "cliente": enc["cliente"],
            "descricao": f"teste-it14-of-{eid[:6]}",
            "encomenda_id": eid,
            "itens": [],
        })
        assert r.status_code == 200, r.text
        of = r.json()
        assert of.get("encomenda_id") == eid
        created_ids["ofs"].append(of["id"])

    r = client.get(f"{BASE_URL}/api/ordens-fabrico")
    assert r.status_code == 200
    ofs = r.json()
    # Find our two OFs
    our = [o for o in ofs if o["id"] in created_ids["ofs"]]
    assert len(our) == 2
    # The one with prazo 2026-07-01 (encs[0]) must come BEFORE the one with 2026-12-31
    idx_a = next(i for i, o in enumerate(ofs) if o["id"] == created_ids["ofs"][0])
    idx_b = next(i for i, o in enumerate(ofs) if o["id"] == created_ids["ofs"][1])
    assert idx_a < idx_b, f"OF with closer prazo should come first; idx_a={idx_a} idx_b={idx_b}"

    # Check attached fields
    of_a = ofs[idx_a]
    assert of_a.get("prazo_entrega") == "2026-07-01"
    assert of_a.get("encomenda_numero")  # not empty


def test_toggle_prioridade_moves_to_top(client, created_ids):
    """Mark the second OF (later prazo) as prioritaria — it should jump to top."""
    of_b_id = created_ids["ofs"][1]
    r = client.post(f"{BASE_URL}/api/ordens-fabrico/{of_b_id}/prioridade",
                    json={"prioritaria": True})
    assert r.status_code == 200, r.text
    assert r.json().get("prioritaria") is True

    # List — of_b should appear before of_a
    ofs = client.get(f"{BASE_URL}/api/ordens-fabrico").json()
    idx_a = next(i for i, o in enumerate(ofs) if o["id"] == created_ids["ofs"][0])
    idx_b = next(i for i, o in enumerate(ofs) if o["id"] == created_ids["ofs"][1])
    assert idx_b < idx_a, "Prioritaria OF should be before non-prioritaria"


def test_put_preserves_prioridade(client, created_ids):
    """PUT on the priority OF should preserve prioritaria=True."""
    ofid = created_ids["ofs"][1]
    cur = client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
    assert cur.get("prioritaria") is True
    body = {
        "cliente": cur["cliente"],
        "cliente_id": cur.get("cliente_id"),
        "encomenda_id": cur.get("encomenda_id"),
        "descricao": cur.get("descricao") or "",
        "numero_encomenda": cur.get("numero_encomenda") or "",
        "data": cur.get("data"),
        "status": cur.get("status") or "pendente",
        "notas": cur.get("notas") or "",
        "prioritaria": True,
        "itens": cur.get("itens") or [],
    }
    r = client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json=body)
    assert r.status_code == 200, r.text
    assert r.json().get("prioritaria") is True

    # Re-fetch
    after = client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
    assert after.get("prioritaria") is True


def test_encomenda_estado_field_present(client, created_ids):
    """Encomendas have estado field — used by frontend filter Pendentes/Concluidas/Todas."""
    enc = client.get(f"{BASE_URL}/api/encomendas/{created_ids['encs'][0]}").json()
    assert "estado" in enc
    # Default estado for new encomenda (without concluded OFs) should NOT be 'concluida'
    assert enc.get("estado") != "concluida"

    # List endpoint should return estado for filtering
    encs = client.get(f"{BASE_URL}/api/encomendas").json()
    mine = [e for e in encs if e["id"] in created_ids["encs"]]
    assert len(mine) == 2
    assert all("estado" in e for e in mine)


def test_zz_cleanup(client, created_ids):
    """Cleanup: delete test OFs and encomendas."""
    for ofid in created_ids["ofs"]:
        client.delete(f"{BASE_URL}/api/ordens-fabrico/{ofid}")
    for eid in created_ids["encs"]:
        client.delete(f"{BASE_URL}/api/encomendas/{eid}")
