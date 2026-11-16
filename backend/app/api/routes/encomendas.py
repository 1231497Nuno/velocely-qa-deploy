from io import BytesIO
from typing import List, Optional
import copy

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import of_previsao
from app.services import campos as campos_svc
from app.core.database import now_iso, next_sequence, new_id, round2
from app.core.security import get_current_user, require_perm, resolve_perfil
from app.core.pagination import parse_page, page_payload, text_search
from app.domain.models import EncomendaInput, Encomenda, OrdemFabricoInput, OrdemFabrico, ENC_ESTADO_PT, Pagamento
from app.repositories import encomendas_repo, ordens_repo, orcamentos_repo
from app.services.costing import (
    compute_encomenda, compute_encomendas_many, recompute_of_status, build_of_itens,
    aplicar_pisos_preco_orcamento, backfill_pisos_preco_orcamento, compute_orcamento_totais,
    soma_valor_pago,
)
from app.services.pdf import load_pdf_config, fetch_cliente, fetch_orcamento, build_encomenda_pdf, build_recibo_pdf
from app.services import audit
from app.services import email as email_service
from app.services import contactos as contactos_svc

_ENC_CAMPOS = [
    "cliente", "descricao", "prazo_entrega", "notas", "valor_total", "desconto_total", "envio",
    "entregue", "data_entrega", "contacto_id", "contacto_nome",
]

def _artigos_congelados_do_orcamento(existing: dict, novo_artigos: list) -> list:
    """Mantém valores do ORC; só permite actualizar imagem e cor da linha (não comerciais)."""
    new_by_id = {a.get("id"): a for a in (novo_artigos or []) if a.get("id")}
    out = []
    for old in existing.get("artigos") or []:
        row = copy.deepcopy(old)
        n = new_by_id.get(old.get("id")) or {}
        if "imagem" in n:
            row["imagem"] = n.get("imagem") or row.get("imagem") or ""
        if "cor" in n:  # marcação visual, não comercial
            row["cor"] = n.get("cor") or ""
        out.append(row)
    return out

PAG_METODO_PT = {
    "transferencia": "Transferência bancária", "numerario": "Numerário", "mbway": "MB WAY", "multibanco": "Multibanco",
    "cheque": "Cheque", "cartao": "Cartão", "outro": "Outro",
}


class PagamentoBody(BaseModel):
    valor: float
    metodo: str = "transferencia"
    nota: str = ""
    data: Optional[str] = None
    tipo: str = "pagamento"  # pagamento | devolucao


class EnviarEmailBody(BaseModel):
    to: Optional[str] = None
    template_id: Optional[str] = None
    mensagem: str = ""


router = APIRouter()


def _recompute_pago(enc: dict) -> float:
    return soma_valor_pago(enc.get("pagamentos") or [])


