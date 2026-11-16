"""Guias de remessa / transporte da encomenda (entregas parciais).

Sem programa certificado, a guia é um documento interno (nota de entrega, sem código AT).
Com o Moloni ativo, emite-se lá a guia de transporte (ou de remessa) e guarda-se o número e o código AT.
"""
from __future__ import annotations

from io import BytesIO
from typing import List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import clientes_repo, empresa_repo, encomendas_repo, guias_repo
from app.services import audit
from app.services.numeracao import next_codigo


def _morada_empresa(s: dict) -> dict:
    return {"morada": s.get("morada") or "", "codigo_postal": s.get("codigo_postal") or "", "cidade": s.get("cidade") or "",
            "pais": s.get("pais") or "Portugal"}


def _morada_cliente(c: dict) -> dict:
    return {"morada": c.get("morada") or "", "codigo_postal": c.get("codigo_postal") or "", "cidade": c.get("cidade") or "",
            "pais": c.get("pais") or "Portugal"}


async def _ja_em_guias(eid: str) -> dict:
    out: dict = {}
    for g in await guias_repo.find({"encomenda_id": eid, "estado": {"$ne": "anulada"}}, limit=500):
        for l in g.get("linhas") or []:
            k = l.get("encomenda_artigo_id")
            out[k] = round2(out.get(k, 0) + float(l.get("quantidade") or 0))
    return out


async def previsao(eid: str) -> dict:
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    ja = await _ja_em_guias(eid)
    linhas = []
    for a in enc.get("artigos") or []:
        q = float(a.get("quantidade") or 0)
        feito = ja.get(a.get("id"), 0)
        linhas.append({"encomenda_artigo_id": a.get("id"), "artigo_id": a.get("artigo_id"),
                       "descricao": a.get("artigo_nome") or a.get("descricao") or "", "codigo": a.get("artigo_codigo") or "",
                       "encomendado": round2(q), "ja_enviado": round2(feito), "disponivel": round2(max(0.0, q - feito))})
    s = await empresa_repo.find_one({"id": "empresa"}) or {}
    c = (await clientes_repo.get(enc["cliente_id"]) if enc.get("cliente_id") else None) or {}
    return {"linhas": linhas, "carga": _morada_empresa(s), "descarga": _morada_cliente(c),
            "guias": [{k: g.get(k) for k in ("id", "numero", "data", "estado", "tipo")} for g in
                      await guias_repo.find({"encomenda_id": eid}, sort=("created_at", -1), limit=50)]}


async def criar(eid: str, dados: dict, user: dict) -> dict:
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if enc.get("estado") == "cancelada":
        raise HTTPException(400, "Encomenda cancelada")
    from app.services import workflow
    workflow.assert_nao_bloqueada(enc, "emitir guias")
    pv = await previsao(eid)
    disp = {l["encomenda_artigo_id"]: l for l in pv["linhas"]}
    linhas = []
    for l in dados.get("linhas") or []:
        q = round2(float(l.get("quantidade") or 0))
        if q <= 0:
            continue
        base = disp.get(l.get("encomenda_artigo_id"))
        if not base:
            raise HTTPException(400, "Linha da encomenda inválida")
        if q > base["disponivel"] + 1e-9:
            raise HTTPException(400, f"«{base['descricao']}»: só faltam enviar {base['disponivel']:g}")
        linhas.append({"encomenda_artigo_id": base["encomenda_artigo_id"], "artigo_id": base["artigo_id"],
                       "descricao": base["descricao"], "codigo": base["codigo"], "quantidade": q})
    if not linhas:
        raise HTTPException(400, "Indique as quantidades a enviar")
    tipo = dados.get("tipo") if dados.get("tipo") in ("remessa", "transporte") else "transporte"
    g = {
        "id": new_id(), "numero": "", "tipo": tipo, "estado": "rascunho",
        "encomenda_id": eid, "encomenda_numero": enc.get("numero"), "cliente": enc.get("cliente") or "",
        "cliente_id": enc.get("cliente_id"), "data": (dados.get("data") or now_iso())[:10],
        "hora_inicio": (dados.get("hora_inicio") or "")[:5],
        "carga": {**pv["carga"], **(dados.get("carga") or {})}, "descarga": {**pv["descarga"], **(dados.get("descarga") or {})},
        "matricula": (dados.get("matricula") or "").strip().upper(), "transportadora": (dados.get("transportadora") or "").strip(),
        "notas": (dados.get("notas") or "").strip(), "linhas": linhas, "marcar_entregue": bool(dados.get("marcar_entregue", True)),
        "faturacao": {}, "created_at": now_iso(), "created_by": user.get("id"),
    }
    await guias_repo.insert(g)
    await audit.registar("encomenda", eid, "editado", user, f"Guia em rascunho para {enc.get('numero')}", enc.get("numero"))
    if dados.get("emitir"):
        return await emitir(g["id"], user)
    return g


