"""Link do cliente (portal): ver o orçamento/encomenda, aceitar ou rejeitar, aprovar maquetas e pagar online.

Cada link é um token aleatório (sem login) ligado a um orçamento ou encomenda, com validade.
"""
from __future__ import annotations

import os
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
                "resposta": {k: v for k, v in (o.get("resposta_cliente") or {}).items() if k not in ("ip", "assinatura")} or None,
                "encomenda_id": o.get("encomenda_id"), "condicoes": await condicoes_orcamento(o),
                "expirado": (o.get("validade") or "9999") < now_iso()[:10]}
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


def url_publico(token: str) -> str:
    base = (os.environ.get("FRONTEND_URL") or os.environ.get("APP_URL") or "").rstrip("/")
    return f"{base}/p/{token}" if base else f"/p/{token}"


async def condicoes_orcamento(o: dict) -> list:
    """Condições mostradas antes de aceitar (as mesmas do PDF de proposta)."""
    from app.repositories import pdf_templates_repo
    from app.services.pdf import fmt_data
    from app.services.pdf_proposta import DEFAULT_TEXTOS, _linhas
    t = await pdf_templates_repo.find_one({"modulo": "orcamento", "padrao": True}) or {}
    txt = ((t.get("textos") or {}).get("condicoes") or "").strip() or DEFAULT_TEXTOS["condicoes"]
    subs = {"validade": fmt_data(o.get("validade")) or "—", "cliente": o.get("cliente") or "", "numero": o.get("numero") or ""}
    out = []
    for x in _linhas(txt):
        try:
            out.append(x.format(**{**subs, "data": "", "total": "", "descricao": "", "empresa": "", "descricao_ou_trabalho": ""}))
        except (KeyError, IndexError, ValueError):
            out.append(x)
    return out


def _assinatura_valida(a: str) -> str:
    a = (a or "").strip()
    if not a:
        return ""
    if not a.startswith("data:image/png;base64,") or len(a) > 300_000:
        raise HTTPException(400, "Assinatura inválida")
    return a


async def _email_aceitacao(o: dict, enc: Optional[dict], link_enc: Optional[dict]):
    """Confirmação ao cliente (se houver email e SMTP): orçamento aceite e link para acompanhar/pagar."""
    import asyncio
    from app.services import email as email_svc
    from app.services.email_templates import text_to_html_fragments
    from app.services.pdf import fetch_cliente
    cliente = await fetch_cliente(o.get("cliente_id")) or {}
    to = (o.get("contacto_email") or cliente.get("email") or "").strip()
    if not to or "@" not in to or not email_svc.smtp_configured():
        return False
    emp = await _empresa()
    nome = (o.get("contacto_nome") or cliente.get("nome") or o.get("cliente") or "").strip() or "Cliente"
    corpo = f"Olá {nome},\n\nObrigado! Recebemos a aceitação do orçamento {o.get('numero')}.\n\n"
    if enc and link_enc:
        corpo += (f"Criámos a encomenda {enc.get('numero')}. Pode acompanhá-la, aprovar as maquetas e fazer o pagamento aqui:\n"
                  f"{url_publico(link_enc['token'])}\n\nA produção começa depois do pagamento.\n\n")
    else:
        corpo += "Vamos avançar e entramos em contacto consigo em breve.\n\n"
    corpo += f"— {emp.get('nome') or 'Fam’Art'}\n"
    html = email_svc._branded_html(text_to_html_fragments(corpo))
    ok, _r = await asyncio.to_thread(email_svc.send_email, to, f"Orçamento {o.get('numero')} aceite", corpo, html=html)
    return ok


async def responder_orcamento(token: str, aceitar: bool, nome: str, comentario: str, ip: str = "",
                              assinatura: str = "", aceito_condicoes: bool = False) -> dict:
    """Resposta do cliente. Ao aceitar (nome + assinatura + condições): o orçamento passa a Ganho, a encomenda é criada
    automaticamente e o cliente segue para o link da encomenda (maquetas e pagamento)."""
    l = await _link(token)
    if l["tipo"] != "orcamento":
        raise HTTPException(400, "Este link não é de um orçamento")
    o = await orcamentos_repo.get(l["entidade_id"])
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    if o.get("encomenda_id") or o.get("resposta_cliente") or o.get("status") in ("aceite", "rejeitado", "ganho", "perdido"):
        raise HTTPException(409, "Este orçamento já tem resposta. Se precisar de alterar, contacte-nos.")
    if (o.get("validade") or "9999") < now_iso()[:10] and aceitar:
        raise HTTPException(400, "Este orçamento já passou a validade. Peça-nos uma atualização.")
    assinatura = _assinatura_valida(assinatura)
    if aceitar:
        if not (nome or "").strip():
            raise HTTPException(400, "Indique o seu nome para aceitar")
        if not assinatura:
            raise HTTPException(400, "Assine no quadro para aceitar")
        if not aceito_condicoes:
            raise HTTPException(400, "Confirme que leu e aceita as condições")
    resposta = {"aceite": aceitar, "nome": (nome or "").strip()[:120], "comentario": (comentario or "").strip()[:2000],
                "at": now_iso(), "ip": ip, "assinatura": assinatura if aceitar else "", "condicoes_aceites": bool(aceito_condicoes)}
    novo_estado = "ganho" if aceitar else "perdido"
    upd = {"status": novo_estado, "resposta_cliente": resposta}
    if not aceitar and resposta["comentario"]:
        upd["motivo_perda"] = resposta["comentario"][:300]
    await orcamentos_repo.update(o["id"], upd)
    txt = f"Orçamento {o.get('numero')} {'aceite e assinado' if aceitar else 'recusado'} pelo cliente no link" + \
        (f" ({resposta['nome']})" if resposta["nome"] else "") + (f": {resposta['comentario']}" if resposta["comentario"] else "")
    await audit.registar("orcamento", o["id"], "estado_alterado", SISTEMA, txt, o.get("numero"))

    enc, link_enc, erro_enc = None, None, ""
    if aceitar:
        try:
            from app.api.routes.orcamentos import converter_orcamento
            enc = await converter_orcamento(o["id"], {**SISTEMA, "role": "admin"})
            link_enc = await criar_link("encomenda", enc["id"], SISTEMA)
            txt += f" · encomenda {enc.get('numero')} criada automaticamente"
        except HTTPException as e:
            erro_enc = str(e.detail)
            txt += f" · a encomenda não foi criada automaticamente ({erro_enc})"
        except Exception as e:  # noqa: BLE001 — a aceitação fica registada mesmo que a conversão falhe
            erro_enc = str(e)[:200]
        try:
            await _email_aceitacao({**o, **upd}, enc, link_enc)
        except Exception:  # noqa: BLE001
            pass
    await workflow.evento("orcamento_aceite" if aceitar else "portal_cliente", txt, o.get("cliente") or "",
                          link=f"/orcamentos/{o['id']}", entidade="orcamento", entidade_id=o["id"])
    return {"ok": True, "encomenda_numero": (enc or {}).get("numero"), "encomenda_token": (link_enc or {}).get("token"),
            "aviso": "Vamos confirmar os detalhes e enviar-lhe o link para pagamento." if aceitar and not link_enc else ""}


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
    settings, fields, branding = await load_pdf_config(None, "orcamento")
    return build_orcamento_pdf(o, settings, fields, branding, await fetch_cliente(o.get("cliente_id"))), o.get("numero") or "orcamento"
