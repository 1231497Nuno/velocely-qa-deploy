"""Link do cliente (portal): ver o orçamento/encomenda, aceitar ou rejeitar, aprovar maquetas e pagar online.

Cada link é um token aleatório (sem login) ligado a um orçamento ou encomenda, com validade.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import empresa_repo, encomendas_repo, orcamentos_repo, portal_links_repo
from app.services import audit
from app.services import workflow

VALIDADE_DIAS = 120
SISTEMA = {"id": "portal", "name": "Cliente (link)"}


async def criar_link(tipo: str, entidade_id: str, user: dict) -> dict:
    if tipo not in ("orcamento", "encomenda"):
        raise HTTPException(400, "Tipo inválido")
    repo = orcamentos_repo if tipo == "orcamento" else encomendas_repo
    doc = await repo.get(entidade_id)
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    if tipo == "orcamento" and not doc.get("numero"):
        raise HTTPException(400, "Finalize o orçamento antes de partilhar")
    agora = datetime.now(timezone.utc)
    ja = await portal_links_repo.find_one({"tipo": tipo, "entidade_id": entidade_id, "ativo": True})
    if ja and (ja.get("expira") or "") > agora.isoformat():
        return ja
    link = {"id": new_id(), "token": secrets.token_urlsafe(24), "tipo": tipo, "entidade_id": entidade_id, "ativo": True,
            "expira": (agora + timedelta(days=VALIDADE_DIAS)).isoformat(), "criado_por": user.get("id"), "created_at": now_iso(),
            "visto_at": None}
    await portal_links_repo.insert(link)
    return link


async def _link(token: str) -> dict:
    l = await portal_links_repo.find_one({"token": token})
    if not l or not l.get("ativo") or (l.get("expira") or "") < datetime.now(timezone.utc).isoformat():
        raise HTTPException(404, "Este link não existe ou já expirou. Peça um novo à Fam'Art.")
    return l


async def _empresa() -> dict:
    e = await empresa_repo.get("empresa") or {}
    return {k: e.get(k) for k in ("nome", "email", "telefone", "contacto", "morada", "cidade", "website", "iban")}


def _linhas_publicas(linhas: list) -> list:
    out = []
    for l in linhas or []:
        out.append({"id": l.get("id"), "descricao": l.get("artigo_nome") or l.get("descricao") or "", "quantidade": l.get("quantidade"),
                    "preco_unit": l.get("preco_unit"), "total": l.get("total") or l.get("valor_total") or
                    round2(float(l.get("quantidade") or 0) * float(l.get("preco_unit") or 0)),
                    "observacoes": l.get("observacoes") or "", "tem_arte": bool(l.get("arte_path")),
                    "arte_nome": l.get("arte_nome") or "", "arte_aprovacao": l.get("arte_aprovacao")})
    return out


async def ver(token: str) -> dict:
    from app.services.costing import compute_encomenda, compute_orcamento_totais
    l = await _link(token)
    if not l.get("visto_at"):
        await portal_links_repo.update(l["id"], {"visto_at": now_iso()})
    base = {"tipo": l["tipo"], "empresa": await _empresa(), "expira": l["expira"]}
    if l["tipo"] == "orcamento":
        o = await orcamentos_repo.get(l["entidade_id"])
        if not o:
            raise HTTPException(404, "Orçamento não encontrado")
        o = compute_orcamento_totais(o)
        return {**base, "numero": o.get("numero"), "cliente": o.get("cliente"), "descricao": o.get("descricao"),
                "data": o.get("data"), "validade": o.get("validade"), "estado": o.get("status"),
                "linhas": _linhas_publicas(o.get("linhas")), "total": o.get("total_com_iva") or o.get("total"),
                "resposta": o.get("resposta_cliente"), "encomenda_id": o.get("encomenda_id")}
    e = await encomendas_repo.get(l["entidade_id"])
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    c = await compute_encomenda(dict(e))
    from app.repositories import pagamentos_online_repo
    from app.services import pagamentos_online
    cfg = await pagamentos_online.get_config()
    refs = await pagamentos_online_repo.find({"encomenda_id": e["id"], "estado": "pendente"}, sort=("created_at", -1), limit=5)
    return {**base, "numero": e.get("numero"), "cliente": e.get("cliente"), "descricao": e.get("descricao"), "data": e.get("data"),
            "prazo_entrega": e.get("prazo_entrega"), "estado": e.get("estado"), "entregue": bool(e.get("entregue")),
            "linhas": _linhas_publicas(e.get("artigos")), "total": c.get("total_com_iva") or c.get("valor_total"),
            "pago": c.get("valor_pago"), "pendente": c.get("valor_pendente"),
            "pagamento_online": cfg.get("ativo") and float(c.get("valor_pendente") or 0) > 0,
            "metodos": cfg.get("metodos") if cfg.get("ativo") else [],
            "referencias": [{k: r.get(k) for k in ("metodo", "entidade", "referencia", "valor", "expira", "created_at")} for r in refs]}


async def responder_orcamento(token: str, aceitar: bool, nome: str, comentario: str, ip: str = "") -> dict:
    l = await _link(token)
    if l["tipo"] != "orcamento":
        raise HTTPException(400, "Este link não é de um orçamento")
    o = await orcamentos_repo.get(l["entidade_id"])
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    if o.get("encomenda_id") or o.get("status") in ("aceite", "rejeitado"):
        raise HTTPException(409, "Este orçamento já tem resposta. Se precisar de alterar, contacte-nos.")
    if aceitar and not (nome or "").strip():
        raise HTTPException(400, "Indique o seu nome para aceitar")
    resposta = {"aceite": aceitar, "nome": (nome or "").strip()[:120], "comentario": (comentario or "").strip()[:2000],
                "at": now_iso(), "ip": ip}
    await orcamentos_repo.update(o["id"], {"status": "aceite" if aceitar else "rejeitado", "resposta_cliente": resposta})
    txt = f"Orçamento {o.get('numero')} {'aceite' if aceitar else 'rejeitado'} pelo cliente no link" + \
        (f" ({resposta['nome']})" if resposta["nome"] else "") + (f": {resposta['comentario']}" if resposta["comentario"] else "")
    await audit.registar("orcamento", o["id"], "estado_alterado", SISTEMA, txt, o.get("numero"))
    await workflow.evento("orcamento_aceite" if aceitar else "portal_cliente", txt, o.get("cliente") or "",
                          link=f"/orcamentos/{o['id']}", entidade="orcamento", entidade_id=o["id"])
    return {"ok": True}


async def decidir_arte(token: str, linha_id: str, aprovada: bool, comentario: str) -> dict:
    l = await _link(token)
    repo = orcamentos_repo if l["tipo"] == "orcamento" else encomendas_repo
    campo = "linhas" if l["tipo"] == "orcamento" else "artigos"
    doc = await repo.get(l["entidade_id"])
    if not doc:
        raise HTTPException(404, "Documento não encontrado")
    linhas = doc.get(campo) or []
    linha = next((x for x in linhas if x.get("id") == linha_id), None)
    if not linha or not linha.get("arte_path"):
        raise HTTPException(404, "Maqueta não encontrada")
    if not aprovada and not (comentario or "").strip():
        raise HTTPException(400, "Diga-nos o que quer alterar na maqueta")
    linha["arte_aprovacao"] = {"aprovada": aprovada, "comentario": (comentario or "").strip()[:2000], "at": now_iso(),
                               "arte_nome": linha.get("arte_nome")}
    await repo.update(doc["id"], {campo: linhas})
    numero = doc.get("numero")
    txt = f"Maqueta de «{linha.get('artigo_nome')}» {'aprovada' if aprovada else 'com pedido de alteração'} ({numero})" + \
        (f": {comentario.strip()}" if comentario and comentario.strip() else "")
    await audit.registar(l["tipo"], doc["id"], "editado", SISTEMA, txt, numero)
    await workflow.evento("portal_cliente", txt, doc.get("cliente") or "",
                          link=f"/{'orcamentos' if l['tipo'] == 'orcamento' else 'encomendas'}/{doc['id']}",
                          entidade=l["tipo"], entidade_id=doc["id"])
    return {"ok": True}


async def arte(token: str, linha_id: str):
    from app.services import storage
    import asyncio
    l = await _link(token)
    repo = orcamentos_repo if l["tipo"] == "orcamento" else encomendas_repo
    doc = await repo.get(l["entidade_id"]) or {}
    linha = next((x for x in doc.get("linhas" if l["tipo"] == "orcamento" else "artigos") or [] if x.get("id") == linha_id), None)
    if not linha or not linha.get("arte_path"):
        raise HTTPException(404, "Maqueta não encontrada")
    dados, ct = await asyncio.to_thread(storage.get_object, linha["arte_path"])
    return dados, linha.get("arte_content_type") or ct, linha.get("arte_nome") or "maqueta"


async def pagar(token: str, metodo: str, telemovel: str) -> dict:
    from app.services import pagamentos_online
    l = await _link(token)
    if l["tipo"] != "encomenda":
        raise HTTPException(400, "Pagamento só disponível no link da encomenda")
    p = await pagamentos_online.pedir(l["entidade_id"], metodo, telemovel)
    return {k: p.get(k) for k in ("metodo", "entidade", "referencia", "valor", "expira", "estado")}


async def pdf(token: str) -> tuple:
    """PDF do orçamento (o mesmo que é enviado por email)."""
    from app.services.costing import compute_orcamento_totais
    from app.services.pdf import build_orcamento_pdf, fetch_cliente, load_pdf_config
    l = await _link(token)
    if l["tipo"] != "orcamento":
        raise HTTPException(404, "Sem PDF")
    o = compute_orcamento_totais(await orcamentos_repo.get(l["entidade_id"]) or {})
    settings, fields, branding = await load_pdf_config(None)
    return build_orcamento_pdf(o, settings, fields, branding, await fetch_cliente(o.get("cliente_id"))), o.get("numero") or "orcamento"
