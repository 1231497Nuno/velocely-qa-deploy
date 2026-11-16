"""Stock: movimentos, sugestões de compra e inventário."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.security import require_perm
from app.repositories import artigos_repo, inventarios_repo, localizacoes_repo, movimentos_stock_repo
from app.services import stock as stock_svc

router = APIRouter()


@router.get("/stock")
async def listar_stock(q: str = Query(""), filtro: str = Query("todos"), localizacao: str = Query(""),
                       _u: dict = Depends(require_perm("artigos", "view"))):
    """Artigos que gerem stock, com estado (abaixo do nível, negativo) e stock por localização."""
    out = []
    ql = q.strip().lower()
    reservado = await stock_svc.reservas()
    padrao = await stock_svc.local_padrao()
    locs = {l["id"]: l.get("nome") or "" for l in await stock_svc.listar_localizacoes()}
    for a in await artigos_repo.find({}, sort=("nome", 1), limit=20000):
        if not stock_svc.gere_stock(a):
            continue
        if ql and ql not in f"{a.get('codigo', '')} {a.get('nome', '')} {a.get('fornecedor_nome', '')} {a.get('codigo_produto', '')} {a.get('cod_fornecedor', '')}".lower():
            continue
        sl = stock_svc.stock_por_local(a, padrao["id"])
        if localizacao and abs(sl.get(localizacao, 0)) < 1e-9:
            continue
        stock = float(a.get("qtd_stock") or 0)
        nivel = float(a.get("nivel_reabastecimento") or 0)
        estado = "negativo" if stock < 0 else ("abaixo" if nivel and stock < nivel else "ok")
        if filtro != "todos" and estado != filtro and not (filtro == "abaixo" and estado == "negativo"):
            continue
        custo = float(a.get("custo_medio") or a.get("custo_artigo") or 0)
        out.append({"id": a["id"], "codigo": a.get("codigo") or "", "nome": a.get("nome") or "", "unidade": a.get("unidade") or "un",
                    "codigo_produto": a.get("codigo_produto") or "", "imagem": a.get("imagem") or "",
                    "tipo_artigo": a.get("tipo_artigo"), "fornecedor_nome": a.get("fornecedor_nome") or "",
                    "unidade_compra": a.get("unidade_compra") or "", "fator_compra": float(a.get("fator_compra") or 1),
                    "qtd_stock": round(stock, 2), "nivel_reabastecimento": nivel, "custo_medio": round(custo, 4),
                    "valor": round(max(stock, 0) * custo, 2), "estado": estado, "gere_stock": True,
                    "localizacao": a.get("localizacao") or "", "reservado": reservado.get(a["id"], 0.0),
                    "localizacao_id": a.get("localizacao_id") or padrao["id"],
                    "por_local": [{"id": k, "nome": locs.get(k, "?"), "quantidade": v} for k, v in sorted(sl.items(), key=lambda x: -x[1])],
                    "qtd_local": sl.get(localizacao) if localizacao else None,
                    "disponivel": round(stock - reservado.get(a["id"], 0.0), 2)})
    return {"items": out, "valor_total": round(sum(i["valor"] for i in out), 2)}


@router.get("/stock/movimentos")
async def movimentos(artigo_id: Optional[str] = None, limit: int = Query(200, le=2000), _u: dict = Depends(require_perm("artigos", "view"))):
    filtro = {"artigo_id": artigo_id} if artigo_id else {}
    return await movimentos_stock_repo.find(filtro, sort=("created_at", -1), limit=limit)


@router.post("/stock/ajuste")
async def ajuste(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    a = await artigos_repo.get(dados.get("artigo_id") or "")
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if not stock_svc.gere_stock(a):
        raise HTTPException(400, "Este artigo não tem gestão de stock — ative-a primeiro")
    loc = dados.get("localizacao_id") or None
    if dados.get("nova_quantidade") is not None and loc:
        atual = stock_svc.stock_por_local(a, (await stock_svc.local_padrao())["id"]).get(loc, 0.0)
        delta = float(dados["nova_quantidade"]) - atual
    elif dados.get("nova_quantidade") is not None:
        delta = float(dados["nova_quantidade"]) - float(a.get("qtd_stock") or 0)
    else:
        delta = float(dados.get("delta") or 0)
    m = await stock_svc.movimentar(a["id"], delta, "ajuste", user=user, nota=(dados.get("motivo") or "").strip(), localizacao_id=loc)
    return m or {"ok": True}


@router.get("/stock/sugestoes")
async def sugestoes(_u: dict = Depends(require_perm("ordens_compra", "view"))):
    return await stock_svc.sugestoes()


@router.post("/stock/sugestoes/criar-oc")
async def criar_oc(dados: dict, user: dict = Depends(require_perm("ordens_compra", "create"))):
    criadas = await stock_svc.criar_oc_de_sugestoes(dados.get("itens") or [], user)
    if not criadas:
        raise HTTPException(400, "Escolha pelo menos um artigo com quantidade")
    return {"criadas": criadas}


@router.get("/stock/compras-automaticas")
async def get_compras_auto(_u: dict = Depends(require_perm("ordens_compra", "view"))):
    return await stock_svc.get_config_compras()


@router.put("/stock/compras-automaticas")
async def set_compras_auto(dados: dict, user: dict = Depends(require_perm("ordens_compra", "edit"))):
    from app.repositories import empresa_repo
    cfg = {**await stock_svc.get_config_compras(), "ativo": bool(dados.get("ativo"))}
    await empresa_repo.update_where({"id": "empresa"}, {"compras_auto": cfg}, upsert=True)
    return cfg


@router.post("/stock/compras-automaticas/correr")
async def correr_compras_auto(user: dict = Depends(require_perm("ordens_compra", "create"))):
    return {"criadas": await stock_svc.compras_automaticas(forcar=True)}


@router.get("/inventarios")
async def listar_inventarios(_u: dict = Depends(require_perm("artigos", "view"))):
    out = await inventarios_repo.find({}, sort=("data", -1), limit=200)
    for i in out:
        ls = i.pop("linhas", []) or []
        i["n_artigos"] = len(ls)
        i["n_contados"] = sum(1 for l in ls if l.get("qtd_contada") is not None)
    return out


@router.post("/inventarios")
async def criar_inventario(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.novo_inventario(dados.get("data") or "", user)


@router.get("/inventarios/{iid}")
async def get_inventario(iid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    return inv


@router.put("/inventarios/{iid}/contagens")
async def contagens(iid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.contar(iid, dados.get("contagens") or [])


@router.post("/inventarios/{iid}/fechar")
async def fechar(iid: str, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.fechar_inventario(iid, user)


@router.delete("/inventarios/{iid}")
async def eliminar(iid: str, _u: dict = Depends(require_perm("artigos", "edit"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    if inv.get("estado") != "aberto":
        raise HTTPException(409, "Só se pode eliminar um inventário aberto")
    await inventarios_repo.delete({"id": iid})
    return {"ok": True}


@router.get("/inventarios/{iid}/at.csv")
async def exportar_at(iid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    return Response(stock_svc.csv_at(inv), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="inventario-{inv["data"]}.csv"'})


@router.put("/stock/artigos/{aid}/config")
async def configurar(aid: str, dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    """Gestão de stock do artigo: ativa, unidade de compra/fator e nível de reabastecimento."""
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if a.get("tipo_artigo") == "servico":
        raise HTTPException(400, "Serviços não têm stock")
    # Só altera o que vem no pedido
    patch: dict = {}
    if "gere_stock" in dados:
        patch["gere_stock"] = bool(dados.get("gere_stock"))
    if "unidade_compra" in dados:
        patch["unidade_compra"] = (dados.get("unidade_compra") or "").strip()
    if "fator_compra" in dados:
        fator = float(dados.get("fator_compra") or 1)
        if fator <= 0:
            raise HTTPException(400, "O fator de conversão tem de ser maior que zero")
        patch["fator_compra"] = fator
    if "nivel_reabastecimento" in dados:
        patch["nivel_reabastecimento"] = max(0.0, float(dados.get("nivel_reabastecimento") or 0))
    if "localizacao" in dados:
        patch["localizacao"] = (dados.get("localizacao") or "").strip()[:60]
    if "localizacao_id" in dados:
        patch["localizacao_id"] = dados.get("localizacao_id") or None
    await artigos_repo.update(aid, patch)
    return {**a, **patch}



# ---------------- Localizações ----------------
@router.get("/stock/localizacoes")
async def localizacoes(_u: dict = Depends(require_perm("artigos", "view"))):
    lista = await stock_svc.listar_localizacoes()
    padrao = next((l for l in lista if l.get("padrao")), lista[0] if lista else None)
    totais: dict = {}
    n: dict = {}
    for a in await artigos_repo.find({"gere_stock": True}, limit=50000):
        for k, v in stock_svc.stock_por_local(a, padrao["id"]).items():
            totais[k] = totais.get(k, 0) + float(a.get("custo_medio") or a.get("custo_artigo") or 0) * max(v, 0)
            n[k] = n.get(k, 0) + 1
    return [{**l, "n_artigos": n.get(l["id"], 0), "valor": round(totais.get(l["id"], 0), 2)} for l in lista]


@router.post("/stock/localizacoes")
async def criar_localizacao(dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.guardar_localizacao(dados)


@router.put("/stock/localizacoes/{lid}")
async def editar_localizacao(lid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.guardar_localizacao(dados, lid)


@router.delete("/stock/localizacoes/{lid}")
async def apagar_localizacao(lid: str, _u: dict = Depends(require_perm("artigos", "edit"))):
    await stock_svc.apagar_localizacao(lid)
    return {"ok": True}


@router.get("/stock/artigos/{aid}")
async def stock_do_artigo(aid: str, _u: dict = Depends(require_perm("artigos", "view"))):
    return await stock_svc.stock_artigo(aid)


@router.post("/stock/transferir")
async def transferir(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    return await stock_svc.transferir(dados.get("artigo_id") or "", dados.get("de") or "", dados.get("para") or "",
                                      dados.get("quantidade"), user, (dados.get("nota") or "").strip())



# ---------------- App móvel ----------------
@router.get("/movel/picking")
async def movel_picking(_u: dict = Depends(require_perm("ordens_fabrico", "view"))):
    """Material das OF por separar (picking), com as localizações onde há stock."""
    from app.core.security import exigir_movel
    from app.services import producao
    await exigir_movel(_u, "picking")
    return await producao.picking_lista()


@router.post("/movel/picking/{ofid}")
async def movel_picking_registar(ofid: str, dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    from app.core.security import exigir_movel
    from app.services import producao
    await exigir_movel(user, "picking")
    return await producao.picking_registar(ofid, dados.get("separados") or [], user)
@router.get("/movel/ocs-abertas")
async def ocs_abertas(_u: dict = Depends(require_perm("ordens_compra", "view"))):
    """Ordens de compra por receber (para a app móvel)."""
    from app.repositories import ordens_compra_repo
    out = []
    for o in await ordens_compra_repo.find({"estado": "criada"}, sort=("data", -1), limit=300):
        linhas = [{"id": l.get("id"), "nome": l.get("artigo_nome") or l.get("nome") or "", "artigo_id": l.get("artigo_id"),
                   "quantidade": float(l.get("quantidade") or 0), "recebida": float(l.get("qtd_recebida") or 0),
                   "falta": max(0.0, float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0))}
                  for l in o.get("linhas") or []]
        if not any(l["falta"] > 0 for l in linhas):
            continue
        out.append({"id": o["id"], "codigo": o.get("codigo"), "fornecedor": o.get("fornecedor_nome") or "", "data": o.get("data"),
                    "fornecedor_id": o.get("fornecedor_id") or "",
                    "assunto": o.get("assunto") or "", "linhas": linhas})
    return out


@router.get("/movel/inventario-aberto")
async def inventario_aberto(_u: dict = Depends(require_perm("artigos", "view"))):
    """Inventário aberto (resumido) para a app móvel, ou null."""
    inv = await inventarios_repo.find_one({"estado": "aberto"})
    if not inv:
        return None
    ls = inv.get("linhas") or []
    return {"id": inv["id"], "data": inv.get("data"), "n_linhas": len(ls),
            "n_contados": sum(1 for l in ls if l.get("qtd_contada") is not None)}


@router.post("/movel/inventario/{iid}/contar")
async def contar_movel(iid: str, dados: dict, _u: dict = Depends(require_perm("artigos", "edit"))):
    from app.core.security import exigir_movel
    await exigir_movel(_u, "inventario")
    """Regista a contagem de um artigo numa localização. Se a combinação não existir no inventário
    (artigo encontrado num sítio inesperado), acrescenta a linha com stock teórico 0.
    `somar=true` soma à contagem anterior (contar por partes)."""
    inv = await inventarios_repo.get(iid)
    if not inv:
        raise HTTPException(404, "Inventário não encontrado")
    if inv.get("estado") != "aberto":
        raise HTTPException(409, "Inventário fechado")
    aid = dados.get("artigo_id") or ""
    a = await artigos_repo.get(aid)
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if not stock_svc.gere_stock(a):
        raise HTTPException(400, "Este artigo não tem gestão de stock")
    try:
        qtd = float(dados.get("qtd_contada"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Quantidade inválida")
    if qtd < 0:
        raise HTTPException(400, "Quantidade inválida")
    loc = dados.get("localizacao_id") or (await stock_svc.local_padrao())["id"]
    chave = f"{aid}|{loc}"
    linhas = list(inv.get("linhas") or [])
    idx = next((i for i, l in enumerate(linhas) if (l.get("chave") or f"{l['artigo_id']}|") == chave), None)
    if idx is None:
        lo = await localizacoes_repo.get(loc) or {}
        linhas.append({"chave": chave, "artigo_id": aid, "localizacao_id": loc, "localizacao": lo.get("nome") or "",
                       "codigo": a.get("codigo") or "", "nome": a.get("nome") or "", "unidade": a.get("unidade") or "un",
                       "categoria_at": stock_svc.categoria_at(a), "codigo_barras": a.get("codigo_produto") or "",
                       "qtd_teorica": 0.0, "qtd_contada": None,
                       "custo": round(float(a.get("custo_medio") or a.get("custo_artigo") or 0), 4), "adicionada": True})
        idx = len(linhas) - 1
    l = dict(linhas[idx])
    anterior = l.get("qtd_contada")
    novo = qtd + (float(anterior or 0) if dados.get("somar") else 0)
    l["qtd_contada"] = round(novo, 2)
    linhas[idx] = l
    await inventarios_repo.update(iid, {"linhas": linhas})
    return {"linha": l, "anterior": anterior, "n_contados": sum(1 for x in linhas if x.get("qtd_contada") is not None),
            "n_linhas": len(linhas)}



@router.get("/movel/resumo")
async def movel_resumo(user: dict = Depends(require_perm("artigos", "view"))):
    """Números do ecrã inicial da app móvel."""
    from app.repositories import ordens_compra_repo
    ocs = 0
    forns = set()
    for o in await ordens_compra_repo.find({"estado": "criada"}, limit=500):
        if any(float(l.get("quantidade") or 0) - float(l.get("qtd_recebida") or 0) > 1e-9 for l in o.get("linhas") or []):
            ocs += 1
            forns.add(o.get("fornecedor_id") or o.get("fornecedor_nome") or "")
    baixo = 0
    for a in await artigos_repo.find({"gere_stock": True}, limit=50000):
        nivel = float(a.get("nivel_reabastecimento") or 0)
        if stock_svc.gere_stock(a) and nivel and float(a.get("qtd_stock") or 0) < nivel:
            baixo += 1
    inv = await inventarios_repo.find_one({"estado": "aberto"})
    inv_r = None
    if inv:
        ls = inv.get("linhas") or []
        inv_r = {"id": inv["id"], "n_linhas": len(ls), "n_contados": sum(1 for l in ls if l.get("qtd_contada") is not None)}
    return {"ocs_por_receber": ocs, "fornecedores_por_receber": len(forns), "stock_baixo": baixo, "inventario": inv_r}


@router.post("/movel/movimento")
async def movel_movimento(dados: dict, user: dict = Depends(require_perm("artigos", "edit"))):
    """Entrada ou saída avulsa (sem documento): consumo interno, amostra, quebra, devolução, oferta…"""
    from app.core.security import exigir_movel
    await exigir_movel(user, "movimento")
    a = await artigos_repo.get(dados.get("artigo_id") or "")
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    if not stock_svc.gere_stock(a):
        raise HTTPException(400, "Este artigo não tem gestão de stock")
    tipo = dados.get("tipo")
    if tipo not in ("entrada", "saida"):
        raise HTTPException(400, "Tipo inválido")
    try:
        q = abs(float(dados.get("quantidade")))
    except (TypeError, ValueError):
        raise HTTPException(400, "Quantidade inválida")
    if q <= 0:
        raise HTTPException(400, "Indique a quantidade")
    motivo = (dados.get("motivo") or "").strip()
    if not motivo:
        raise HTTPException(400, "Indique o motivo")
    loc = dados.get("localizacao_id") or None
    if tipo == "saida":
        padrao = await stock_svc.local_padrao()
        disp = stock_svc.stock_por_local(a, padrao["id"]).get(loc or a.get("localizacao_id") or padrao["id"], 0.0)
        if q > disp + 1e-9 and not dados.get("permitir_negativo"):
            raise HTTPException(400, f"Só há {disp:g} {a.get('unidade') or 'un'} nessa localização")
    m = await stock_svc.movimentar(a["id"], q if tipo == "entrada" else -q, tipo, user=user, nota=motivo, localizacao_id=loc,
                                   origem={"tipo": "movel", "numero": motivo[:40]})
    return m or {"ok": True}


@router.get("/stock/artigos/etiquetas.pdf")
async def etiquetas_artigos(ids: str = Query(""), copias: int = Query(1, ge=1, le=200),
                            _u: dict = Depends(require_perm("artigos", "view"))):
    """Etiquetas A4 (3 × 8) com código de barras (Code 128) do código do artigo — lidas pela app móvel."""
    from io import BytesIO
    from reportlab.graphics.barcode import code128
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    sel = [x for x in ids.split(",") if x][:500]
    if not sel:
        raise HTTPException(400, "Escolha pelo menos um artigo")
    arts = {a["id"]: a for a in await artigos_repo.find({"id": {"$in": sel}}, limit=500)}
    lista = [arts[i] for i in sel if i in arts for _ in range(copias)]
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    cols, rows = 3, 8
    lw, lh = (w - 10 * mm) / cols, (h - 14 * mm) / rows
    for i, a in enumerate(lista):
        if i and i % (cols * rows) == 0:
            c.showPage()
        k = i % (cols * rows)
        x0 = 5 * mm + (k % cols) * lw
        y0 = h - 7 * mm - (k // cols + 1) * lh
        c.setStrokeColorRGB(0.88, 0.88, 0.88)
        c.rect(x0 + 1 * mm, y0 + 1 * mm, lw - 2 * mm, lh - 2 * mm)
        codigo = str(a.get("codigo") or a.get("codigo_produto") or a["id"][:12])
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(x0 + 4 * mm, y0 + lh - 7 * mm, (a.get("nome") or "")[:38])
        bc = code128.Code128(codigo, barHeight=lh * 0.42, barWidth=0.9 if len(codigo) <= 10 else 0.7, humanReadable=False)
        bx = x0 + (lw - bc.width) / 2
        bc.drawOn(c, max(bx, x0 + 2 * mm), y0 + 8 * mm)
        c.setFont("Helvetica", 9)
        c.drawCentredString(x0 + lw / 2, y0 + 4 * mm, codigo)
    c.save()
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="etiquetas-artigos.pdf"'})


@router.get("/stock/localizacoes/etiquetas.pdf")
async def etiquetas_localizacoes(ids: str = Query(""), _u: dict = Depends(require_perm("artigos", "view"))):
    """Etiquetas A4 (3 × 7) com QR do código da localização — para colar nas prateleiras e ler na app móvel."""
    from io import BytesIO
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics import renderPDF
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    lista = await stock_svc.listar_localizacoes()
    sel = [x for x in ids.split(",") if x]
    if sel:
        lista = [l for l in lista if l["id"] in sel]
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    cols, rows = 3, 7
    lw, lh = (w - 14 * mm) / cols, (h - 14 * mm) / rows
    for i, l in enumerate(lista):
        if i and i % (cols * rows) == 0:
            c.showPage()
        k = i % (cols * rows)
        x0 = 7 * mm + (k % cols) * lw
        y0 = h - 7 * mm - (k // cols + 1) * lh
        c.setStrokeColorRGB(0.85, 0.85, 0.85)
        c.rect(x0 + 1.5 * mm, y0 + 1.5 * mm, lw - 3 * mm, lh - 3 * mm)
        codigo = l.get("codigo") or l.get("nome") or l["id"]
        qr = QrCodeWidget(codigo)
        b = qr.getBounds()
        tam = lh - 10 * mm
        d = Drawing(tam, tam, transform=[tam / (b[2] - b[0]), 0, 0, tam / (b[3] - b[1]), 0, 0])
        d.add(qr)
        renderPDF.draw(d, c, x0 + 4 * mm, y0 + 5 * mm)
        tx = x0 + tam + 7 * mm
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(tx, y0 + lh / 2 + 2 * mm, str(codigo)[:12])
        c.setFont("Helvetica", 8.5)
        c.drawString(tx, y0 + lh / 2 - 4 * mm, (l.get("nome") or "")[:24])
    if not lista:
        c.drawString(20 * mm, h - 30 * mm, "Sem localizações.")
    c.save()
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="etiquetas-localizacoes.pdf"'})
