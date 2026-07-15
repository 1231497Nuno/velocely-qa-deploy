"""Serviço de geração de PDF (Orçamentos, OFs, Encomendas)."""
from io import BytesIO
import base64
from typing import Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, Image,
)

from app.core.database import round2
from app.domain.models import STATUS_PT, PAY_PT, ENC_ESTADO_PT
from app.services.costing import (
    compute_orcamento_totais, pers_valor_unit, pers_nomes,
    material_custo, material_margem_factor,
)
from app.repositories import empresa_repo, pdf_templates_repo, clientes_repo, orcamentos_repo

DARK = colors.HexColor("#0A0A0A")
GREY = colors.HexColor("#6B7280")
LIGHT = colors.HexColor("#F3F4F6")
LINE = colors.HexColor("#E5E7EB")


PDF_CURRENCY = "€"


def fmt_eur(v) -> str:
    s = f"{(v or 0):,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} {PDF_CURRENCY}"


def _set_currency(settings):
    global PDF_CURRENCY
    PDF_CURRENCY = (settings or {}).get("moeda_simbolo") or "€"


def _pdf_styles():
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=22, textColor=DARK, spaceAfter=2),
        "brand": ParagraphStyle("brand", fontName="Helvetica-Bold", fontSize=16, textColor=DARK),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, textColor=GREY),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=GREY),
        "val": ParagraphStyle("val", fontName="Helvetica", fontSize=10, textColor=DARK),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=9, textColor=DARK),
        "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=9, textColor=DARK),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, textColor=colors.white),
    }


def _logo_flowable(b64: str):
    if not b64:
        return None
    try:
        if b64.strip().startswith("data:") and "," in b64:
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        img = Image(BytesIO(raw))
        iw, ih = float(img.imageWidth), float(img.imageHeight)
        if iw <= 0 or ih <= 0:
            return None
        ratio = min((45 * mm) / iw, (16 * mm) / ih)
        img.drawWidth = iw * ratio
        img.drawHeight = ih * ratio
        return img
    except Exception:
        return None


def section_on(fields: dict, key: str) -> bool:
    if not fields:
        return True
    return bool(fields.get(key, True))


_CLIENTE_META = [
    ("cliente_nome", "Cliente", "nome"),
    ("cliente_nif", "NIF", "nif"),
    ("cliente_morada", "Morada", "morada"),
    ("cliente_codigo_postal", "Cód. Postal", "codigo_postal"),
    ("cliente_cidade", "Cidade", "cidade"),
    ("cliente_pais", "País", "pais"),
    ("cliente_telefone", "Telefone", "contacto"),
    ("cliente_email", "Email", "email"),
]


def cliente_meta_pairs(record: dict, cliente: dict, fields: dict) -> list:
    c = cliente or {}
    pairs = []
    for fkey, label, ckey in _CLIENTE_META:
        if not section_on(fields, fkey):
            continue
        val = (c.get("nome") or record.get("cliente")) if fkey == "cliente_nome" else c.get(ckey)
        if val:
            pairs.append((label, val))
    return pairs


def orcamento_origem_pairs(orc: dict) -> list:
    if not orc:
        return []
    t = compute_orcamento_totais(orc)
    return [
        ("Orçamento origem", orc.get("numero")),
        ("Data orçamento", orc.get("data")),
        ("Total orçamento", fmt_eur(t.get("total"))),
    ]