async def _attach_ofs(enc: dict) -> dict:
    ofs = await ordens_repo.find({"encomenda_id": enc["id"]}, sort=("created_at", -1))
    enc["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    return enc


@router.post("/encomendas/{eid}/pagamentos")
async def add_pagamento(eid: str, body: PagamentoBody, user: dict = Depends(require_perm("encomendas", "edit"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if enc.get("estado") == "cancelada":
        raise HTTPException(400, "Não é possível registar pagamentos numa encomenda cancelada")
    if (body.valor or 0) <= 0:
        raise HTTPException(400, "O valor deve ser positivo")
    tipo = (body.tipo or "pagamento").strip().lower()
    if tipo not in ("pagamento", "devolucao"):
        raise HTTPException(400, "Tipo inválido. Use pagamento ou devolucao.")
    if tipo == "devolucao":
        pago_atual = soma_valor_pago(enc.get("pagamentos") or [])
        if round2(body.valor) > pago_atual + 0.009:
            raise HTTPException(400, "A devolução não pode ser superior ao valor já pago")
    pag = Pagamento(
        valor=round2(body.valor),
        metodo=body.metodo or "transferencia",
        nota=body.nota or "",
        data=body.data or now_iso()[:10],
        origem="encomenda",
        tipo=tipo,
    )
    pag.recibo_numero = await next_sequence("DEV" if tipo == "devolucao" else "REC")
    from app.services import workflow
    status_antes = (await compute_encomenda(dict(enc))).get("status_pagamento")
    pagamentos = (enc.get("pagamentos") or []) + [pag.model_dump()]
    total = soma_valor_pago(pagamentos)
    await encomendas_repo.update(eid, {"pagamentos": pagamentos, "valor_pago": total})
    enc["pagamentos"] = pagamentos
    enc["valor_pago"] = total
    if tipo == "devolucao":
        await audit.registar(
            "encomenda", eid, "devolucao", user,
            f"Devolução de {pag.valor:.2f}€ ({PAG_METODO_PT.get(pag.metodo, pag.metodo)}) na encomenda {enc.get('numero')} · {pag.recibo_numero}",
            enc.get("numero"),
        )
    else:
        await audit.registar(
            "encomenda", eid, "pagamento", user,
            f"Pagamento de {pag.valor:.2f}€ ({PAG_METODO_PT.get(pag.metodo, pag.metodo)}) na encomenda {enc.get('numero')} · recibo {pag.recibo_numero}",
            enc.get("numero"),
        )
        await workflow.apos_pagamento(eid, status_antes, pag.valor,
                                      origem=f"{PAG_METODO_PT.get(pag.metodo, pag.metodo)} · {pag.recibo_numero}")
    return await _attach_ofs(await compute_encomenda(enc))


@router.delete("/encomendas/{eid}/pagamentos/{pid}")
async def delete_pagamento(eid: str, pid: str, user: dict = Depends(require_perm("encomendas", "edit"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    existente = next((p for p in (enc.get("pagamentos") or []) if p.get("id") == pid), None)
    if not existente:
        raise HTTPException(404, "Pagamento não encontrado")
    if existente.get("origem") == "fatura":
        raise HTTPException(
            400,
            "Este pagamento veio de um documento fiscal. Anula ou elimina o recibo no módulo Faturas e recibos.",
        )
    if existente.get("documento_id"):
        from app.repositories import documentos_financeiros_repo
        doc = await documentos_financeiros_repo.get(existente["documento_id"])
        if doc and doc.get("estado") != "anulada":
            raise HTTPException(
                400,
                f"Este pagamento tem a {'fatura em rascunho' if doc.get('estado') == 'rascunho' else 'fatura ' + (doc.get('numero') or '')}. "
                "Elimine o rascunho ou anule a fatura primeiro.",
            )
    pagamentos = [p for p in (enc.get("pagamentos") or []) if p.get("id") != pid]
    total = soma_valor_pago(pagamentos)
    await encomendas_repo.update(eid, {"pagamentos": pagamentos, "valor_pago": total})
    enc["pagamentos"] = pagamentos
    enc["valor_pago"] = total
    kind = "Devolução" if existente.get("tipo") == "devolucao" else "Pagamento"
    await audit.registar(
        "encomenda", eid, "pagamento", user,
        f"{kind} removido da encomenda {enc.get('numero')}",
        enc.get("numero"),
    )
    return await _attach_ofs(await compute_encomenda(enc))


@router.get("/encomendas/{eid}/pagamentos/{pid}/recibo")
async def recibo_pdf(eid: str, pid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    """PDF do recibo — exige Bearer + encomendas.view (sem JWT na query)."""
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    pag = next((p for p in (enc.get("pagamentos") or []) if p.get("id") == pid), None)
    if not pag:
        raise HTTPException(404, "Pagamento não encontrado")
    settings, _fields, _sb = await load_pdf_config(None)
    cliente = await fetch_cliente(enc.get("cliente_id"))
    pdf = build_recibo_pdf(enc, pag, settings, cliente, PAG_METODO_PT.get(pag.get("metodo"), pag.get("metodo")))
    filename = f"recibo_{pag.get('recibo_numero') or pid}.pdf"
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{filename}"'})


@router.get("/encomendas")
async def list_encomendas(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    estado_grupo: Optional[str] = Query(None, description="pendentes|concluidas"),
    origem: Optional[str] = Query(None, description="loja = só encomendas da loja online"),
    quadro: bool = Query(False, description="Quadro kanban: sem canceladas e só entregas recentes"),
    entregues_dias: int = Query(30, ge=1, le=3650),
    _u: dict = Depends(require_perm("encomendas", "view")),
):
    query = {}
    if quadro:
        from datetime import datetime, timedelta, timezone
        limite = (datetime.now(timezone.utc) - timedelta(days=entregues_dias)).date().isoformat()
        query["estado"] = {"$ne": "cancelada"}
        query["$or"] = [{"entregue": {"$ne": True}}, {"data_entrega": {"$gte": limite}}]
    if origem == "loja":
        query["origem_externa.canal"] = "woocommerce"
    if estado_grupo == "pendentes":
        query["estado"] = {"$nin": ["concluida", "cancelada"]}
    elif estado_grupo == "concluidas":
        query["estado"] = "concluida"
    ts = text_search(["numero", "cliente", "orcamento_numero", "referencia_cliente"], q)
    if ts:
        query = {"$and": [query, ts]} if "$or" in query else {**query, **ts}
    from app.core.security import filtro_proprios
    fp = await filtro_proprios(_u, "encomendas")
    if fp:
        query = {"$and": [query, fp]} if query else fp
    if page is None:
        encs = await encomendas_repo.find(query, sort=("created_at", -1), limit=5000)
        return await compute_encomendas_many(encs)
    p, ps, skip = parse_page(page, page_size)
    import asyncio
    total, encs = await asyncio.gather(
        encomendas_repo.count(query),
        encomendas_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip),
    )
    return page_payload(await compute_encomendas_many(encs), total, p, ps)


@router.get("/encomendas/{eid}")
async def get_encomenda(eid: str, _u: dict = Depends(require_perm("encomendas", "view"))):
    e = await encomendas_repo.get(eid)
    if e:
        from app.core.security import assert_proprio
        await assert_proprio(_u, "encomendas", e)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    return await _attach_ofs(e)


@router.post("/encomendas")
async def create_encomenda(data: EncomendaInput, user: dict = Depends(require_perm("encomendas", "create"))):
    payload = await contactos_svc.apply_contacto_denorm(data.model_dump())
    payload = await campos_svc.aplicar("encomendas", payload, "criar")
    enc = Encomenda(**payload)
    enc.numero = await next_sequence("ENC")
    if not enc.data:
        enc.data = now_iso()[:10]
    preview = await compute_encomenda(enc.model_dump())
    from app.services.financeiro import assert_limite_credito
    aviso_credito = await assert_limite_credito(
        enc.cliente_id,
        float(preview.get("valor_total") or preview.get("total_com_iva") or 0),
    )
    await encomendas_repo.insert({**enc.model_dump(), "created_by": user.get("id")})
    await audit.registar("encomenda", enc.id, "criado", user, f"Encomenda {enc.numero} criada", enc.numero)
    from app.services import workflow
    await workflow.encomenda_criada(enc.model_dump())
    out = await _attach_ofs(await compute_encomenda(enc.model_dump()))
    if aviso_credito:
        out["aviso_credito"] = aviso_credito
    return out


@router.post("/encomendas/{eid}/repetir", summary="Nova encomenda igual a esta (mesmo cliente, artigos, personalização e arte)")
async def repetir_encomenda(eid: str, dados: dict = None, user: dict = Depends(require_perm("encomendas", "create"))):
    """Copia a encomenda para uma nova (sem pagamentos, entregas nem OF). `quantidades` {linha_id: qtd} opcional;
    linhas com quantidade 0 ficam de fora."""
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    qtds = (dados or {}).get("quantidades") or {}
    artigos = []
    for l in e.get("artigos") or []:
        q = qtds.get(l.get("id"), l.get("quantidade"))
        try:
            q = float(q)
        except (TypeError, ValueError):
            q = float(l.get("quantidade") or 1)
        if q <= 0:
            continue
        novo = {k: v for k, v in l.items() if k not in ("id", "orcamento_linha_id", "quantidade_orcamento")}
        novo["quantidade"] = q
        artigos.append(novo)
    if not artigos:
        raise HTTPException(400, "Não há linhas para repetir")
    base = {k: e.get(k) for k in ("cliente", "cliente_id", "contacto_id", "contacto_nome", "contacto_email", "contacto_telefone",
                                   "contacto_cargo", "contacto_departamento", "contacto_papeis", "campos_extra", "envio")
            if e.get(k) is not None}
    desc = (e.get("descricao") or "").strip()
    data = EncomendaInput(**base, descricao=f"{desc} (repetição da {e.get('numero')})".strip() if desc else f"Repetição da {e.get('numero')}",
                          artigos=artigos)
    nova = await create_encomenda(data, user)
    await encomendas_repo.update(nova["id"], {"repete_encomenda_id": eid, "repete_encomenda_numero": e.get("numero")})
    await audit.registar("encomenda", nova["id"], "criado", user, f"Encomenda {nova.get('numero')} criada a repetir a {e.get('numero')}", nova.get("numero"))
    return nova


async def _assert_qtd_nao_abaixo_ofs(eid: str, artigos: list) -> None:
    """Impede reduzir quantidades da encomenda abaixo do já lançado em OFs."""
    ofs = await ordens_repo.find({"encomenda_id": eid}, limit=500)
    of_qty: dict = {}
    nome_of: dict = {}
    for o in ofs:
        for it in o.get("itens") or []:
            aid = it.get("artigo_id")
            if not aid:
                continue
            of_qty[aid] = of_qty.get(aid, 0.0) + float(it.get("quantidade") or 0)
            if aid not in nome_of:
                nome_of[aid] = (it.get("artigo_nome") or "").strip()
    enc_qty: dict = {}
    nome_enc: dict = {}
    for a in artigos or []:
        aid = a.get("artigo_id")
        if not aid:
            continue
        enc_qty[aid] = enc_qty.get(aid, 0.0) + float(a.get("quantidade") or 0)
        if aid not in nome_enc:
            nome_enc[aid] = (a.get("artigo_nome") or "").strip()
    for aid, alocado in of_qty.items():
        if alocado <= 0:
            continue
        tem = enc_qty.get(aid, 0.0)
        if tem + 1e-9 < alocado:
            nome = nome_enc.get(aid) or nome_of.get(aid) or "artigo"
            raise HTTPException(
                400,
                f"Não é possível reduzir a quantidade de «{nome}» abaixo do já alocado em OFs "
                f"({alocado:g}). Elimine ou ajuste a ordem de fabrico primeiro.",
            )


@router.put("/encomendas/{eid}")
async def update_encomenda(eid: str, data: EncomendaInput, user: dict = Depends(require_perm("encomendas", "edit"))):
    existing = await encomendas_repo.get(eid)
    if not existing:
        raise HTTPException(404, "Encomenda não encontrada")
    novo = await campos_svc.aplicar("encomendas", data.model_dump(), "guardar", existing)
    if novo.get("entregue") and not existing.get("entregue"):
        from app.services import workflow
        workflow.assert_nao_bloqueada(existing, "marcar a entrega")
    novo.pop("anexos", None)
    if "entregue" not in data.model_fields_set:
        novo["entregue"] = bool(existing.get("entregue"))
    if "data_entrega" not in data.model_fields_set:
        novo["data_entrega"] = existing.get("data_entrega")
    novo = await contactos_svc.apply_contacto_denorm(novo)
    orc = None
    if existing.get("orcamento_id"):
        # Valores comerciais vêm do orçamento e não são editáveis
        orc = await orcamentos_repo.get(existing["orcamento_id"])
        backfill_pisos_preco_orcamento(existing, orc)
        novo["artigos"] = _artigos_congelados_do_orcamento(existing, novo.get("artigos") or [])
        novo["desconto_total"] = existing.get("desconto_total") or 0
        novo["desconto_total_tipo"] = existing.get("desconto_total_tipo") or "pct"
        novo["envio"] = existing.get("envio") or 0
        novo["valor_total_manual"] = False
        novo["valor_total"] = None
        novo["orcamento_id"] = existing.get("orcamento_id")
        novo["orcamento_numero"] = existing.get("orcamento_numero")
    else:
        erros = aplicar_pisos_preco_orcamento(existing, novo)
        if erros:
            raise HTTPException(400, " ".join(erros))
        await _assert_qtd_nao_abaixo_ofs(eid, novo.get("artigos") or [])
        if novo.get("valor_total_manual") and not existing.get("valor_total_manual"):
            perfil = await resolve_perfil(user)
            if not perfil.get("admin"):
                raise HTTPException(
                    403,
                    "Só administradores podem activar valor total manual numa encomenda.",
                )
    numero = existing.get("numero")
    await encomendas_repo.update(eid, novo)
    if bool(existing.get("valor_total_manual")) != bool(novo.get("valor_total_manual")) or (
        novo.get("valor_total_manual")
        and round(float(existing.get("valor_total") or 0), 2) != round(float(novo.get("valor_total") or 0), 2)
    ):
        await audit.registar(
            "encomenda", eid, "editado", user,
            (
                f"Valor total manual da encomenda {numero}: "
                f"{'activado' if novo.get('valor_total_manual') else 'desactivado'}"
                f" · {float(novo.get('valor_total') or 0):.2f}€"
            ),
            numero,
        )
    # pagamento
    old_pago = existing.get("valor_pago") or 0
    new_pago = novo.get("valor_pago") or 0
    if round(old_pago, 2) != round(new_pago, 2):
        await audit.registar("encomenda", eid, "pagamento", user,
                             f"Pagamento da encomenda {numero}: {old_pago:.2f} → {new_pago:.2f}", numero)
    # autorização de produção
    if bool(existing.get("autorizada_producao")) != bool(novo.get("autorizada_producao")):
        estado = "autorizada" if novo.get("autorizada_producao") else "revogada"
        await audit.registar("encomenda", eid, "producao_autorizada", user,
                             f"Produção {estado} na encomenda {numero}", numero)
    if bool(existing.get("entregue")) != bool(novo.get("entregue")):
        await audit.registar(
            "encomenda", eid, "editado", user,
            f"Material {'entregue' if novo.get('entregue') else 'marcado como não entregue'} na encomenda {numero}",
            numero,
        )
    # estado
    if existing.get("estado") != novo.get("estado"):
        await audit.registar("encomenda", eid, "estado_alterado", user,
                             f"Estado da encomenda {numero} → {ENC_ESTADO_PT.get(novo.get('estado'), novo.get('estado'))}", numero)
    # outros campos
    alteracoes = audit.diff_campos(existing, novo, _ENC_CAMPOS)
    if alteracoes:
        await audit.registar("encomenda", eid, "editado", user, f"Encomenda {numero} editada", numero, alteracoes)
    merged = {**existing, **novo}
    return await _attach_ofs(await compute_encomenda(merged))


class BloqueioBody(BaseModel):
    motivo: str = ""


@router.post("/encomendas/{eid}/bloquear")
async def bloquear_encomenda(eid: str, body: BloqueioBody, user: dict = Depends(require_perm("encomendas", "edit"))):
    """Põe a encomenda em espera: não produz, não fatura nem se entrega até ser desbloqueada."""
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    motivo = (body.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "Indique o motivo do bloqueio")
    b = {"ativo": True, "motivo": motivo, "por": {"id": user.get("id"), "nome": user.get("name") or user.get("nome") or ""},
         "at": now_iso()}
    await encomendas_repo.update(eid, {"bloqueio": b})
    await audit.registar("encomenda", eid, "estado_alterado", user, f"Encomenda {enc.get('numero')} bloqueada: {motivo}", enc.get("numero"))
    from app.services import workflow
    await workflow.evento("encomenda_bloqueada", f"Encomenda bloqueada: {enc.get('numero')} ({enc.get('cliente') or ''})",
                          f"Motivo: {motivo}", link=f"/encomendas/{eid}", entidade="encomenda", entidade_id=eid)
    return await _attach_ofs(await compute_encomenda({**enc, "bloqueio": b}))


@router.post("/encomendas/{eid}/desbloquear")
async def desbloquear_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "edit"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    b = enc.get("bloqueio") or {}
    if not b.get("ativo"):
        return await _attach_ofs(await compute_encomenda(enc))
    # Como no Sage: quem bloqueou pode sempre desbloquear; os restantes só administradores
    perfil = await resolve_perfil(user)
    if not perfil.get("admin") and (b.get("por") or {}).get("id") != user.get("id"):
        raise HTTPException(403, f"Só {(b.get('por') or {}).get('nome') or 'quem bloqueou'} ou um administrador pode desbloquear")
    novo = {**b, "ativo": False, "desbloqueado_por": {"id": user.get("id"), "nome": user.get("name") or ""}, "desbloqueado_at": now_iso()}
    await encomendas_repo.update(eid, {"bloqueio": novo})
    await audit.registar("encomenda", eid, "estado_alterado", user, f"Encomenda {enc.get('numero')} desbloqueada", enc.get("numero"))
    from app.services import workflow
    await workflow.evento("encomenda_bloqueada", f"Encomenda desbloqueada: {enc.get('numero')}", "",
                          link=f"/encomendas/{eid}", entidade="encomenda", entidade_id=eid)
    return await _attach_ofs(await compute_encomenda({**enc, "bloqueio": novo}))


class EntregaBody(BaseModel):
    entregue: bool
    data_entrega: Optional[str] = None


@router.post("/encomendas/{eid}/entrega")
async def marcar_entrega(eid: str, body: EntregaBody, user: dict = Depends(require_perm("encomendas", "edit"))):
    """Marca/desmarca a encomenda como entregue (usado também pelo quadro kanban)."""
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if enc.get("estado") == "cancelada":
        raise HTTPException(409, "Encomenda cancelada")
    if body.entregue:
        from app.services import workflow
        workflow.assert_nao_bloqueada(enc, "marcar a entrega")
    if bool(enc.get("entregue")) == body.entregue:
        return await _attach_ofs(await compute_encomenda(enc))
    data = ((body.data_entrega or enc.get("data_entrega") or now_iso())[:10]) if body.entregue else None
    await encomendas_repo.update(eid, {"entregue": body.entregue, "data_entrega": data})
    if body.entregue:
        from app.services.integracoes import concluir_pedido_loja
        await concluir_pedido_loja(enc)
    await audit.registar(
        "encomenda", eid, "editado", user,
        f"Material {'entregue' if body.entregue else 'marcado como não entregue'} na encomenda {enc.get('numero')}",
        enc.get("numero"),
    )
    return await _attach_ofs(await compute_encomenda({**enc, "entregue": body.entregue, "data_entrega": data}))


@router.delete("/encomendas/{eid}")
async def delete_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "delete"))):
    existing = await encomendas_repo.get(eid)
    await ordens_repo.update_many(
        {"encomenda_id": eid}, {"encomenda_id": None, "encomenda_numero": None}
    )
    await encomendas_repo.delete({"id": eid})
    if existing:
        await audit.registar("encomenda", eid, "eliminado", user,
                             f"Encomenda {existing.get('numero')} eliminada", existing.get("numero"))
    return {"ok": True}


@router.post("/encomendas/{eid}/duplicar")
async def duplicar_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "create"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    novo = {**enc}
    novo.update({
        "id": new_id(),
        "numero": await next_sequence("ENC"),
        "estado": "aberta",
        "valor_pago": 0.0,
        "pagamentos": [],
        "autorizada_producao": False,
        "entregue": False,
        "data_entrega": None,
        "orcamento_id": None,
        "orcamento_numero": None,
        "created_at": now_iso(),
        "data": now_iso()[:10],
    })
    for a in novo.get("artigos") or []:
        if isinstance(a, dict):
            a.pop("preco_unit_orcamento", None)
    await encomendas_repo.insert(novo)
    await audit.registar("encomenda", novo["id"], "duplicado", user,
                         f"Encomenda {novo['numero']} criada a partir de {enc.get('numero')}", novo["numero"])
    return await compute_encomenda(novo)


@router.post("/encomendas/{eid}/ordens-fabrico")
async def create_of_for_encomenda(eid: str, data: OrdemFabricoInput, user: dict = Depends(require_perm("ordens_fabrico", "create"))):
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    from app.services import workflow
    workflow.assert_nao_bloqueada(enc, "criar ordens de fabrico")
    payload = data.model_dump()
    payload["encomenda_id"] = eid
    payload["cliente"] = enc.get("cliente") or payload.get("cliente") or ""
    payload["cliente_id"] = enc.get("cliente_id")
    if not (payload.get("descricao") or "").strip():
        payload["descricao"] = enc.get("descricao") or ""
    if not (payload.get("notas") or "").strip():
        payload["notas"] = enc.get("notas") or ""
    if not payload.get("prazo_entrega"):
        payload["prazo_entrega"] = enc.get("prazo_entrega")
    if not (payload.get("numero_encomenda") or "").strip():
        payload["numero_encomenda"] = enc.get("referencia_cliente") or enc.get("numero") or ""
    enc_por_id = {
        a.get("artigo_id"): a
        for a in (enc.get("artigos") or [])
        if isinstance(a, dict) and a.get("artigo_id")
    }
    enc_por_linha = {a.get("id"): a for a in (enc.get("artigos") or []) if isinstance(a, dict)}
    for it in payload.get("itens") or []:
        src = enc_por_linha.get(it.get("enc_artigo_id")) or enc_por_id.get(it.get("artigo_id")) or {}
        if not it.get("artigo_nome"):
            it["artigo_nome"] = src.get("artigo_nome") or ""
        if not it.get("artigo_codigo"):
            it["artigo_codigo"] = src.get("artigo_codigo") or ""
        if not it.get("imagem"):
            it["imagem"] = src.get("imagem") or ""
        if not it.get("preco_unit"):
            it["preco_unit"] = float(src.get("preco_unit") or 0)
        if not it.get("personalizacoes"):
            it["personalizacoes"] = src.get("personalizacoes") or []
        if not it.get("cor"):
            it["cor"] = src.get("cor") or ""
        if not it.get("arte_path"):
            it["arte_path"] = src.get("arte_path") or ""
            it["arte_nome"] = src.get("arte_nome") or ""
            it["arte_content_type"] = src.get("arte_content_type") or ""
    if not payload.get("imagens"):
        payload["imagens"] = enc.get("imagens") or []
    if not payload.get("anexos"):
        payload["anexos"] = list(enc.get("anexos") or [])
    # Operações e materiais: do orçamento de origem (ou do catálogo), para a qtd de cada item
    payload["itens"] = await of_previsao.montar_itens(enc, payload.get("itens") or [])
    of = OrdemFabrico(**payload)
    of.orcamento_id = enc.get("orcamento_id")
    of.orcamento_numero = enc.get("orcamento_numero")
    of.numero = await next_sequence("OF")
    of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
    await audit.registar("ordem_fabrico", of.id, "criado", user,
                         f"OF {of.numero} criada na encomenda {enc.get('numero')}", of.numero)
    await audit.registar("encomenda", eid, "editado", user,
                         f"OF {of.numero} associada à encomenda {enc.get('numero')}", enc.get("numero"))
    return doc


class PrevisaoOFBody(BaseModel):
    itens: List[dict] = []


@router.post("/encomendas/{eid}/ordens-fabrico/previsao")
async def previsao_of(eid: str, data: PrevisaoOFBody, _u: dict = Depends(require_perm("ordens_fabrico", "create"))):
    """Resumo para validar antes de criar a OF: operações, materiais, tempos e custos por artigo."""
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    itens = await of_previsao.montar_itens(enc, data.itens or [])
    if not itens:
        raise HTTPException(400, "Indique pelo menos uma quantidade a produzir")
    return {"itens": itens, "resumo": of_previsao.resumo(itens, enc),
            "orcamento_numero": enc.get("orcamento_numero")}


@router.get("/encomendas/{eid}/pdf")
async def encomenda_pdf(eid: str, template_id: Optional[str] = None, _u: dict = Depends(require_perm("encomendas", "view"))):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    ofs = await ordens_repo.find({"encomenda_id": eid}, sort=("created_at", -1))
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    settings, fields, show_branding = await load_pdf_config(template_id, "encomenda")
    cliente = await fetch_cliente(e.get("cliente_id"))
    orcamento = await fetch_orcamento(e.get("orcamento_id"))
    pdf = build_encomenda_pdf(e, settings, fields, show_branding, cliente, orcamento)
    filename = f"{e.get('numero', 'encomenda')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


async def _enviar_encomenda_notificacao(eid: str, body: EnviarEmailBody, user: dict, tipo: str):
    e = await encomendas_repo.get(eid)
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    if e.get("estado") == "cancelada":
        raise HTTPException(400, "Não é possível notificar uma encomenda cancelada")

    cliente = await fetch_cliente(e.get("cliente_id"))
    # Preferir «à atenção de», senão email da empresa
    to = contactos_svc.resolve_email_destinatario(
        e, cliente, explicit_to=body.to or "", prefer_papel="financeiro",
    )
    if not to or "@" not in to:
        raise HTTPException(400, "O cliente não tem email válido. Indique um destinatário ou actualize o cliente.")

    prazo = (e.get("prazo_entrega") or "").strip()
    if tipo == "prazo" and not prazo:
        raise HTTPException(400, "Defina a data de entrega prevista antes de notificar o cliente.")

    ofs = await ordens_repo.find({"encomenda_id": eid}, sort=("created_at", -1))
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    settings, fields, show_branding = await load_pdf_config(body.template_id, "encomenda")
    orcamento = await fetch_orcamento(e.get("orcamento_id"))
    pdf = build_encomenda_pdf(e, settings, fields, show_branding, cliente, orcamento)
    numero = e.get("numero") or "encomenda"
    nome = (cliente or {}).get("nome") or e.get("cliente") or ""
    simbolo = (settings or {}).get("moeda_simbolo") or "€"
    valores = email_service.valores_encomenda_email(e, simbolo)
    if tipo == "prazo":
        subject, text, html = await email_service.encomenda_prazo_email(
            nome, numero, prazo, mensagem=body.mensagem or "", valores=valores,
        )
        audit_txt = (
            f"Notificação de data de entrega prevista ({email_service.fmt_date_pt(prazo)}) "
            f"da encomenda {numero} enviada para {email_service.mask_email(to)} "
            f"(a faturar {valores.get('valor_a_faturar')})"
        )
    else:
        subject, text, html = await email_service.encomenda_pronta_email(
            nome, numero, mensagem=body.mensagem or "", valores=valores,
        )
        audit_txt = (
            f"Notificação de encomenda {numero} pronta enviada para {email_service.mask_email(to)} "
            f"(a faturar {valores.get('valor_a_faturar')})"
        )

    ok, reason = email_service.send_email(
        to,
        subject,
        text,
        html=html,
        attach_logo=True,
        attachments=[(f"{numero}.pdf", pdf, "application/pdf")],
    )
    if not ok and reason == "no_smtp":
        raise HTTPException(503, "Envio de email não está configurado. Contacte o administrador.")
    if not ok:
        raise HTTPException(500, f"Não foi possível enviar o email: {reason}")

    await audit.registar("encomenda", eid, "email_enviado", user, audit_txt, numero)
    return {
        "ok": True,
        "email_sent": True,
        "email_masked": email_service.mask_email(to),
        "message": f"Notificação enviada para {email_service.mask_email(to)}",
    }


@router.get("/encomendas/{eid}/custo-real", summary="Custo real vs previsto da encomenda")
async def custo_real_encomenda(eid: str, user: dict = Depends(require_perm("encomendas", "view"))):
    from app.core.security import pode_ver_custos
    from app.services import custo_real
    if not await pode_ver_custos(user):
        raise HTTPException(403, "O seu perfil não tem acesso a custos e margens")
    return await custo_real.encomenda(eid)


@router.post("/encomendas/{eid}/enviar-email-pronta", summary="Notificar cliente: encomenda pronta")
async def enviar_encomenda_pronta_email(
    eid: str,
    body: EnviarEmailBody = EnviarEmailBody(),
    user: dict = Depends(require_perm("encomendas", "edit")),
):
    return await _enviar_encomenda_notificacao(eid, body, user, "pronta")


@router.post("/encomendas/{eid}/enviar-email-prazo", summary="Notificar cliente: data de entrega prevista")
async def enviar_encomenda_prazo_email(
    eid: str,
    body: EnviarEmailBody = EnviarEmailBody(),
    user: dict = Depends(require_perm("encomendas", "edit")),
):
    return await _enviar_encomenda_notificacao(eid, body, user, "prazo")