async def emitir(gid: str, user: dict) -> dict:
    g = await guias_repo.get(gid)
    if not g:
        raise HTTPException(404, "Guia não encontrada")
    if g.get("estado") != "rascunho":
        raise HTTPException(409, "Esta guia já foi emitida")
    from app.services import faturacao as fat
    cfg = await fat.config_ativa()
    patch: dict = {"estado": "emitida", "emitida_at": now_iso(), "emitida_por": user.get("name") or ""}
    if cfg and cfg.get("fornecedor") == "moloni":
        from app.services.faturacao import moloni
        cliente = (await clientes_repo.get(g["cliente_id"]) if g.get("cliente_id") else None) or {"nome": g.get("cliente")}
        res = await moloni.emitir_guia(cfg, g, cliente, fat._ctx(cfg, None, None))
        patch["numero"] = res.numero or res.externo_id
        patch["faturacao"] = {**res.to_dict(), "fornecedor": "moloni", "fornecedor_nome": "Moloni", "estado": "emitido",
                              "emitido_em": now_iso()}
    else:
        patch["numero"] = await next_codigo("guia")
        patch["faturacao"] = {"interno": True,
                              "aviso": "Documento interno sem código AT" + (" — o programa de faturação ligado não emite guias por aqui."
                                                                            if cfg else " — ligue o Moloni para emitir guias de transporte.")}
    await guias_repo.update(gid, patch)
    g.update(patch)
    await audit.registar("encomenda", g["encomenda_id"], "editado", user,
                         f"Guia {g['numero']} emitida ({sum(l['quantidade'] for l in g['linhas']):g} un)", g.get("encomenda_numero"))
    if g.get("marcar_entregue"):
        pv = await previsao(g["encomenda_id"])
        if all(l["disponivel"] <= 1e-9 for l in pv["linhas"]):
            enc = await encomendas_repo.get(g["encomenda_id"])
            if enc and not enc.get("entregue"):
                await encomendas_repo.update(enc["id"], {"entregue": True, "data_entrega": g.get("data")})
                from app.services import stock as stock_svc
                await stock_svc.saida_encomenda(enc, user)
    return g


async def anular(gid: str, user: dict) -> dict:
    g = await guias_repo.get(gid)
    if not g:
        raise HTTPException(404, "Guia não encontrada")
    if (g.get("faturacao") or {}).get("externo_id"):
        raise HTTPException(409, "Guia emitida no Moloni — anule-a no Moloni e depois aqui elimine o registo")
    await guias_repo.update(gid, {"estado": "anulada"})
    await audit.registar("encomenda", g["encomenda_id"], "editado", user, f"Guia {g.get('numero') or '(rascunho)'} anulada",
                         g.get("encomenda_numero"))
    return {**g, "estado": "anulada"}


def pdf(g: dict, empresa: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16, leading=20)
    n = ParagraphStyle("n", fontName="Helvetica", fontSize=9, leading=12)
    b = ParagraphStyle("b", parent=n, fontName="Helvetica-Bold")
    pequeno = ParagraphStyle("p", parent=n, fontSize=8, textColor=colors.HexColor("#6B7280"))

    def esc(t):
        return str(t or "").replace("&", "&amp;").replace("<", "&lt;")

    def morada(m):
        return "<br/>".join(esc(x) for x in [m.get("morada"), f"{m.get('codigo_postal') or ''} {m.get('cidade') or ''}".strip(), m.get("pais")] if x)

    titulo = "Guia de transporte" if g.get("tipo") == "transporte" else "Guia de remessa"
    f = g.get("faturacao") or {}
    els = [Paragraph(f"{titulo} {esc(g.get('numero') or 'RASCUNHO')}", h1),
           Paragraph(f"{esc(empresa.get('nome'))} · NIF {esc(empresa.get('nif'))}", n), Spacer(1, 4 * mm)]
    info = [[Paragraph("<b>Cliente</b><br/>" + esc(g.get("cliente")), n), Paragraph("<b>Encomenda</b><br/>" + esc(g.get("encomenda_numero")), n),
             Paragraph(f"<b>Data / hora de início</b><br/>{esc(g.get('data'))} {esc(g.get('hora_inicio'))}", n)],
            [Paragraph("<b>Local de carga</b><br/>" + morada(g.get("carga") or {}), n), Paragraph("<b>Local de descarga</b><br/>" + morada(g.get("descarga") or {}), n),
             Paragraph(f"<b>Viatura / transportadora</b><br/>{esc(g.get('matricula'))} {esc(g.get('transportadora'))}", n)]]
    t = Table(info, colWidths=[60 * mm] * 3)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                           ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")), ("TOPPADDING", (0, 0), (-1, -1), 5)]))
    els += [t, Spacer(1, 5 * mm)]
    dados = [[Paragraph("<b>Código</b>", n), Paragraph("<b>Descrição</b>", n), Paragraph("<b>Quantidade</b>", n)]]
    for l in g.get("linhas") or []:
        dados.append([Paragraph(esc(l.get("codigo")), n), Paragraph(esc(l.get("descricao")), n), Paragraph(f"{float(l.get('quantidade') or 0):g}", b)])
    tl = Table(dados, colWidths=[30 * mm, 120 * mm, 30 * mm], repeatRows=1)
    tl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
                            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")), ("ALIGN", (2, 0), (2, -1), "RIGHT")]))
    els += [tl, Spacer(1, 6 * mm)]
    if g.get("notas"):
        els += [Paragraph(esc(g["notas"]), n), Spacer(1, 4 * mm)]
    if f.get("atcud") or f.get("extra", {}).get("at_code"):
        els.append(Paragraph(f"Código AT: {esc(f.get('extra', {}).get('at_code') or '')} · ATCUD: {esc(f.get('atcud'))}", n))
    else:
        els.append(Paragraph("Documento interno, sem código de comunicação à AT.", pequeno))
    els += [Spacer(1, 14 * mm), Table([[Paragraph("Entregue por: ____________________", n), Paragraph("Recebido por: ____________________", n)]],
                                      colWidths=[90 * mm, 90 * mm])]
    doc.build(els)
    return buf.getvalue()
