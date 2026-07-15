"""
Iteration 20 — Ordens de Fabrico:
  (1) Tempos das operações = tempo_por_unidade × quantidade (escala em conformidade)
  (2) Adicionar/editar/remover operações em OFs (incluindo geradas automaticamente)
  Validations also: idempotência no PUT, alteração de quantidade, regressão personalizações
  e PDF de OF.
"""
import os
import pytest
import requests

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not defined")
    return url.rstrip("/")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@prodcost.pt"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "Admin123!")

created_of_ids: list[str] = []


@pytest.fixture(scope="module")
def auth_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Login admin falhou: {r.status_code} {r.text[:200]}")
    token = r.json().get("token") or r.json().get("access_token")
    if not token:
        pytest.skip(f"Sem token no login: {r.json()}")
    s.headers.update({"Authorization": f"Bearer {token}"})
    yield s
    # cleanup OFs criadas pelo teste
    for ofid in created_of_ids:
        try:
            s.delete(f"{BASE_URL}/api/ordens-fabrico/{ofid}")
        except Exception:
            pass


def _find_artigo_with_roteiro(client):
    """Procura um artigo que tenha roteiro com operações com tempos > 0."""
    r = client.get(f"{BASE_URL}/api/artigos")
    assert r.status_code == 200, r.text
    arts = r.json()
    # Preferência pelo nome conhecido "DTF Têxtil Metro"
    for a in arts:
        if a.get("nome") == "DTF Têxtil Metro" and a.get("roteiro"):
            return a
    for a in arts:
        rot = a.get("roteiro") or []
        if rot and any((op.get("tempo_maquina") or 0) > 0 or (op.get("tempo_mao_obra") or 0) > 0 for op in rot):
            return a
    return None


# ============================== Criação OF: tempos × quantidade ==============================
class TestOFTemposEscalam:
    def test_create_of_tempos_x_qtd(self, auth_client):
        artigo = _find_artigo_with_roteiro(auth_client)
        if not artigo:
            pytest.skip("Sem artigo com roteiro disponível")
        Q = 5
        payload = {
            "cliente": "teste-of-qtd",
            "itens": [{
                "artigo_id": artigo["id"],
                "quantidade": Q,
                "personalizacoes": [],
                "operacoes": [],
            }]
        }
        r = auth_client.post(f"{BASE_URL}/api/ordens-fabrico", json=payload)
        assert r.status_code == 200, r.text
        of = r.json()
        created_of_ids.append(of["id"])

        # GET para validar persistência
        r2 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{of['id']}")
        assert r2.status_code == 200, r2.text
        of = r2.json()
        item = of["itens"][0]
        assert item["quantidade"] == Q
        ops = item["operacoes"]
        assert len(ops) >= 1
        rot_map = {op["nome"]: op for op in artigo["roteiro"]}
        for op in ops:
            base_m = op.get("tempo_maquina_base")
            base_mo = op.get("tempo_mao_obra_base")
            assert base_m is not None, f"falta tempo_maquina_base em {op}"
            assert base_mo is not None, f"falta tempo_mao_obra_base em {op}"
            # corresponde ao roteiro (sem qtd)
            rop = rot_map.get(op["nome"])
            if rop:
                rb_m = rop.get("tempo_maquina") or 0
                rb_mo = rop.get("tempo_mao_obra") or 0
                assert abs(base_m - rb_m) < 0.01
                assert abs(base_mo - rb_mo) < 0.01
            # tempos finais = base × Q
            assert abs(op["tempo_maquina"] - base_m * Q) < 0.01, op
            assert abs(op["tempo_mao_obra"] - base_mo * Q) < 0.01, op
            # custos escalam consistentemente
            maq_rate = op.get("maquina_custo_hora") or 0
            mo_rate = op.get("mao_obra_custo_hora") or 0
            esperado_maq = round((op["tempo_maquina"] / 60.0) * maq_rate, 2)
            esperado_mo = round((op["tempo_mao_obra"] / 60.0) * mo_rate, 2)
            assert abs(op["custo_maquina_estimado"] - esperado_maq) < 0.05
            assert abs(op["custo_mao_obra_estimado"] - esperado_mo) < 0.05

    def test_idempotencia_put_nao_duplica(self, auth_client):
        assert created_of_ids, "OF inicial não foi criada"
        ofid = created_of_ids[0]
        of = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        Q = of["itens"][0]["quantidade"]
        # snapshot bases e tempos
        ops_before = [(op["tempo_maquina_base"], op["tempo_mao_obra_base"], op["tempo_maquina"], op["tempo_mao_obra"]) for op in of["itens"][0]["operacoes"]]
        # PUT sem alterações
        payload = {k: of[k] for k in ("cliente", "itens") if k in of}
        if "encomenda_id" in of and of["encomenda_id"]:
            payload["encomenda_id"] = of["encomenda_id"]
        r = auth_client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json=payload)
        assert r.status_code == 200, r.text
        of2 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        ops_after = [(op["tempo_maquina_base"], op["tempo_mao_obra_base"], op["tempo_maquina"], op["tempo_mao_obra"]) for op in of2["itens"][0]["operacoes"]]
        assert of2["itens"][0]["quantidade"] == Q
        assert ops_before == ops_after, f"Tempos mudaram após PUT idempotente: {ops_before} -> {ops_after}"

    def test_alterar_quantidade_2Q(self, auth_client):
        assert created_of_ids
        ofid = created_of_ids[0]
        of = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        Q = of["itens"][0]["quantidade"]
        novoQ = Q * 2
        of["itens"][0]["quantidade"] = novoQ
        payload = {"cliente": of.get("cliente"), "itens": of["itens"]}
        r = auth_client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json=payload)
        assert r.status_code == 200, r.text
        of2 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        assert of2["itens"][0]["quantidade"] == novoQ
        for op in of2["itens"][0]["operacoes"]:
            base_m = op["tempo_maquina_base"]
            base_mo = op["tempo_mao_obra_base"]
            assert abs(op["tempo_maquina"] - base_m * novoQ) < 0.01
            assert abs(op["tempo_mao_obra"] - base_mo * novoQ) < 0.01


