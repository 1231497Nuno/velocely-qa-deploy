"""PDF de orçamento em estilo «proposta comercial» (personalizável por modelo de PDF).

Estrutura: cabeçalho com marca, título grande, caixas Cliente / Detalhes, resumo, artigos com imagem,
totais, «O que está incluído», «Prazos e entrega», «Condições», notas, agradecimento e aceitação.
Os textos e a cor vêm do modelo (`campos._modelo`); sem modelo usam-se textos por defeito.
"""
from io import BytesIO
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, KeepTogether, HRFlowable,
)

from app.services import pdf as base
from app.services.costing import pers_valor_unit, pers_nomes, desconto_linha_item

DEFAULT_TEXTOS = {
    "introducao": "Obrigado pelo seu pedido. Apresentamos a nossa proposta para {descricao_ou_trabalho}, "
                  "preparada à medida para {cliente}.",
    "incluido": "Preparação da arte e maquete digital para aprovação, sem custos adicionais\n"
                "Materiais e personalização indicados em cada artigo\n"
                "Controlo de qualidade antes da entrega",
    "prazos": "Maquete digital enviada para aprovação antes da produção\n"
              "Prazo de produção a combinar após aprovação da maquete e pagamento\n"
              "Recolha nas nossas instalações sem custos ou envio por transportadora",
    "condicoes": "Proposta válida até {validade}\n"
                 "O orçamento tem de ser aceite antes de avançar\n"
                 "A produção inicia após aprovação da maquete e pagamento",
    "agradecimento": "Obrigado pela preferência!",
}

_FAIXA = colors.HexColor("#0A0A0A")


def _cor(hexa: str, fallback):
    try:
        h = (hexa or "").strip()
        if h.startswith("#") and len(h) in (4, 7):
            return colors.HexColor(h)
    except Exception:  # noqa: BLE001
        pass
    return fallback


def _suave(c, f: float = 0.88):
    """Mistura a cor com branco (fundo suave das caixas)."""
    return colors.Color(c.red + (1 - c.red) * f, c.green + (1 - c.green) * f, c.blue + (1 - c.blue) * f)


def _linhas(txt: str) -> List[str]:
    return [x.strip(" •-\t") for x in (txt or "").split("\n") if x.strip(" •-\t")]


def _imagem_storage(path: str, w_mm: float, h_mm: float) -> Optional[Image]:
    if not path:
        return None
    if not any(path.lower().endswith(e) for e in (".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return None
    try:
        from app.services import storage
        data, _ct = storage.get_object(path)
        return base._logo_from_bytes(data, w_mm, h_mm)
    except Exception:  # noqa: BLE001 — imagem em falta nunca impede o PDF
        return None


def _estilos(acc):
    st = base._pdf_styles()
    st["hero"] = ParagraphStyle("hero", fontName="Helvetica-Bold", fontSize=24, leading=28, textColor=base.DARK)
    st["kicker"] = ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=acc)
    st["sec"] = ParagraphStyle("sec", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=base.DARK, spaceBefore=6, spaceAfter=4)
    st["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=14.5, textColor=colors.HexColor("#1F2937"))
    st["bullet"] = ParagraphStyle("bullet", parent=st["body"], leftIndent=10, bulletIndent=0, spaceAfter=2)
    st["item"] = ParagraphStyle("item", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=base.DARK)
    st["itemsub"] = ParagraphStyle("itemsub", fontName="Helvetica", fontSize=8.5, leading=11, textColor=base.GREY)
    st["num"] = ParagraphStyle("num", fontName="Helvetica", fontSize=9.5, leading=12, textColor=base.DARK, alignment=2)
    st["numb"] = ParagraphStyle("numb", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=base.DARK, alignment=2)
    st["thx"] = ParagraphStyle("thx", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=acc)
    return st


def _seccao(st, titulo: str, acc):
    t = Table([[Paragraph(base._esc(titulo), st["sec"])]], colWidths=[170 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.8, acc), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 8)]))
    return t


def _lista(st, itens: List[str], acc):
    out = []
    for x in itens:
        out.append(Paragraph(base._esc(x), st["bullet"], bulletText="•"))
    return out