def _header(elems, st, doc_title, numero, meta_pairs, settings=None, show_branding=True):
    settings = settings or {}
    left_flowables = []
    if show_branding and (settings.get("nome") or settings.get("logo_base64")):
        logo = _logo_flowable(settings.get("logo_base64"))
        if logo:
            left_flowables.append(logo)
            left_flowables.append(Spacer(1, 4))
        left_flowables.append(Paragraph(f"<b>{settings.get('nome') or ''}</b>", st["brand"]))
        contact = []
        morada_line = " ".join(x for x in [settings.get("morada"), settings.get("codigo_postal"), settings.get("cidade")] if x)
        if morada_line:
            contact.append(morada_line)
        if settings.get("pais"):
            contact.append(settings.get("pais"))
        if settings.get("nif"):
            contact.append(f"NIF: {settings.get('nif')}")
        line2 = " · ".join(x for x in [settings.get("telefone"), settings.get("email"), settings.get("website")] if x)
        for c in contact:
            left_flowables.append(Paragraph(c, st["small"]))
        if line2:
            left_flowables.append(Paragraph(line2, st["small"]))
    else:
        left_flowables.append(Paragraph("Gestão <font color='#9CA3AF'>Produção</font>", st["brand"]))

    head = Table(
        [[left_flowables, Paragraph(doc_title, st["h1"])]],
        colWidths=[95 * mm, 75 * mm],
    )
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    elems.append(head)
    elems.append(Paragraph(f"<b>{numero}</b>", ParagraphStyle("num", fontName="Helvetica-Bold", fontSize=11, textColor=GREY, alignment=2)))
    elems.append(Spacer(1, 6))
    elems.append(HRFlowable(width="100%", thickness=1, color=DARK))
    elems.append(Spacer(1, 10))
    rows = []
    for label, value in meta_pairs:
        rows.append([Paragraph(label.upper(), st["label"]), Paragraph(str(value or "—"), st["val"])])
    meta = Table(rows, colWidths=[40 * mm, 130 * mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(meta)
    elems.append(Spacer(1, 12))


def _pdf_footer(elems, st, settings):
    settings = settings or {}
    cond = settings.get("condicoes_pagamento")
    if cond:
        elems.append(Spacer(1, 10))
        elems.append(Paragraph(f"<b>Condições de pagamento:</b> {cond}", st["small"]))
    rodape = settings.get("rodape")
    if rodape:
        elems.append(Spacer(1, 16))
        elems.append(HRFlowable(width="100%", thickness=0.5, color=LINE))
        elems.append(Spacer(1, 4))
        elems.append(Paragraph(rodape, st["small"]))


_TABLE_BASE_STYLE = [
    ("BACKGROUND", (0, 0), (-1, 0), DARK),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
]


def _th_row(st, cols):
    return [Paragraph(t, st["th"]) for t in cols]


def _data_table(data, col_widths, align=None, hAlign=None):
    kwargs = {"hAlign": hAlign} if hAlign else {}
    tbl = Table(data, colWidths=col_widths, **kwargs)
    tbl.setStyle(TableStyle(_TABLE_BASE_STYLE + (align or [])))
    return tbl


def _totais_table(rows, has_total_line):
    last = len(rows) - 1
    tot = Table(rows, colWidths=[50 * mm, 35 * mm], hAlign="RIGHT")
    styles = [
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), GREY),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if has_total_line:
        styles += [
            ("LINEABOVE", (0, last), (-1, last), 1, DARK),
            ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
            ("FONTSIZE", (0, last), (-1, last), 13),
            ("TEXTCOLOR", (0, last), (-1, last), DARK),
        ]
    tot.setStyle(TableStyle(styles))
    return tot


def build_orcamento_pdf(orc: dict, settings: dict = None, fields: dict = None, show_branding: bool = True, cliente: dict = None) -> bytes:
    _set_currency(settings)
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    meta_pairs = []
    if section_on(fields, "dados_cliente"):
        meta_pairs += cliente_meta_pairs(orc, cliente, fields)
        meta_pairs += [("Descrição", orc.get("descricao")), ("Nº Encomenda", orc.get("numero_encomenda"))]
    if section_on(fields, "datas_estado"):
        meta_pairs += [("Data", orc.get("data")), ("Validade", orc.get("validade")), ("Estado", STATUS_PT.get(orc.get("status"), orc.get("status")))]
    _header(elems, st, "ORÇAMENTO", orc.get("numero", ""), meta_pairs, settings, show_branding)

    show_pers = section_on(fields, "personalizacoes")
    if section_on(fields, "linhas_artigos"):
        cols = ["Artigo"] + (["Personalização", "Pers. €/un"] if show_pers else []) + ["Qtd", "Preço Unit.", "Subtotal"]
        data = [_th_row(st, cols)]
        for l in orc.get("linhas", []):
            qtd = l.get("quantidade") or 0
            preco = l.get("preco_unit") or 0
            pers = pers_valor_unit(l)
            sub = (preco + pers) * qtd
            row = [Paragraph(l.get("artigo_nome") or "—", st["cell"])]
            if show_pers:
                row += [Paragraph(pers_nomes(l) or "—", st["cell"]), Paragraph(fmt_eur(pers), st["cell"])]
            row += [Paragraph(f"{qtd:g}", st["cell"]), Paragraph(fmt_eur(preco), st["cell"]), Paragraph(fmt_eur(sub), st["cellb"])]
            data.append(row)
        col_widths = [55 * mm] + ([35 * mm, 22 * mm] if show_pers else []) + ([20 * mm, 30 * mm, 23 * mm] if not show_pers else [15 * mm, 25 * mm, 18 * mm])
        tbl = _data_table(data, col_widths, align=[
            ("ALIGN", (-3, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ])
        elems.append(tbl)
        elems.append(Spacer(1, 14))

    materiais = orc.get("materiais") or []
    if materiais and section_on(fields, "materiais"):
        elems.append(Paragraph("Materiais / Consumíveis", st["cellb"]))
        elems.append(Spacer(1, 4))
        mhead = _th_row(st, ["Material", "Unidade", "Dimensões", "Qtd", "Custo", "Margem", "Valor"])
        mdata = [mhead]
        for m in materiais:
            unidade = (m.get("unidade") or "").lower()
            dims = f"{m.get('comprimento_mm') or 0:g}×{m.get('largura_mm') or 0:g} mm" if unidade in ("m²", "m2") else "—"
            margem = m.get("margem")
            margem = 50.0 if margem is None else margem
            mdata.append([
                Paragraph(m.get("nome") or "—", st["cell"]),
                Paragraph(m.get("unidade") or "—", st["cell"]),
                Paragraph(dims, st["cell"]),
                Paragraph(f"{m.get('quantidade') or 0:g}", st["cell"]),
                Paragraph(fmt_eur(material_custo(m)), st["cell"]),
                Paragraph(f"{margem:g}%", st["cell"]),
                Paragraph(fmt_eur(round2(material_custo(m) * material_margem_factor(m))), st["cellb"]),
            ])
        mtbl = _data_table(mdata, [44 * mm, 20 * mm, 30 * mm, 14 * mm, 22 * mm, 18 * mm, 22 * mm], align=[
            ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (2, -1), "LEFT"),
        ])
        elems.append(mtbl)
        elems.append(Spacer(1, 14))

    if section_on(fields, "totais"):
        tot_rows = [["Preço dos artigos", fmt_eur(orc.get("subtotal_venda"))]]
        if (orc.get("total_personalizacao") or 0) > 0:
            tot_rows.append(["Personalização", fmt_eur(orc.get("total_personalizacao"))])
        if (orc.get("total_materiais") or 0) > 0:
            tot_rows.append(["Materiais", fmt_eur(orc.get("total_materiais"))])
        if (orc.get("desconto_linhas") or 0) > 0:
            tot_rows.append(["Desconto linhas", "- " + fmt_eur(orc.get("desconto_linhas"))])
        if (orc.get("desconto_total_valor") or 0) > 0:
            tot_rows.append(["Desconto total", "- " + fmt_eur(orc.get("desconto_total_valor"))])
        tot_rows.append(["PREÇO FINAL", fmt_eur(orc.get("total"))])
        s = settings or {}
        iva_taxa = 0.0 if s.get("iva_isento") else float(s.get("iva_taxa") or 0)
        if iva_taxa > 0:
            net = orc.get("total") or 0
            iva_val = round2(net * iva_taxa / 100.0)
            tot_rows.append([f"IVA ({iva_taxa:g}%)", fmt_eur(iva_val)])
            tot_rows.append(["TOTAL C/ IVA", fmt_eur(net + iva_val)])
        elif s.get("iva_isento"):
            tot_rows.append(["Isento de IVA", ""])
        last = len(tot_rows) - 1
        tot = Table(tot_rows, colWidths=[45 * mm, 35 * mm], hAlign="RIGHT")
        tot.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("FONTNAME", (0, 0), (-1, last - 1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, last - 1), 9),
            ("TEXTCOLOR", (0, 0), (-1, last - 1), GREY),
            ("LINEABOVE", (0, last), (-1, last), 1, DARK),
            ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
            ("FONTSIZE", (0, last), (-1, last), 13),
            ("TEXTCOLOR", (0, last), (-1, last), DARK),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elems.append(tot)

    if section_on(fields, "notas") and orc.get("notas"):
        elems.append(Spacer(1, 10))
        elems.append(Paragraph(f"<b>Notas:</b> {orc.get('notas')}", st["small"]))
    _pdf_footer(elems, st, settings)
    doc.build(elems)
    return buf.getvalue()


def build_of_pdf(of: dict, settings: dict = None, fields: dict = None, show_branding: bool = True, cliente: dict = None, orcamento: dict = None) -> bytes:
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    meta_pairs = []
    if section_on(fields, "dados_cliente"):
        meta_pairs += cliente_meta_pairs(of, cliente, fields)
        meta_pairs += [("Descrição", of.get("descricao")), ("Nº Encomenda", of.get("numero_encomenda"))]
    if section_on(fields, "datas_estado"):
        meta_pairs += [("Data", of.get("data")), ("Estado", STATUS_PT.get(of.get("status"), of.get("status"))), ("Progresso", f"{round(of.get('progresso') or 0)}%")]
    if section_on(fields, "orcamento_origem"):
        meta_pairs += orcamento_origem_pairs(orcamento)
    _header(elems, st, "ORDEM DE FABRICO", of.get("numero", ""), meta_pairs, settings, show_branding)

    show_tempos = section_on(fields, "tempos")
    if section_on(fields, "roteiro_operacoes"):
        for it in of.get("itens", []):
            title = f"{it.get('artigo_nome') or 'Artigo'}  ×{it.get('quantidade') or 0:g}"
            _pn = pers_nomes(it)
            if _pn:
                title += f"   ·   {_pn}"
            elems.append(Paragraph(title, st["cellb"]))
            elems.append(Spacer(1, 4))
            if show_tempos:
                cols = ["Operação", "Máquina", "T. Máq", "Mão de Obra", "T. M.O", "T. Real", "Concl."]
                col_widths = [33 * mm, 31 * mm, 17 * mm, 31 * mm, 17 * mm, 18 * mm, 13 * mm]
            else:
                cols = ["Operação", "Máquina", "Mão de Obra", "Concl."]
                col_widths = [55 * mm, 45 * mm, 45 * mm, 15 * mm]
            data = [_th_row(st, cols)]
            for op in it.get("operacoes", []):
                concl = Paragraph("Sim" if op.get("concluida") else "—", st["cellb"] if op.get("concluida") else st["cell"])
                if show_tempos:
                    real_min = (op.get("tempo_real_seg") or 0) / 60.0
                    data.append([
                        Paragraph(op.get("nome") or "—", st["cell"]),
                        Paragraph(op.get("maquina_nome") or "—", st["cell"]),
                        Paragraph(f"{op.get('tempo_maquina') or 0:g} min", st["cell"]),
                        Paragraph(op.get("mao_obra_nome") or "—", st["cell"]),
                        Paragraph(f"{op.get('tempo_mao_obra') or 0:g} min", st["cell"]),
                        Paragraph(f"{real_min:.1f} min", st["cell"]),
                        concl,
                    ])
                else:
                    data.append([
                        Paragraph(op.get("nome") or "—", st["cell"]),
                        Paragraph(op.get("maquina_nome") or "—", st["cell"]),
                        Paragraph(op.get("mao_obra_nome") or "—", st["cell"]),
                        concl,
                    ])
            if len(data) == 1:
                data.append([Paragraph("Sem operações", st["cell"])] + [""] * (len(cols) - 1))
            tbl = _data_table(data, col_widths, align=[
                ("ALIGN", (-2, 0), (-1, -1), "RIGHT" if show_tempos else "CENTER"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ])
            elems.append(tbl)
            elems.append(Spacer(1, 14))
        if not of.get("itens"):
            elems.append(Paragraph("Sem artigos nesta ordem de fabrico.", st["cell"]))

    if section_on(fields, "notas") and of.get("notas"):
        elems.append(Spacer(1, 6))
        elems.append(Paragraph(f"<b>Notas:</b> {of.get('notas')}", st["small"]))
    _pdf_footer(elems, st, settings)
    doc.build(elems)
    return buf.getvalue()


def build_encomenda_pdf(enc: dict, settings: dict = None, fields: dict = None, show_branding: bool = True, cliente: dict = None, orcamento: dict = None) -> bytes:
    _set_currency(settings)
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    meta_pairs = []
    if section_on(fields, "dados_cliente"):
        meta_pairs += cliente_meta_pairs(enc, cliente, fields)
        meta_pairs += [("Data", enc.get("data")), ("Estado", ENC_ESTADO_PT.get(enc.get("estado"), enc.get("estado")))]
    if section_on(fields, "orcamento_origem"):
        meta_pairs += orcamento_origem_pairs(orcamento)
    _header(elems, st, "ENCOMENDA", enc.get("numero", ""), meta_pairs, settings, show_branding)

    artigos = enc.get("artigos") or []
    if section_on(fields, "artigos") and artigos:
        header = _th_row(st, ["Artigo", "Personalização", "Qtd", "Preço Unit.", "Subtotal"])
        data = [header]
        for a in artigos:
            qtd = a.get("quantidade") or 0
            pu = a.get("preco_unit") or 0
            pers = pers_valor_unit(a)
            sub = (pu + pers) * qtd
            data.append([
                Paragraph(a.get("artigo_nome") or "—", st["cell"]),
                Paragraph(", ".join(p.get("nome", "") for p in (a.get("personalizacoes") or [])) or "—", st["cell"]),
                Paragraph(f"{qtd:g}", st["cell"]),
                Paragraph(fmt_eur(pu + pers), st["cell"]),
                Paragraph(fmt_eur(sub), st["cellb"]),
            ])
        tbl = _data_table(data, [58 * mm, 42 * mm, 16 * mm, 26 * mm, 28 * mm], align=[
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (1, -1), "LEFT"),
        ])
        elems.append(tbl)
        elems.append(Spacer(1, 14))

    if section_on(fields, "ofs_associadas") and (enc.get("ordens_fabrico") or enc.get("ordens_resumo")):
        ofs = enc.get("ordens_fabrico") or enc.get("ordens_resumo") or []
        elems.append(Paragraph("Ordens de Fabrico", st["cellb"]))
        elems.append(Spacer(1, 4))
        ohead = _th_row(st, ["Nº OF", "Estado", "Progresso"])
        odata = [ohead]
        for o in ofs:
            odata.append([
                Paragraph(o.get("numero") or "—", st["cell"]),
                Paragraph(STATUS_PT.get(o.get("status"), o.get("status")) or "—", st["cell"]),
                Paragraph(f"{round(o.get('progresso') or 0)}%", st["cell"]),
            ])
        otbl = _data_table(odata, [40 * mm, 50 * mm, 30 * mm], align=[
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ], hAlign="LEFT")
        elems.append(otbl)
        elems.append(Spacer(1, 14))

    tot_rows = []
    if section_on(fields, "pagamento"):
        tot_rows += [
            ["Pago", fmt_eur(enc.get("valor_pago"))],
            ["Pendente", fmt_eur(enc.get("valor_pendente"))],
            [f"Pagamento: {PAY_PT.get(enc.get('status_pagamento'), enc.get('status_pagamento'))}", ""],
        ]
    if section_on(fields, "valor_total"):
        if (enc.get("desconto_total_valor") or 0) > 0:
            tot_rows.append(["Desconto", "- " + fmt_eur(enc.get("desconto_total_valor"))])
        if (enc.get("iva_taxa") or 0) > 0:
            tot_rows.append(["Subtotal", fmt_eur(enc.get("valor_total"))])
            tot_rows.append([f"IVA ({enc.get('iva_taxa'):g}%)", fmt_eur(enc.get("iva_valor"))])
            tot_rows.append(["TOTAL C/ IVA", fmt_eur(enc.get("total_com_iva"))])
        else:
            tot_rows.append(["VALOR TOTAL", fmt_eur(enc.get("valor_total"))])
    if tot_rows:
        has_total = section_on(fields, "valor_total")
        elems.append(_totais_table(tot_rows, has_total))

    if section_on(fields, "notas") and (enc.get("notas") or enc.get("descricao")):
        elems.append(Spacer(1, 10))
        elems.append(Paragraph(f"<b>Notas:</b> {enc.get('notas') or enc.get('descricao')}", st["small"]))
    _pdf_footer(elems, st, settings)
    doc.build(elems)
    return buf.getvalue()


def build_recibo_pdf(enc: dict, pag: dict, settings: dict = None, cliente: dict = None, metodo_label: str = "") -> bytes:
    _set_currency(settings)
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    nome_cli = (cliente or {}).get("nome") or enc.get("cliente") or "—"
    nif = (cliente or {}).get("nif") or ""
    meta_pairs = [
        ("Cliente", nome_cli),
        ("NIF", nif),
        ("Data", pag.get("data")),
        ("Encomenda", enc.get("numero")),
    ]
    _header(elems, st, "RECIBO", pag.get("recibo_numero", ""), meta_pairs, settings, True)

    valor = pag.get("valor") or 0
    data = [
        _th_row(st, ["Descrição", "Valor"]),
        [Paragraph(f"Pagamento referente à encomenda {enc.get('numero') or ''}", st["cell"]), Paragraph(fmt_eur(valor), st["cellb"])],
    ]
    elems.append(_data_table(data, [130 * mm, 40 * mm], align=[("ALIGN", (-1, 0), (-1, -1), "RIGHT")]))
    elems.append(Spacer(1, 12))

    elems.append(Paragraph(f"Recebemos de <b>{nome_cli}</b> a quantia de <b>{fmt_eur(valor)}</b>.", st["val"]))
    elems.append(Spacer(1, 4))
    elems.append(Paragraph(f"Método de pagamento: {metodo_label or pag.get('metodo') or '—'}", st["small"]))
    if pag.get("nota"):
        elems.append(Paragraph(f"Nota: {pag.get('nota')}", st["small"]))
    elems.append(Spacer(1, 14))

    total_enc = enc.get("valor_total") or 0
    total_pago = round2(sum((p.get("valor") or 0) for p in (enc.get("pagamentos") or [])))
    em_falta = round2((total_enc or 0) - total_pago)
    tot_rows = [
        ("Total da encomenda", fmt_eur(total_enc)),
        ("Total pago acumulado", fmt_eur(total_pago)),
        ("Em falta", fmt_eur(em_falta if em_falta > 0 else 0)),
    ]
    tot = Table([[Paragraph(k, st["cell"]), Paragraph(v, st["cellb"])] for k, v in tot_rows], colWidths=[130 * mm, 40 * mm])
    tot.setStyle(TableStyle([
        ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems.append(tot)

    _pdf_footer(elems, st, settings)
    doc.build(elems)
    return buf.getvalue()



async def load_pdf_config(template_id: Optional[str]):
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    fields = {}
    show_branding = True
    if template_id:
        t = await pdf_templates_repo.get(template_id)
        if t:
            fields = t.get("campos") or {}
            show_branding = t.get("mostrar_branding", True)
    return settings, fields, show_branding


async def fetch_cliente(cid: Optional[str]):
    if not cid:
        return None
    return await clientes_repo.get(cid)


async def fetch_orcamento(oid: Optional[str]):
    if not oid:
        return None
    return await orcamentos_repo.get(oid)
