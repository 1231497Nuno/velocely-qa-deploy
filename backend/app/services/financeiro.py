"""Serviço de faturas (fatura, proforma, recibo, fatura-recibo)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import hashlib

from app.core.database import now_iso, round2
from app.domain.models import (
    DOC_TIPOS_PRINCIPAIS, DOC_TIPOS_COM_RECIBOS, DOC_TIPO_PT,
    DocumentoFinanceiro, DocumentoLinha, Pagamento,
)
from app.repositories import clientes_repo, documentos_financeiros_repo, encomendas_repo, empresa_repo
from app.services.costing import compute_encomenda, iva_calc, pers_valor_unit, soma_valor_pago
from app.services.numeracao import next_codigo
from app.services import audit

NUMERACAO_POR_TIPO = {
    "fatura": "fatura",
    "proforma": "proforma",
    "recibo": "recibo",
    "fatura_recibo": "fatura_recibo",
}

# Tipos que consomem quantidade "já faturada" da encomenda
TIPOS_CONSUMAM_QTD = ("fatura", "fatura_recibo")

PAG_METODO_PT = {
    "transferencia": "Transferência bancária", "numerario": "Numerário", "mbway": "MB WAY", "multibanco": "Multibanco",
    "cheque": "Cheque", "cartao": "Cartão", "outro": "Outro",
}


class LinhaParcialInput(BaseModel):
    encomenda_artigo_id: str
    quantidade: float


def _linha_from_artigo(a: dict, quantidade: Optional[float] = None) -> dict:
    qtd = float(quantidade if quantidade is not None else (a.get("quantidade") or 0))
    pu_base = float(a.get("preco_unit") or 0) + pers_valor_unit(a)
    bruto = pu_base * qtd
    d = float(a.get("desconto") or 0)
    if d > 0:
        # Desconto em € na linha original é proporcional à quantidade parcial
        if a.get("desconto_tipo") == "eur":
            qtd_orig = float(a.get("quantidade") or 0) or 1
            desc = min(d * (qtd / qtd_orig), bruto)
        else:
            desc = (bruto * d) / 100
    else:
        desc = 0.0
    return DocumentoLinha(
        artigo_id=a.get("artigo_id"),
        encomenda_artigo_id=a.get("id"),
        descricao=a.get("artigo_nome") or "—",
        quantidade=qtd,
        preco_unit=round2(pu_base),
        desconto=float(a.get("desconto") or 0),
        desconto_tipo=a.get("desconto_tipo") or "pct",
        personalizacoes=a.get("personalizacoes") or [],
        subtotal=round2(bruto - desc),
    ).model_dump()


async def list_recibos_fatura(fatura_id: str) -> list:
    return await documentos_financeiros_repo.find(
        {"tipo": "recibo", "fatura_id": fatura_id, "estado": {"$ne": "anulada"}},
        sort=("created_at", 1),
        limit=500,
    )


async def enrich_documento(doc: dict) -> dict:
    """Acrescenta recibos, valor liquidado/pendente e status de pagamento às faturas."""
    return (await enrich_documentos_many([doc]))[0]


async def enrich_documentos_many(docs: list) -> list:
    """Enriquece documentos em lote (1 query de recibos para a página)."""
    if not docs:
        return []
    fatura_ids = [d["id"] for d in docs if d.get("tipo") in DOC_TIPOS_COM_RECIBOS and d.get("id")]
    recibos_by: dict = {fid: [] for fid in fatura_ids}
    if fatura_ids:
        recibos = await documentos_financeiros_repo.find(
            {"tipo": "recibo", "fatura_id": {"$in": fatura_ids}, "estado": {"$ne": "anulada"}},
            sort=("created_at", 1),
            limit=max(500, len(fatura_ids) * 20),
        )
        for r in recibos:
            recibos_by.setdefault(r.get("fatura_id"), []).append(r)

    out = []
    for doc in docs:
        d = {**doc}
        if d.get("tipo") in DOC_TIPOS_COM_RECIBOS:
            recibos = recibos_by.get(d.get("id"), [])
            d["recibos"] = recibos
            total_pago = round2(sum((r.get("valor_pago") or 0) for r in recibos))
            if not recibos and d.get("tipo") == "fatura_recibo":
                total_pago = round2(d.get("valor_pago") or 0)
            total = round2(d.get("total") or 0)
            d["valor_liquidado"] = total_pago
            d["valor_pendente"] = round2(max(0.0, total - total_pago))
            if total_pago <= 0:
                d["status_pagamento"] = "pendente"
            elif total_pago < total - 0.009:
                d["status_pagamento"] = "parcial"
            else:
                d["status_pagamento"] = "pago"
        out.append(d)
    return out


async def exposicao_credito_cliente(cliente_id: Optional[str], *, excluir_encomenda_id: Optional[str] = None) -> float:
    """Soma aproximada de valores em aberto das encomendas activas do cliente."""
    if not cliente_id:
        return 0.0
    encs = await encomendas_repo.find(
        {"cliente_id": cliente_id, "estado": {"$nin": ["cancelada"]}},
        limit=5000,
    )
    total = 0.0
    for e in encs:
        if excluir_encomenda_id and e.get("id") == excluir_encomenda_id:
            continue
        if e.get("estado") == "concluida" and float(e.get("valor_pago") or 0) >= float(e.get("valor_total") or 0) - 0.009:
            continue
        valor = float(e.get("valor_total") or e.get("total_com_iva") or 0)
        pago = float(e.get("valor_pago") or 0)
        total += max(0.0, valor - pago)
    return round2(total)


async def assert_limite_credito(
    cliente_id: Optional[str],
    novo_valor: float,
    *,
    excluir_encomenda_id: Optional[str] = None,
) -> Optional[str]:
    """Bloqueia (ou só avisa, conforme Definições) se exposição + novo_valor exceder o limite de crédito."""
    if not cliente_id:
        return
    from app.repositories import clientes_repo
    cli = await clientes_repo.get(cliente_id)
    if not cli:
        return
    limite = cli.get("limite_credito")
    if limite is None:
        return
    try:
        limite = float(limite)
    except (TypeError, ValueError):
        return
    if limite < 0:
        return
    exposicao = await exposicao_credito_cliente(cliente_id, excluir_encomenda_id=excluir_encomenda_id)
    projectado = round2(exposicao + max(0.0, float(novo_valor or 0)))
    if projectado > limite + 0.009:
        msg = (f"Limite de crédito do cliente excedido "
               f"(limite {limite:.2f}€ · em aberto {exposicao:.2f}€ · novo {float(novo_valor or 0):.2f}€).")
        from app.services import workflow
        if (await workflow.get_config()).get("credito_modo") == "aviso":
            return msg  # Definições: só avisar
        raise HTTPException(400, msg)
    return None


async def _registar_pagamento_encomenda(enc_id: Optional[str], valor: float, metodo: str, recibo_numero: str, data: str):
    if not enc_id or valor <= 0:
        return
    enc = await encomendas_repo.get(enc_id)
    if not enc:
        return
    pag = Pagamento(
        valor=valor,
        metodo=metodo or "transferencia",
        nota=f"Recibo {recibo_numero}",
        data=data or now_iso()[:10],
        recibo_numero=recibo_numero,
        origem="fatura",
        tipo="pagamento",
    )
    from app.services import workflow
    status_antes = await workflow.status_pagamento(enc_id)
    pagamentos = (enc.get("pagamentos") or []) + [pag.model_dump()]
    total_pago = soma_valor_pago(pagamentos)
    await encomendas_repo.update(enc_id, {"pagamentos": pagamentos, "valor_pago": total_pago})
    await workflow.apos_pagamento(enc_id, status_antes, valor, origem=f"Recibo {recibo_numero}")


async def _reverter_pagamento_encomenda_por_recibo(enc_id: Optional[str], recibo_numero: Optional[str]) -> int:
    """Remove da encomenda o pagamento gerado por um recibo fiscal. Devolve quantos removeu."""
    if not enc_id or not (recibo_numero or "").strip():
        return 0
    enc = await encomendas_repo.get(enc_id)
    if not enc:
        return 0
    numero = (recibo_numero or "").strip()
    before = enc.get("pagamentos") or []
    after = [
        p for p in before
        if not (
            isinstance(p, dict)
            and p.get("origem") == "fatura"
            and (p.get("recibo_numero") or "").strip() == numero
        )
    ]
    removed = len(before) - len(after)
    if removed <= 0:
        return 0
    total_pago = soma_valor_pago(after)
    await encomendas_repo.update(enc_id, {"pagamentos": after, "valor_pago": total_pago})
    return removed


async def reverter_efeitos_documento(doc: dict) -> dict:
    """
    Ao anular/apagar um documento fiscal, reverte pagamentos na encomenda.
    - recibo: remove o pagamento ligado ao nº do recibo
    - fatura / fatura_recibo: anula/reverte todos os recibos filhos + pagamentos
    """
    if not doc:
        return {"recibos_revertidos": 0, "pagamentos_revertidos": 0}

    tipo = doc.get("tipo")
    enc_id = doc.get("encomenda_id")
    pagamentos_revertidos = 0
    recibos_revertidos = 0

    if tipo == "recibo":
        pagamentos_revertidos += await _reverter_pagamento_encomenda_por_recibo(
            enc_id, doc.get("numero"),
        )
        return {"recibos_revertidos": 0, "pagamentos_revertidos": pagamentos_revertidos}

    if tipo in ("fatura", "fatura_recibo"):
        recibos = await documentos_financeiros_repo.find(
            {"tipo": "recibo", "fatura_id": doc.get("id")},
            limit=500,
        )
        for r in recibos:
            if r.get("estado") != "anulada":
                await documentos_financeiros_repo.update(r["id"], {"estado": "anulada"})
                recibos_revertidos += 1
            pagamentos_revertidos += await _reverter_pagamento_encomenda_por_recibo(
                enc_id or r.get("encomenda_id"),
                r.get("numero"),
            )
        # Legado: fatura-recibo sem recibo filho mas com valor_pago directo
        if tipo == "fatura_recibo" and pagamentos_revertidos == 0 and (doc.get("valor_pago") or 0) > 0:
            pagamentos_revertidos += await _reverter_pagamento_encomenda_por_recibo(
                enc_id, doc.get("numero"),
            )

    return {
        "recibos_revertidos": recibos_revertidos,
        "pagamentos_revertidos": pagamentos_revertidos,
    }


async def qtd_ja_faturada_por_linha(encomenda_id: str) -> dict:
    """Soma quantidades já incluídas em faturas / faturas-recibo (não anuladas)."""
    docs = await documentos_financeiros_repo.find(
        {
            "encomenda_id": encomenda_id,
            "tipo": {"$in": list(TIPOS_CONSUMAM_QTD)},
            "estado": {"$nin": ["anulada", "rascunho"]},
        },
        limit=2000,
    )
    out: dict = {}
    for d in docs:
        for l in d.get("linhas") or []:
            key = l.get("encomenda_artigo_id") or l.get("artigo_id")
            if not key:
                continue
            out[key] = round2((out.get(key) or 0) + float(l.get("quantidade") or 0))
    return out


async def resumo_faturacao_encomenda(encomenda_id: str) -> dict:
    enc = await encomendas_repo.get(encomenda_id)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    ja = await qtd_ja_faturada_por_linha(encomenda_id)
    artigos = []
    for a in enc.get("artigos") or []:
        aid = a.get("id")
        key = aid or a.get("artigo_id")
        qtd = float(a.get("quantidade") or 0)
        faturado = float(ja.get(aid) or ja.get(a.get("artigo_id")) or 0)
        restante = round2(max(0.0, qtd - faturado))
        artigos.append({
            "encomenda_artigo_id": aid,
            "artigo_id": a.get("artigo_id"),
            "artigo_nome": a.get("artigo_nome") or "—",
            "quantidade": qtd,
            "quantidade_faturada": faturado,
            "quantidade_restante": restante,
            "preco_unit": float(a.get("preco_unit") or 0) + pers_valor_unit(a),
        })
    return {"encomenda_id": encomenda_id, "artigos": artigos}


async def build_doc_from_encomenda(
    enc: dict,
    tipo: str,
    *,
    metodo_pagamento: str = "transferencia",
    notas: str = "",
    linhas_parcial: Optional[List[LinhaParcialInput]] = None,
    adiantamento: bool = False,
) -> dict:
    if tipo not in DOC_TIPOS_PRINCIPAIS:
        raise HTTPException(
            400,
            f"Tipo inválido. Use: {', '.join(DOC_TIPOS_PRINCIPAIS)}. "
            "Os recibos emitem-se a partir da fatura.",
        )
    if enc.get("estado") == "cancelada":
        raise HTTPException(400, "Não é possível emitir faturas de uma encomenda cancelada")

    enc_c = await compute_encomenda(enc)

    # Proforma: livre (sem valor fiscal). Fatura / fatura-recibo: preferir após
    # produção concluída; adiantamento explícito permite emitir antes.
    if tipo in TIPOS_CONSUMAM_QTD and enc_c.get("estado") != "concluida" and not adiantamento:
        raise HTTPException(
            400,
            "A fatura fiscal emite-se normalmente quando a encomenda está concluída "
            "(material pronto). Confirma «adiantamento» para emitir antes, "
            "ou usa proforma enquanto a produção não termina.",
        )
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    artigos_by_id = {a.get("id"): a for a in (enc_c.get("artigos") or []) if a.get("id")}

    if linhas_parcial:
        # Faturação parcial: só as linhas/qtds pedidas
        ja = await qtd_ja_faturada_por_linha(enc_c["id"]) if tipo in TIPOS_CONSUMAM_QTD else {}
        linhas = []
        for lp in linhas_parcial:
            a = artigos_by_id.get(lp.encomenda_artigo_id)
            if not a:
                raise HTTPException(400, f"Artigo da encomenda não encontrado: {lp.encomenda_artigo_id}")
            qtd = round2(lp.quantidade)
            if qtd <= 0:
                continue
            qtd_enc = float(a.get("quantidade") or 0)
            if tipo in TIPOS_CONSUMAM_QTD:
                faturado = float(ja.get(lp.encomenda_artigo_id) or 0)
                restante = round2(max(0.0, qtd_enc - faturado))
                if qtd > restante + 0.009:
                    raise HTTPException(
                        400,
                        f"Quantidade a faturar de «{a.get('artigo_nome')}» ({qtd:g}) "
                        f"excede o restante ({restante:g})",
                    )
            elif qtd > qtd_enc + 0.009:
                raise HTTPException(
                    400,
                    f"Quantidade de «{a.get('artigo_nome')}» excede a encomenda ({qtd_enc:g})",
                )
            linhas.append(_linha_from_artigo(a, qtd))
        if not linhas:
            raise HTTPException(400, "Indica pelo menos uma quantidade a faturar")
        subtotal = round2(sum(l.get("subtotal") or 0 for l in linhas))
        # Desconto total da encomenda: só se faturação completa de todos os artigos
        desconto_total = 0.0
    else:
        # Total: todas as linhas da encomenda
        linhas = [_linha_from_artigo(a) for a in (enc_c.get("artigos") or [])]
        if not linhas:
            raise HTTPException(400, "A encomenda não tem artigos para faturar")
        if tipo in TIPOS_CONSUMAM_QTD:
            ja = await qtd_ja_faturada_por_linha(enc_c["id"])
            for a in enc_c.get("artigos") or []:
                aid = a.get("id")
                faturado = float(ja.get(aid) or 0)
                if faturado > 0.009:
                    raise HTTPException(
                        400,
                        "Já existem quantidades faturadas. Seleciona as linhas parciais restantes.",
                    )
        subtotal = round2(enc_c.get("valor_total") or sum(l.get("subtotal") or 0 for l in linhas))
        from app.services.costing import encomenda_artigos_breakdown
        bd = encomenda_artigos_breakdown(enc_c)
        desconto_total = round2(bd.get("desconto_total_valor") or 0)
        if desconto_total > 0 and abs(subtotal - (bd.get("total") or subtotal)) < 0.02:
            subtotal = round2(bd.get("total") or subtotal)

    iva = iva_calc(subtotal, settings)
    total = iva["total_com_iva"]

    valor_pago = 0.0
    if tipo == "fatura_recibo":
        # Liquida o valor desta fatura (parcial ou total)
        valor_pago = total

    doc = DocumentoFinanceiro(
        tipo=tipo,
        cliente=enc_c.get("cliente") or "",
        cliente_id=enc_c.get("cliente_id"),
        encomenda_id=enc_c.get("id"),
        encomenda_numero=enc_c.get("numero"),
        referencia_cliente=enc_c.get("referencia_cliente") or "",
        data=now_iso()[:10],
        linhas=linhas,
        subtotal=subtotal,
        desconto_total=desconto_total,
        iva_taxa=iva["iva_taxa"],
        iva_valor=iva["iva_valor"],
        total=total,
        valor_pago=valor_pago if tipo == "fatura_recibo" else 0.0,
        metodo_pagamento=metodo_pagamento if tipo == "fatura_recibo" else "",
        notas=notas or "",
        estado="emitida",
    )
    doc.numero = await next_codigo(NUMERACAO_POR_TIPO[tipo])
    return doc.model_dump()


async def emitir_from_encomenda(
    eid: str,
    tipo: str,
    user: dict,
    *,
    metodo_pagamento: str = "transferencia",
    notas: str = "",
    valor: Optional[float] = None,  # noqa: ARG001
    linhas: Optional[List[LinhaParcialInput]] = None,
    adiantamento: bool = False,
) -> dict:
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    if tipo != "proforma":
        from app.services import workflow
        workflow.assert_nao_bloqueada(enc, "faturar")

    enc_c = await compute_encomenda(enc)
    notas_finais = notas or ""
    if (
        adiantamento
        and tipo in TIPOS_CONSUMAM_QTD
        and enc_c.get("estado") != "concluida"
    ):
        if "adiantamento" not in notas_finais.lower():
            notas_finais = f"Adiantamento. {notas_finais}".strip() if notas_finais else "Adiantamento"

    doc = await build_doc_from_encomenda(
        enc_c, tipo,
        metodo_pagamento=metodo_pagamento,
        notas=notas_finais,
        linhas_parcial=linhas,
        adiantamento=adiantamento,
    )
    from app.services import faturacao as fat
    if tipo in fat.TIPOS_CERTIFICADOS and await fat.config_ativa():
        # Programa certificado: o documento nasce em rascunho e é emitido lá (número oficial + ATCUD)
        doc.update({"numero": "", "estado": "rascunho", "valor_pago": 0})
        await documentos_financeiros_repo.insert(doc)
        label = DOC_TIPO_PT.get(tipo, tipo)
        await audit.registar(
            "documento_financeiro", doc["id"], "criado", user,
            f"{label} em rascunho a partir da encomenda {enc.get('numero')}", enc.get("numero"),
        )
        try:
            return await assinar_documento(doc["id"], user)
        except HTTPException as ex:
            out = await enrich_documento(await documentos_financeiros_repo.get(doc["id"]) or doc)
            out["aviso_faturacao"] = (f"{ex.detail if isinstance(ex.detail, str) else 'Erro no programa de faturação'}"
                                      " — o documento ficou em rascunho; corrija e carregue em «Assinar».")
            return out

    await documentos_financeiros_repo.insert(doc)

    if tipo == "fatura_recibo" and (doc.get("valor_pago") or 0) > 0:
        await _criar_recibo_na_fatura(
            doc,
            valor=doc["valor_pago"],
            metodo_pagamento=metodo_pagamento or "transferencia",
            notas=notas or "Liquidação na emissão da fatura-recibo",
            user=user,
            registar_encomenda=True,
        )

    label = DOC_TIPO_PT.get(tipo, tipo)
    await audit.registar(
        "documento_financeiro", doc["id"], "criado", user,
        f"{label} {doc['numero']} emitida a partir da encomenda {enc.get('numero')}",
        doc["numero"],
    )
    await audit.registar(
        "encomenda", eid, "convertido", user,
        f"Encomenda {enc.get('numero')} → {label} {doc['numero']}",
        enc.get("numero"),
    )
    return await enrich_documento(doc)


async def _criar_recibo_na_fatura(
    fatura: dict,
    *,
    valor: float,
    metodo_pagamento: str,
    notas: str,
    user: dict,
    registar_encomenda: bool = True,
) -> dict:
    valor = round2(valor)
    if valor <= 0:
        raise HTTPException(400, "O valor do recibo deve ser positivo")
    if fatura.get("estado") == "anulada":
        raise HTTPException(400, "Não é possível emitir recibo de uma fatura anulada")
    if fatura.get("tipo") not in DOC_TIPOS_COM_RECIBOS:
        raise HTTPException(400, "Só é possível emitir recibos a partir de faturas ou faturas-recibo")

    enriched = await enrich_documento(fatura)
    pendente = float(enriched.get("valor_pendente") or 0)
    if not enriched.get("recibos"):
        pendente = round2(fatura.get("total") or 0)

    if valor > pendente + 0.009:
        raise HTTPException(400, f"Valor excede o pendente da fatura ({pendente:.2f}€)")

    from app.services import faturacao as fat
    data_recibo = now_iso()[:10]
    bloco_fat = await fat.registar_recebimento(fatura, valor, metodo_pagamento or "transferencia", data_recibo)

    recibo = DocumentoFinanceiro(
        tipo="recibo",
        cliente=fatura.get("cliente") or "",
        cliente_id=fatura.get("cliente_id"),
        encomenda_id=fatura.get("encomenda_id"),
        encomenda_numero=fatura.get("encomenda_numero"),
        fatura_id=fatura.get("id"),
        fatura_numero=fatura.get("numero"),
        data=now_iso()[:10],
        linhas=[],
        subtotal=0,
        desconto_total=0,
        iva_taxa=0,
        iva_valor=0,
        total=valor,
        valor_pago=valor,
        metodo_pagamento=metodo_pagamento or "transferencia",
        notas=notas or "",
        estado="emitida",
        faturacao=bloco_fat or {},
    )
    recibo.data = data_recibo
    recibo.numero = (bloco_fat or {}).get("numero") or await next_codigo("recibo")
    dumped = recibo.model_dump()
    await documentos_financeiros_repo.insert(dumped)

    if registar_encomenda:
        await _registar_pagamento_encomenda(
            fatura.get("encomenda_id"),
            valor,
            metodo_pagamento or "transferencia",
            dumped["numero"],
            dumped.get("data") or now_iso()[:10],
        )

    await audit.registar(
        "documento_financeiro", dumped["id"], "criado", user,
        f"Recibo {dumped['numero']} emitido na fatura {fatura.get('numero')} ({valor:.2f}€)",
        dumped["numero"],
    )
    await audit.registar(
        "documento_financeiro", fatura["id"], "pagamento", user,
        f"Recibo {dumped['numero']} associado à fatura {fatura.get('numero')}",
        fatura.get("numero"),
    )
    return dumped


async def emitir_recibo_from_fatura(
    fatura_id: str,
    user: dict,
    *,
    valor: Optional[float] = None,
    metodo_pagamento: str = "transferencia",
    notas: str = "",
) -> dict:
    fatura = await documentos_financeiros_repo.get(fatura_id)
    if not fatura:
        raise HTTPException(404, "Fatura não encontrada")
    if fatura.get("tipo") not in DOC_TIPOS_COM_RECIBOS:
        raise HTTPException(400, "Só é possível emitir recibos a partir de faturas ou faturas-recibo")

    enriched = await enrich_documento(fatura)
    pendente = float(enriched.get("valor_pendente") or 0)
    if pendente <= 0:
        raise HTTPException(400, "Esta fatura já está totalmente liquidada")

    v = round2(valor) if valor is not None else pendente
    if v <= 0:
        raise HTTPException(400, "Indica um valor positivo")
    if v > pendente + 0.009:
        raise HTTPException(400, f"Valor excede o pendente ({pendente:.2f}€)")

    return await _criar_recibo_na_fatura(
        fatura,
        valor=v,
        metodo_pagamento=metodo_pagamento,
        notas=notas,
        user=user,
        registar_encomenda=True,
    )


# ----------------------------------------------------------------------------
# Pagamentos (ecrã Pagamentos) e documentos em rascunho / assinatura
# ----------------------------------------------------------------------------
TIPOS_DOC_DE_PAGAMENTO = ("fatura_recibo", "fatura")


def documento_assinado(doc: Optional[dict]) -> bool:
    """Assinado = emitido com número; a partir daí não se edita (só anular)."""
    return bool(doc) and doc.get("estado") not in ("rascunho", "anulada")


def _valor_sem_iva(total: float, settings: dict) -> float:
    taxa = 0.0 if (settings or {}).get("iva_isento") else float((settings or {}).get("iva_taxa") or 0)
    return round2(total / (1 + taxa / 100.0)) if taxa else round2(total)


def _totais_documento(linhas: list, desconto_total: float, settings: dict) -> dict:
    subtotal = round2(sum(float(l.get("subtotal") or 0) for l in linhas) - float(desconto_total or 0))
    iva = iva_calc(subtotal, settings)
    return {"subtotal": subtotal, "iva_taxa": iva["iva_taxa"], "iva_valor": iva["iva_valor"],
            "total": iva["total_com_iva"]}


def _linha_valor(descricao: str, valor_sem_iva: float) -> dict:
    return DocumentoLinha(descricao=descricao, quantidade=1, preco_unit=round2(valor_sem_iva),
                          subtotal=round2(valor_sem_iva)).model_dump()


def estado_pagamento_fiscal(pag: dict, docs_by_id: dict) -> dict:
    """Situação fiscal de um pagamento: livre, rascunho de fatura ou já faturado (bloqueado)."""
    if pag.get("tipo") == "devolucao":
        return {"faturado": "na", "bloqueado": False, "motivo": ""}
    if pag.get("origem") == "fatura":
        return {"faturado": "sim", "bloqueado": True,
                "motivo": f"Registado pelo recibo {pag.get('recibo_numero') or ''}".strip()}
    doc = docs_by_id.get(pag.get("documento_id") or "")
    if doc and doc.get("estado") != "anulada":
        if doc.get("estado") == "rascunho":
            return {"faturado": "rascunho", "bloqueado": False, "motivo": "Fatura em rascunho"}
        return {"faturado": "sim", "bloqueado": True,
                "motivo": f"Faturado em {doc.get('numero')} (assinado)"}
    return {"faturado": "nao", "bloqueado": False, "motivo": ""}


async def criar_documento_de_pagamento(
    eid: str, pid: str, user: dict, *, tipo: str = "fatura_recibo", notas: str = "", assinar: bool = False,
) -> dict:
    """Fatura(-recibo) a partir de um pagamento já registado. Fica em rascunho até ser assinada."""
    if tipo not in TIPOS_DOC_DE_PAGAMENTO:
        raise HTTPException(400, "Escolha fatura-recibo ou fatura")
    enc = await encomendas_repo.get(eid)
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    pag = next((p for p in (enc.get("pagamentos") or []) if p.get("id") == pid), None)
    if not pag:
        raise HTTPException(404, "Pagamento não encontrado")
    if pag.get("tipo") == "devolucao":
        raise HTTPException(400, "Uma devolução não se fatura (seria uma nota de crédito)")
    docs = {}
    if pag.get("documento_id"):
        d = await documentos_financeiros_repo.get(pag["documento_id"])
        if d:
            docs[d["id"]] = d
    est = estado_pagamento_fiscal(pag, docs)
    if est["faturado"] != "nao":
        raise HTTPException(400, f"Este pagamento já tem documento: {est['motivo']}")

    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    valor = round2(pag.get("valor") or 0)
    enc_c = await compute_encomenda(enc)
    ja = await qtd_ja_faturada_por_linha(eid)
    total_enc = round2(enc_c.get("total_com_iva") or 0)
    linhas: list = []
    desconto_total = 0.0
    if not any(v > 0.009 for v in ja.values()) and total_enc and abs(valor - total_enc) <= 0.02:
        # O pagamento liquida a encomenda toda → fatura com os artigos
        linhas = [_linha_from_artigo(a) for a in (enc_c.get("artigos") or [])]
        from app.services.costing import encomenda_artigos_breakdown
        bd = encomenda_artigos_breakdown(enc_c)
        desconto_total = round2(bd.get("desconto_total_valor") or 0)
        tot = _totais_documento(linhas, desconto_total, settings)
        if abs(tot["total"] - valor) > 0.02:
            linhas, desconto_total = [], 0.0
    if not linhas:
        concluida = enc_c.get("estado") == "concluida"
        descricao = (f"{'Pagamento' if concluida else 'Adiantamento'} referente à encomenda "
                     f"{enc.get('numero') or ''}").strip()
        linhas = [_linha_valor(descricao, _valor_sem_iva(valor, settings))]
    tot = _totais_documento(linhas, desconto_total, settings)
    # Arredondamentos do IVA: o total do documento é o valor recebido
    if abs(tot["total"] - valor) <= 0.02:
        tot["iva_valor"] = round2(valor - tot["subtotal"])
        tot["total"] = valor

    doc = DocumentoFinanceiro(
        tipo=tipo,
        cliente=enc.get("cliente") or "",
        cliente_id=enc.get("cliente_id"),
        encomenda_id=eid,
        encomenda_numero=enc.get("numero"),
        referencia_cliente=enc.get("referencia_cliente") or "",
        data=pag.get("data") or now_iso()[:10],
        linhas=linhas,
        desconto_total=desconto_total,
        metodo_pagamento=pag.get("metodo") or "transferencia",
        notas=notas or "",
        estado="rascunho",
        pagamento_id=pid,
        **tot,
    ).model_dump()
    await documentos_financeiros_repo.insert(doc)
    await _ligar_pagamento(eid, pid, doc)
    label = DOC_TIPO_PT.get(tipo, tipo)
    await audit.registar(
        "documento_financeiro", doc["id"], "criado", user,
        f"{label} em rascunho a partir do pagamento {pag.get('recibo_numero') or ''} ({valor:.2f}€) "
        f"da encomenda {enc.get('numero')}",
        enc.get("numero"),
    )
    if assinar:
        try:
            return await assinar_documento(doc["id"], user)
        except HTTPException as ex:
            # O rascunho fica criado (e ligado ao pagamento): devolve-o com o motivo, para corrigir e voltar a assinar
            out = await enrich_documento(await documentos_financeiros_repo.get(doc["id"]) or doc)
            out["aviso_faturacao"] = (f"{ex.detail if isinstance(ex.detail, str) else 'Não foi possível assinar'}"
                                      " — o documento ficou em rascunho.")
            return out
    return await enrich_documento(doc)


async def _ligar_pagamento(eid: Optional[str], pid: Optional[str], doc: Optional[dict]) -> None:
    """Liga (doc) ou desliga (doc=None) um pagamento da encomenda a um documento fiscal."""
    if not eid or not pid:
        return
    enc = await encomendas_repo.get(eid)
    if not enc:
        return
    pagamentos = []
    for p in enc.get("pagamentos") or []:
        if p.get("id") == pid:
            p = {**p,
                 "documento_id": doc.get("id") if doc else None,
                 "documento_numero": (doc.get("numero") or "") if doc else "",
                 "documento_tipo": (doc.get("tipo") or "") if doc else ""}
        pagamentos.append(p)
    await encomendas_repo.update(eid, {"pagamentos": pagamentos})


async def desligar_pagamento_do_documento(doc: dict) -> None:
    """Documento anulado/apagado: o pagamento volta a poder ser faturado."""
    if doc and doc.get("pagamento_id"):
        await _ligar_pagamento(doc.get("encomenda_id"), doc.get("pagamento_id"), None)


async def editar_rascunho(did: str, dados: dict, user: dict) -> dict:
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if doc.get("estado") != "rascunho":
        raise HTTPException(409, "Documento assinado — já não pode ser editado. Para corrigir, anule-o e emita outro.")
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    patch: dict = {}
    for k in ("data", "notas", "referencia_cliente", "metodo_pagamento"):
        if k in dados and dados[k] is not None:
            patch[k] = (dados[k] or "").strip() if isinstance(dados[k], str) else dados[k]
    if dados.get("linhas") is not None:
        linhas = []
        originais = {i: l for i, l in enumerate(doc.get("linhas") or [])}
        for i, l in enumerate(dados["linhas"]):
            desc = (l.get("descricao") or "").strip()
            if not desc:
                raise HTTPException(400, f"Linha {i + 1}: descrição obrigatória")
            qtd = round2(float(l.get("quantidade") or 0))
            pu = round2(float(l.get("preco_unit") or 0))
            if qtd <= 0:
                raise HTTPException(400, f"Linha {i + 1}: quantidade tem de ser positiva")
            base = originais.get(l.get("_indice")) if isinstance(l.get("_indice"), int) else None
            linha = {**(base or {}), "descricao": desc, "quantidade": qtd, "preco_unit": pu,
                     "desconto": 0.0, "desconto_tipo": "pct", "personalizacoes": [],
                     "subtotal": round2(qtd * pu)}
            linha.pop("_indice", None)
            linhas.append(DocumentoLinha(**linha).model_dump())
        if not linhas:
            raise HTTPException(400, "O documento precisa de pelo menos uma linha")
        patch["linhas"] = linhas
        patch.update(_totais_documento(linhas, doc.get("desconto_total") or 0, settings))
    if not patch:
        return await enrich_documento(doc)
    await documentos_financeiros_repo.update(did, patch)
    doc = {**doc, **patch}
    await audit.registar("documento_financeiro", did, "editado", user,
                         f"Rascunho de {DOC_TIPO_PT.get(doc.get('tipo'), doc.get('tipo'))} editado",
                         doc.get("encomenda_numero") or "")
    return await enrich_documento(doc)


def _hash_documento(doc: dict, anterior: str) -> str:
    base = ";".join([
        str(doc.get("data") or ""), str(doc.get("assinado_at") or ""), str(doc.get("numero") or ""),
        f"{float(doc.get('total') or 0):.2f}", anterior or "",
    ])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


async def assinar_documento(did: str, user: dict) -> dict:
    """Atribui número e assina (hash encadeado). A partir daqui o documento não se edita."""
    doc = await documentos_financeiros_repo.get(did)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if doc.get("estado") != "rascunho":
        raise HTTPException(409, "Este documento já está assinado")
    if not doc.get("linhas"):
        raise HTTPException(400, "O documento não tem linhas")
    pag = None
    if doc.get("pagamento_id"):
        enc = await encomendas_repo.get(doc.get("encomenda_id") or "")
        pag = next((p for p in ((enc or {}).get("pagamentos") or []) if p.get("id") == doc["pagamento_id"]), None)
        if not pag:
            raise HTTPException(400, "O pagamento de origem já não existe — elimine este rascunho")
        if abs(round2(pag.get("valor") or 0) - round2(doc.get("total") or 0)) > 0.01:
            raise HTTPException(
                400,
                f"O total do documento ({float(doc.get('total') or 0):.2f}€) tem de ser igual ao "
                f"pagamento ({float(pag.get('valor') or 0):.2f}€). Acerte as linhas ou o pagamento.",
            )
    from app.services import faturacao as fat
    ts = now_iso()
    assinado_por = (user or {}).get("nome") or (user or {}).get("email") or ""
    cfg_fat = await fat.config_ativa() if doc["tipo"] in fat.TIPOS_CERTIFICADOS else None
    if cfg_fat:
        # Emitido no programa certificado: número oficial, ATCUD e PDF vêm de lá
        cliente = (await clientes_repo.get(doc["cliente_id"]) if doc.get("cliente_id") else None) or {"nome": doc.get("cliente") or ""}
        bloco = await fat.emitir_documento(doc, cliente)
        numero = bloco.get("numero") or bloco.get("externo_id")
        patch = {"numero": numero, "estado": "emitida", "assinado_at": ts, "assinado_por": assinado_por,
                 "hash_anterior": "", "hash": bloco.get("hash_curto") or "", "faturacao": bloco}
        if doc["tipo"] == "fatura_recibo":
            patch["valor_pago"] = round2(doc.get("total") or 0)
        doc = {**doc, **patch}
        await documentos_financeiros_repo.update(did, patch)
    else:
        numero = await next_codigo(NUMERACAO_POR_TIPO[doc["tipo"]])
        ultimo = await documentos_financeiros_repo.find(
            {"hash": {"$ne": ""}, "tipo": doc["tipo"], "faturacao.externo_id": {"$exists": False}},
            sort=("assinado_at", -1), limit=1,
        )
        anterior = (ultimo[0].get("hash") if ultimo else "") or ""
        patch = {
            "numero": numero,
            "estado": "emitida",
            "assinado_at": ts,
            "assinado_por": assinado_por,
            "hash_anterior": anterior,
        }
        if doc["tipo"] == "fatura_recibo":
            patch["valor_pago"] = round2(doc.get("total") or 0)
        doc = {**doc, **patch}
        doc["hash"] = _hash_documento(doc, anterior)
        await documentos_financeiros_repo.update(did, {**patch, "hash": doc["hash"]})
    if pag:
        await _ligar_pagamento(doc.get("encomenda_id"), pag["id"], doc)
        if doc["tipo"] == "fatura":
            # O dinheiro já entrou: recibo associado à fatura, sem duplicar o pagamento na encomenda
            await _criar_recibo_na_fatura(
                doc, valor=round2(pag.get("valor") or 0),
                metodo_pagamento=pag.get("metodo") or "transferencia",
                notas=f"Pagamento {pag.get('recibo_numero') or ''}".strip(),
                user=user, registar_encomenda=False,
            )
    elif doc["tipo"] == "fatura_recibo" and doc.get("encomenda_id"):
        # Fatura-recibo emitida a partir da encomenda: regista o recebimento (recibo interno de controlo)
        await _criar_recibo_na_fatura(
            doc, valor=round2(doc.get("total") or 0),
            metodo_pagamento=doc.get("metodo_pagamento") or "transferencia",
            notas="Liquidação na emissão da fatura-recibo", user=user, registar_encomenda=True,
        )
    label = DOC_TIPO_PT.get(doc["tipo"], doc["tipo"])
    onde = f" no {doc['faturacao'].get('fornecedor_nome')}" if (doc.get("faturacao") or {}).get("estado") == "emitido" else ""
    await audit.registar("documento_financeiro", did, "estado_alterado", user,
                         f"{label} {numero} assinada{onde}", numero)
    return await enrich_documento(doc)
