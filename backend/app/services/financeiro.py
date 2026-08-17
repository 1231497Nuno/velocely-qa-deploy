"""Serviço de faturas (fatura, proforma, recibo, fatura-recibo)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

from app.core.database import now_iso, round2
from app.domain.models import (
    DOC_TIPOS_PRINCIPAIS, DOC_TIPOS_COM_RECIBOS, DOC_TIPO_PT,
    DocumentoFinanceiro, DocumentoLinha, Pagamento,
)
from app.repositories import documentos_financeiros_repo, encomendas_repo, empresa_repo
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
    "transferencia": "Transferência bancária", "numerario": "Numerário", "mbway": "MB WAY",
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
    pagamentos = (enc.get("pagamentos") or []) + [pag.model_dump()]
    total_pago = soma_valor_pago(pagamentos)
    await encomendas_repo.update(enc_id, {"pagamentos": pagamentos, "valor_pago": total_pago})


async def qtd_ja_faturada_por_linha(encomenda_id: str) -> dict:
    """Soma quantidades já incluídas em faturas / faturas-recibo (não anuladas)."""
    docs = await documentos_financeiros_repo.find(
        {
            "encomenda_id": encomenda_id,
            "tipo": {"$in": list(TIPOS_CONSUMAM_QTD)},
            "estado": {"$ne": "anulada"},
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
    )
    recibo.numero = await next_codigo("recibo")
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