# ============================== Operação manual: add / remove ==============================
class TestOFOperacoesManuais:
    def test_add_manual_op_then_remove(self, auth_client):
        artigo = _find_artigo_with_roteiro(auth_client)
        if not artigo:
            pytest.skip("Sem artigo")
        Q = 4
        payload = {
            "cliente": "teste-of-manual",
            "itens": [{"artigo_id": artigo["id"], "quantidade": Q, "personalizacoes": [], "operacoes": []}]
        }
        r = auth_client.post(f"{BASE_URL}/api/ordens-fabrico", json=payload)
        assert r.status_code == 200, r.text
        of = r.json()
        ofid = of["id"]
        created_of_ids.append(ofid)
        # Buscar uma máquina e mão de obra para a operação manual (opcional)
        maquinas = auth_client.get(f"{BASE_URL}/api/maquinas").json()
        mao_obras = auth_client.get(f"{BASE_URL}/api/mao-obra").json()
        maq = next((m for m in maquinas if (m.get("custo_hora") or 0) > 0), None) or (maquinas[0] if maquinas else None)
        mo = next((m for m in mao_obras if (m.get("custo_hora") or 0) > 0), None) or (mao_obras[0] if mao_obras else None)

        of = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        item = of["itens"][0]
        nova_op = {
            "nome": "teste-op-manual",
            "tempo_maquina_base": 3.0,
            "tempo_mao_obra_base": 2.0,
            "tempo_maquina": 3.0,
            "tempo_mao_obra": 2.0,
            "manual": True,
        }
        if maq:
            nova_op["maquina_id"] = maq["id"]
            nova_op["maquina_nome"] = maq.get("nome")
        if mo:
            nova_op["mao_obra_id"] = mo["id"]
            nova_op["mao_obra_nome"] = mo.get("nome")
        item["operacoes"].append(nova_op)
        r = auth_client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json={"cliente": of["cliente"], "itens": of["itens"]})
        assert r.status_code == 200, r.text

        of2 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        ops = of2["itens"][0]["operacoes"]
        manual = next((o for o in ops if o["nome"] == "teste-op-manual"), None)
        assert manual is not None, "Operação manual não persistiu"
        # tempo total = base × qtd
        assert abs(manual["tempo_maquina"] - 3.0 * Q) < 0.01
        assert abs(manual["tempo_mao_obra"] - 2.0 * Q) < 0.01
        # custos resolvidos pelas taxas das máquinas/MO
        if maq and (maq.get("custo_hora") or 0) > 0:
            assert manual.get("maquina_custo_hora", 0) > 0, f"maquina_custo_hora não resolvido: {manual}"
            assert manual["custo_maquina_estimado"] > 0
        if mo and (mo.get("custo_hora") or 0) > 0:
            assert manual.get("mao_obra_custo_hora", 0) > 0
            assert manual["custo_mao_obra_estimado"] > 0

        # remover op manual
        of2["itens"][0]["operacoes"] = [o for o in of2["itens"][0]["operacoes"] if o["nome"] != "teste-op-manual"]
        r = auth_client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json={"cliente": of2["cliente"], "itens": of2["itens"]})
        assert r.status_code == 200, r.text
        of3 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        names = [o["nome"] for o in of3["itens"][0]["operacoes"]]
        assert "teste-op-manual" not in names

    def test_editar_tempos_e_recursos_op_existente(self, auth_client):
        artigo = _find_artigo_with_roteiro(auth_client)
        if not artigo:
            pytest.skip()
        Q = 3
        r = auth_client.post(f"{BASE_URL}/api/ordens-fabrico", json={
            "cliente": "teste-of-edit", "itens": [{"artigo_id": artigo["id"], "quantidade": Q, "personalizacoes": [], "operacoes": []}]
        })
        assert r.status_code == 200, r.text
        ofid = r.json()["id"]
        created_of_ids.append(ofid)
        of = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        if not of["itens"][0]["operacoes"]:
            pytest.skip("Sem operações do roteiro para editar")
        # alterar tempo_maquina_base e tempo_mao_obra_base da primeira op
        op = of["itens"][0]["operacoes"][0]
        novo_base_maq = (op.get("tempo_maquina_base") or 1) + 7
        novo_base_mo = (op.get("tempo_mao_obra_base") or 1) + 4
        op["tempo_maquina_base"] = novo_base_maq
        op["tempo_mao_obra_base"] = novo_base_mo
        # forçar tempos por unidade nos campos principais também
        op["tempo_maquina"] = novo_base_maq
        op["tempo_mao_obra"] = novo_base_mo
        r = auth_client.put(f"{BASE_URL}/api/ordens-fabrico/{ofid}", json={"cliente": of["cliente"], "itens": of["itens"]})
        assert r.status_code == 200, r.text
        of2 = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        op2 = of2["itens"][0]["operacoes"][0]
        assert abs(op2["tempo_maquina_base"] - novo_base_maq) < 0.01
        assert abs(op2["tempo_mao_obra_base"] - novo_base_mo) < 0.01
        assert abs(op2["tempo_maquina"] - novo_base_maq * Q) < 0.01
        assert abs(op2["tempo_mao_obra"] - novo_base_mo * Q) < 0.01
        # custo recalculado consistente com as taxas guardadas
        maq_rate = op2.get("maquina_custo_hora") or 0
        mo_rate = op2.get("mao_obra_custo_hora") or 0
        assert abs(op2["custo_maquina_estimado"] - round((op2["tempo_maquina"] / 60.0) * maq_rate, 2)) < 0.05
        assert abs(op2["custo_mao_obra_estimado"] - round((op2["tempo_mao_obra"] / 60.0) * mo_rate, 2)) < 0.05