def build_orcamento_proposta_pdf(orc: dict, settings: dict = None, fields: dict = None, show_branding: bool = True,
                                 cliente: dict = None) -> bytes:
    settings = settings or {}
    fields = fields or {}
    modelo = fields.get("_modelo") or {}
    textos = {**DEFAULT_TEXTOS, **{k: v for k, v in (modelo.get("textos") or {}).items() if isinstance(v, str) and v.strip()}}
    acc = _cor(modelo.get("cor") or settings.get("cor_pdf") or "", base.ACCENT)
    on = lambda k: base.section_on(fields, k)  # noqa: E731

    base._set_currency(settings)
    st = _estilos(acc)
    c = cliente or {}
    nome_cliente = c.get("nome") or orc.get("cliente") or ""
    empresa = settings.get("nome") or ""
    validade = base.fmt_data(orc.get("validade")) or "—"
    subs = {
        "cliente": nome_cliente, "empresa": empresa, "numero": orc.get("numero") or "", "data": base.fmt_data(orc.get("data")),
        "validade": validade, "total": base.fmt_eur(orc.get("total")), "descricao": orc.get("descricao") or "",
        "descricao_ou_trabalho": (orc.get("descricao") or "o trabalho pedido").strip(),
    }

    def fmt(t: str) -> str:
        try:
            return t.format(**subs)
        except (KeyError, IndexError, ValueError):
            return t

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=14 * mm, bottomMargin=22 * mm,
                            title=f"Orçamento {orc.get('numero') or ''}", author=empresa)
    E = []

    # ---- Cabeçalho: marca à esquerda, nº / data à direita
    esq = []
    logo = base._logo_flowable(settings.get("logo_base64") or "", 60, 18) if show_branding else None
    if logo:
        esq.append(logo)
    elif show_branding and empresa:
        esq.append(Paragraph(f"<b>{base._esc(empresa)}</b>", ParagraphStyle("emp", fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=base.DARK)))
    if show_branding:
        linha = " · ".join(base._esc(x) for x in (" ".join(y for y in (settings.get("morada"), settings.get("codigo_postal"), settings.get("cidade")) if y),
                                                   settings.get("website")) if x)
        if linha:
            esq.append(Spacer(1, 3))
            esq.append(Paragraph(linha, st["small"]))
    dir_ = [Paragraph("ORÇAMENTO", ParagraphStyle("k2", parent=st["kicker"], alignment=2)),
            Paragraph(f"<b>{base._esc(orc.get('numero') or '—')}</b>", ParagraphStyle("n2", fontName="Helvetica-Bold", fontSize=13, leading=16, alignment=2, textColor=base.DARK)),
            Paragraph(f"{base.fmt_data(orc.get('data'))}", ParagraphStyle("d2", parent=st["small"], alignment=2))]
    head = Table([[esq or [Spacer(1, 1)], dir_]], colWidths=[115 * mm, 55 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    E += [head, Spacer(1, 6), HRFlowable(width="100%", thickness=3, color=acc, spaceAfter=14)]

    # ---- Título
    E.append(Paragraph("PROPOSTA PARA", st["kicker"]))
    E.append(Spacer(1, 2))
    E.append(Paragraph(base._esc(orc.get("descricao") or nome_cliente or "Orçamento"), st["hero"]))
    E.append(Spacer(1, 10))

    # ---- Cliente | Detalhes
    if on("dados_cliente") or on("datas_estado"):
        pares = []
        if on("dados_cliente"):
            pares += base.cliente_meta_pairs(orc, cliente, fields) + [("Referência cliente", orc.get("numero_encomenda"))]
        if on("datas_estado"):
            pares += [("Data", orc.get("data")), ("Válido até", orc.get("validade"))]
        bl = base._meta_blocos(st, pares)
        if isinstance(bl, Table):
            bl.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), _suave(acc, 0.92)), ("LINEBEFORE", (0, 0), (0, 0), 2, acc)]))
        E += [bl, Spacer(1, 12)]

    # ---- Resumo
    intro = fmt(textos.get("introducao") or "")
    if intro and on("introducao"):
        E.append(Paragraph(base._esc(intro).replace("\n", "<br/>"), st["body"]))
        E.append(Spacer(1, 8))

    # ---- Artigos
    if on("linhas_artigos"):
        E.append(_seccao(st, "A nossa proposta", acc))
        E.append(Spacer(1, 4))
        imgs = {}
        if modelo.get("imagens", True) is not False:
            for i, l in enumerate(orc.get("linhas") or []):
                im = _imagem_storage(l.get("arte_path") or "", 20, 20) or _imagem_storage(l.get("imagem") or "", 20, 20)
                if im:
                    imgs[i] = im
        mostra_img = bool(imgs)
        cab = [Paragraph(x, st["th"]) for x in ("", "Artigo", "Qtd", "Preço unit.", "Total")] if mostra_img else \
              [Paragraph(x, st["th"]) for x in ("Artigo", "Qtd", "Preço unit.", "Total")]
        data = [cab]
        for i, l in enumerate(orc.get("linhas") or []):
            qtd = float(l.get("quantidade") or 0)
            unit = float(l.get("preco_unit") or 0) + float(pers_valor_unit(l) or 0)
            tot = unit * qtd - float(desconto_linha_item(l) or 0)
            sub = []
            pn = pers_nomes(l)
            if pn and on("personalizacoes"):
                sub.append(f"Personalização: {base._esc(pn)}")
            if (l.get("observacoes") or "").strip():
                sub.append(base._esc(l["observacoes"]))
            if float(desconto_linha_item(l) or 0) > 0:
                sub.append(f"Desconto: − {base.fmt_eur(desconto_linha_item(l))}")
            cel = [Paragraph(base._esc(l.get("artigo_nome") or "—"), st["item"])]
            if sub:
                cel.append(Paragraph("<br/>".join(sub), st["itemsub"]))
            row = [cel, Paragraph(f"{qtd:g}", st["num"]), Paragraph(base.fmt_eur(unit), st["num"]), Paragraph(base.fmt_eur(tot), st["numb"])]
            if mostra_img:
                row = [imgs.get(i) or ""] + row
            data.append(row)
        widths = [24 * mm, 76 * mm, 16 * mm, 27 * mm, 27 * mm] if mostra_img else [100 * mm, 16 * mm, 27 * mm, 27 * mm]
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _FAIXA), ("LINEBELOW", (0, 0), (-1, 0), 2, acc),
            ("VALIGN", (0, 1), (-1, -1), "MIDDLE"), ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.4, base.LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (-3, 0), (-1, 0), "RIGHT"),
        ]))
        E += [t, Spacer(1, 8)]

    # ---- Totais
    if on("totais"):
        rows = []
        if (orc.get("desconto_total_valor") or 0) > 0:
            rows.append(["Desconto", "− " + base.fmt_eur(orc.get("desconto_total_valor"))])
        if (orc.get("total_materiais") or 0) > 0 and on("materiais"):
            rows.append(["Materiais", base.fmt_eur(orc.get("total_materiais"))])
        if (orc.get("portes") or 0) > 0:
            rows.append(["Portes de envio", base.fmt_eur(orc.get("portes"))])
        iva_taxa = 0.0 if settings.get("iva_isento") else float(settings.get("iva_taxa") or 0)
        nota = ""
        if iva_taxa > 0:
            net = float(orc.get("total") or 0)
            iva = round(net * iva_taxa / 100.0, 2)
            rows += [["Total s/ IVA", base.fmt_eur(net)], [f"IVA ({iva_taxa:g}%)", base.fmt_eur(iva)], ["TOTAL", base.fmt_eur(net + iva)]]
        else:
            rows.append(["TOTAL", base.fmt_eur(orc.get("total"))])
            if settings.get("iva_isento"):
                nota = settings.get("iva_motivo_isencao") or "Isento de IVA"
        tt = base._totais_table(rows, True, nota)
        tt.setStyle(TableStyle([("LINEABOVE", (0, len(rows) - 1), (-1, len(rows) - 1), 2, acc),
                                ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), _suave(acc, 0.9))]))
        E += [tt, Spacer(1, 6)]

    # ---- Blocos de texto
    for chave, titulo in (("incluido", "O que está incluído"), ("prazos", "Maquete, prazos e entrega"), ("condicoes", "Condições")):
        itens = [fmt(x) for x in _linhas(textos.get(chave) or "")]
        if itens and on(chave):
            E.append(KeepTogether([_seccao(st, titulo, acc), Spacer(1, 4)] + _lista(st, itens, acc)))
            E.append(Spacer(1, 4))

    if on("notas") and (orc.get("notas") or "").strip():
        E.append(KeepTogether([_seccao(st, "Notas", acc), Spacer(1, 4),
                               Paragraph(base._esc(orc["notas"]).replace("\n", "<br/>"), st["body"])]))
        E.append(Spacer(1, 4))

    cond_pag = settings.get("condicoes_pagamento")
    if cond_pag and on("condicoes"):
        E.append(Paragraph(f"<b>Condições de pagamento:</b> {base._esc(cond_pag)}", st["body"]))

    # ---- Fecho
    fecho = [Spacer(1, 14)]
    agr = fmt(textos.get("agradecimento") or "")
    if agr:
        fecho.append(Paragraph(base._esc(agr), st["thx"]))
    if empresa:
        fecho.append(Paragraph(f"<b>{base._esc(empresa)}</b>" + (f" · {base._esc(settings.get('website'))}" if settings.get("website") else ""), st["small"]))
    resp = orc.get("resposta_cliente") or {}
    if resp.get("aceite") and on("aceitacao"):
        # Aceite online: nome, data e assinatura do cliente
        fecho.append(Spacer(1, 16))
        ass = ""
        try:
            import base64
            b64 = (resp.get("assinatura") or "").split(",", 1)[1]
            ass = base._logo_from_bytes(base64.b64decode(b64), 60, 18) or ""
        except Exception:  # noqa: BLE001
            ass = ""
        info = Paragraph(f"<b>Proposta aceite online</b><br/>{base._esc(resp.get('nome'))} · {base.fmt_data(resp.get('at'))}"
                         f" {base._esc((resp.get('at') or '')[11:16])}", st["cell"])
        ac = Table([[info, ass]], colWidths=[100 * mm, 70 * mm])
        ac.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, acc), ("BACKGROUND", (0, 0), (-1, -1), _suave(acc, 0.93)),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                                ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
        fecho.append(ac)
    elif modelo.get("aceitacao", True) is not False and on("aceitacao"):
        fecho.append(Spacer(1, 16))
        lin = lambda r: Paragraph(f"<font color='#6B7280'>{r}</font>", st["small"])  # noqa: E731
        ac = Table([[Paragraph("<b>Aceitação da proposta</b>", st["cell"]), "", ""],
                    [lin("Nome"), lin("Data"), lin("Assinatura")],
                    ["", "", ""]], colWidths=[62 * mm, 40 * mm, 68 * mm], rowHeights=[None, None, 14 * mm])
        ac.setStyle(TableStyle([("SPAN", (0, 0), (-1, 0)), ("BOX", (0, 0), (-1, -1), 0.6, base.LINE),
                                ("LINEBELOW", (0, 2), (-1, 2), 0.6, base.GREY), ("LINEBEFORE", (1, 1), (2, 2), 0.4, base.LINE),
                                ("BACKGROUND", (0, 0), (-1, 0), base.LIGHT), ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
        fecho.append(ac)
    E.append(KeepTogether(fecho))

    rodape = settings.get("rodape")
    if rodape:
        E += [Spacer(1, 12), Paragraph(base._esc(rodape), st["small"])]

    def pagina(canvas, d):
        canvas.saveState()
        w, _h = A4
        canvas.setFillColor(acc)
        canvas.rect(0, A4[1] - 4, w, 4, fill=1, stroke=0)
        base._page_footer(canvas, d)
        canvas.restoreState()

    doc.build(E, onFirstPage=pagina, onLaterPages=pagina)
    return buf.getvalue()
