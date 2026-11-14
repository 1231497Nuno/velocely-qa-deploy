"""Testes unitários leves — correm no CI sem API/Mongo."""
from app.domain.models import ArtigoInput, ClienteContacto, PAPEL_CONTACTO_PT
from app.services.contactos import contacto_papeis, denorm_contacto, label_papeis


def test_artigo_input_coerces_null_floats_and_strings():
    a = ArtigoInput(
        nome="Teste",
        preco_compra=None,
        conta_proveitos=None,
        custo_artigo=None,
        margem=None,
        tipo_artigo="ativo",
    )
    assert a.preco_compra == 0.0
    assert a.custo_artigo == 0.0
    assert a.margem == 0.0
    assert a.conta_proveitos == ""


def test_contacto_papeis_normaliza_e_deduz_do_cargo():
    c = ClienteContacto(nome="Maria", papeis=["Financeiro", "comprador"], cargo="")
    assert c.papeis == ["financeiro", "decisor"]
    assert "Financeiro" in PAPEL_CONTACTO_PT["financeiro"]

    legado = {"nome": "João", "cargo": "Designer gráfico", "papeis": []}
    assert contacto_papeis(legado) == ["tecnico"]
    assert "Técnico" in label_papeis(legado)


def test_denorm_contacto_inclui_papeis():
    d = denorm_contacto({
        "id": "c1",
        "nome": "Ana",
        "email": "ana@x.pt",
        "telefone": "900",
        "cargo": "CFO",
        "departamento": "Finanças",
        "papeis": ["financeiro"],
    })
    assert d["contacto_id"] == "c1"
    assert d["contacto_papeis"] == ["financeiro"]
    assert denorm_contacto(None)["contacto_id"] is None