# ============================== Regressão personalizações ==============================
class TestRegressaoPersonalizacoes:
    def test_personalizacao_soma_a_mo(self, auth_client):
        # encontrar artigo + tipo de personalização
        tipos = auth_client.get(f"{BASE_URL}/api/tipos-personalizacao")
        if tipos.status_code != 200:
            pytest.skip("Sem endpoint tipos-personalizacao")
        tipos = tipos.json()
        # usar o primeiro tipo, fornecendo o campo 'tempo' inline (>0)
        tipo = tipos[0] if tipos else None
        if not tipo:
            pytest.skip("Sem tipos de personalização")
        pers_tempo = 2.5  # min por unidade (override inline)
        artigo = _find_artigo_with_roteiro(auth_client)
        if not artigo:
            pytest.skip()
        Q = 3
        payload = {
            "cliente": "teste-of-pers",
            "itens": [{
                "artigo_id": artigo["id"], "quantidade": Q,
                "personalizacoes": [{"id": tipo["id"], "nome": tipo.get("nome"), "tempo": pers_tempo}],
                "operacoes": [],
            }]
        }
        r = auth_client.post(f"{BASE_URL}/api/ordens-fabrico", json=payload)
        assert r.status_code == 200, r.text
        ofid = r.json()["id"]
        created_of_ids.append(ofid)
        of = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}").json()
        ops = of["itens"][0]["operacoes"]
        # algum op deve ter mo_total ≥ base * Q + (tempo_pers × Q)
        pers_total = pers_tempo * Q
        # somar (mo_total - base * Q) entre todas operações deve ser ≈ pers_total
        excedente = 0.0
        for op in ops:
            excedente += (op["tempo_mao_obra"] - (op.get("tempo_mao_obra_base") or 0) * Q)
        assert abs(excedente - pers_total) < 0.1, f"Personalização não somada: excedente={excedente}, esperado={pers_total}"


# ============================== PDF de OF ==============================
class TestOFPdf:
    def test_pdf_of_gera(self, auth_client):
        if not created_of_ids:
            pytest.skip("Sem OF criada")
        ofid = created_of_ids[0]
        r = auth_client.get(f"{BASE_URL}/api/ordens-fabrico/{ofid}/pdf")
        assert r.status_code == 200, r.text[:200]
        assert r.content[:4] == b"%PDF", f"resposta não começa com %PDF: {r.content[:8]}"
