"""Aprovações, alertas e caixa de tarefas (inspirado no Monitor de Workflow do Sage X3).

- Aprovações: regras configuráveis (desconto/margem/valor do orçamento, valor da ordem de compra).
  Quando uma ação ultrapassa a regra, o ERP cria um pedido de aprovação para os aprovadores e
  bloqueia a ação até alguém aprovar. Uma aprovação vale enquanto os valores não piorarem.
- Alertas: eventos (encomenda paga, prazo a chegar, orçamento aceite…) que avisam utilizadores no
  ERP e, se escolhido, por email.
- Tarefas: coleção `tarefas` (pedidos de aprovação + alertas), lida pela página Tarefas e pelo sino.
"""
from __future__ import annotations

import asyncio
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import integracoes_repo, tarefas_repo, users_repo

WORKFLOW_ID = "workflow"

REGRAS_APROVACAO = {
    "orcamento_desconto": {"entidade": "orcamento", "label": "Orçamento com desconto acima de", "unidade": "%", "campo": "desconto_pct",
                           "excede": lambda v, lim: v > lim + 1e-9},
    "orcamento_margem": {"entidade": "orcamento", "label": "Orçamento com margem abaixo de", "unidade": "%", "campo": "margem_pct",
                         "excede": lambda v, lim: v < lim - 1e-9},
    "orcamento_valor": {"entidade": "orcamento", "label": "Orçamento com total acima de", "unidade": "€", "campo": "total",
                        "excede": lambda v, lim: v > lim + 1e-9},
    "ordem_compra_valor": {"entidade": "ordem_compra", "label": "Ordem de compra acima de", "unidade": "€", "campo": "total",
                           "excede": lambda v, lim: v > lim + 1e-9},
}

EVENTOS = {
    "encomenda_criada": {"label": "Encomenda nova (inclui loja online)", "grupo": "Vendas"},
    "encomenda_paga": {"label": "Encomenda totalmente paga (pode entrar em produção)", "grupo": "Vendas"},
    "pagamento_registado": {"label": "Pagamento registado", "grupo": "Pagamentos"},
    "orcamento_aceite": {"label": "Orçamento aceite pelo cliente", "grupo": "Vendas"},
    "portal_cliente": {"label": "Resposta do cliente no link (rejeição, comentário, maqueta)", "grupo": "Vendas"},
    "pagamento_online": {"label": "Pagamento Multibanco / MB WAY recebido", "grupo": "Pagamentos"},
    "manutencao": {"label": "Manutenção de máquina a chegar ou atrasada", "grupo": "Produção"},
    "orcamento_follow_up": {"label": "Orçamento enviado sem resposta / a expirar", "grupo": "Comercial", "dias": True},
    "prazo_proximo": {"label": "Prazo de entrega a chegar (encomenda não concluída)", "grupo": "Produção", "dias": True},
    "encomenda_bloqueada": {"label": "Encomenda bloqueada / desbloqueada", "grupo": "Vendas"},
    "nc_criada": {"label": "Não conformidade registada", "grupo": "Produção"},
    "lead_site": {"label": "Pedido novo do site (CRM)", "grupo": "Comercial"},
    "aprovacao_decidida": {"label": "Pedido de aprovação aprovado/rejeitado (avisa quem pediu)", "grupo": "Aprovações", "fixo": True},
}

DEFAULT = {
    "id": WORKFLOW_ID,
    "aprovacoes": {k: {"ativo": False, "limite": 0.0, "aprovadores": []} for k in REGRAS_APROVACAO},
    "alertas": {k: {"ativo": k in ("encomenda_paga", "aprovacao_decidida", "prazo_proximo", "portal_cliente",
                                   "pagamento_online", "orcamento_follow_up", "manutencao"), "destinatarios": [],
                    "email": False, "dias": 3} for k in EVENTOS},
    "credito_modo": "bloqueio",
    "ultima_verificacao_prazos": 0,
}


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------
async def get_config() -> dict:
    g = await integracoes_repo.get(WORKFLOW_ID) or {}
    cfg = {**DEFAULT, **{k: v for k, v in g.items() if k != "_id"}}
    cfg["aprovacoes"] = {k: {**DEFAULT["aprovacoes"][k], **((g.get("aprovacoes") or {}).get(k) or {})} for k in REGRAS_APROVACAO}
    cfg["alertas"] = {k: {**DEFAULT["alertas"][k], **((g.get("alertas") or {}).get(k) or {})} for k in EVENTOS}
    return cfg


def catalogo() -> dict:
    return {
        "regras": [{"id": k, "label": r["label"], "unidade": r["unidade"], "entidade": r["entidade"]} for k, r in REGRAS_APROVACAO.items()],
        "eventos": [{"id": k, **v} for k, v in EVENTOS.items()],
    }


async def guardar(dados: dict) -> dict:
    cfg = await get_config()
    patch: Dict[str, Any] = {}
    if isinstance(dados.get("aprovacoes"), dict):
        ap = dict(cfg["aprovacoes"])
        for k, v in dados["aprovacoes"].items():
            if k in REGRAS_APROVACAO and isinstance(v, dict):
                ap[k] = {"ativo": bool(v.get("ativo")), "limite": round2(max(0.0, float(v.get("limite") or 0))),
                         "aprovadores": [str(x) for x in (v.get("aprovadores") or []) if x]}
        patch["aprovacoes"] = ap
    if isinstance(dados.get("alertas"), dict):
        al = dict(cfg["alertas"])
        for k, v in dados["alertas"].items():
            if k in EVENTOS and isinstance(v, dict):
                al[k] = {"ativo": bool(v.get("ativo")), "email": bool(v.get("email")),
                         "destinatarios": [str(x) for x in (v.get("destinatarios") or []) if x],
                         "dias": max(1, min(60, int(v.get("dias") or 3)))}
        patch["alertas"] = al
    if dados.get("credito_modo") in ("bloqueio", "aviso"):
        patch["credito_modo"] = dados["credito_modo"]
    await integracoes_repo.update_where({"id": WORKFLOW_ID}, {**patch, "id": WORKFLOW_ID}, upsert=True)
    return await get_config()


# ---------------------------------------------------------------------------
# Utilizadores
# ---------------------------------------------------------------------------
async def _admins() -> List[dict]:
    return [u for u in await users_repo.find({}, limit=500) if u.get("role") == "admin" and u.get("ativo", True) is not False]


async def _utilizadores(ids: List[str]) -> List[dict]:
    if not ids:
        return await _admins()
    return [u for u in await users_repo.find({"id": {"$in": list(ids)}}, limit=500)]


def _nome(u: Optional[dict]) -> str:
    u = u or {}
    return u.get("nome") or u.get("name") or u.get("login") or (u.get("email") or "").split("@")[0]


def _quem(u: Optional[dict]) -> dict:
    return {"id": (u or {}).get("id"), "nome": _nome(u)}


async def _enviar_emails(utilizadores: List[dict], assunto: str, texto: str, link: str = "") -> None:
    from app.services import email as email_svc

    corpo = texto + (f"\n\nAbrir no ERP: {link}" if link else "")
    html = email_svc._branded_html(
        f"<p>{email_svc._esc(texto).replace(chr(10), '<br>')}</p>"
        + (f'<p><a href="{email_svc._esc(link)}">Abrir no ERP</a></p>' if link.startswith("http") else "")
    )
    for u in utilizadores:
        if u.get("email"):
            await asyncio.to_thread(email_svc.send_email, u["email"], assunto, corpo, html=html)


def _url_publica(caminho: str) -> str:
    import os
    base = (os.environ.get("FRONTEND_URL") or os.environ.get("APP_URL") or "").rstrip("/")
    return f"{base}{caminho}" if base else caminho


# ---------------------------------------------------------------------------
# Alertas
# ---------------------------------------------------------------------------
async def evento(nome: str, titulo: str, texto: str = "", *, link: str = "", entidade: str = "", entidade_id: str = "",
                 chave: str = "", para: Optional[List[str]] = None) -> Optional[dict]:
    """Regista um alerta (se o evento estiver ativo). `para` força destinatários (ex.: quem pediu a aprovação)."""
    try:
        cfg = await get_config()
        regra = cfg["alertas"].get(nome) or {}
        if not regra.get("ativo"):
            return None
        if chave and await tarefas_repo.find_one({"chave": chave}):
            return None
        destinatarios = list(para) if para else [u["id"] for u in await _utilizadores(regra.get("destinatarios") or [])]
        if not destinatarios:
            return None
        t = {
            "id": new_id(), "tipo": "alerta", "evento": nome, "titulo": titulo, "texto": texto, "link": link,
            "entidade": entidade, "entidade_id": entidade_id, "destinatarios": destinatarios, "lida_por": [],
            "chave": chave or "", "created_at": now_iso(),
        }
        await tarefas_repo.insert(t)
        if regra.get("email"):
            await _enviar_emails(await _utilizadores(destinatarios), titulo, texto, _url_publica(link))
        return t
    except Exception:  # alertas nunca podem partir a ação principal
        import logging
        logging.getLogger(__name__).exception("Falha ao registar alerta %s", nome)
        return None


async def verificar_prazos(forcar: bool = False) -> int:
    """Gera alertas de prazo a chegar (no máximo uma passagem por hora)."""
    cfg = await get_config()
    regra = cfg["alertas"]["prazo_proximo"]
    agora = time.time()
    if not regra.get("ativo") or (not forcar and agora - float(cfg.get("ultima_verificacao_prazos") or 0) < 3600):
        return 0
    await integracoes_repo.update_where({"id": WORKFLOW_ID}, {"ultima_verificacao_prazos": agora}, upsert=True)
    from app.repositories import encomendas_repo
    hoje = datetime.now(timezone.utc).date()
    limite = (hoje + timedelta(days=int(regra.get("dias") or 3))).isoformat()
    n = 0
    for e in await encomendas_repo.find({"estado": {"$nin": ["concluida", "cancelada"]}, "entregue": {"$ne": True}}, limit=5000):
        prazo = (e.get("prazo_entrega") or "")[:10]
        if not prazo or prazo > limite:
            continue
        atrasada = prazo < hoje.isoformat()
        r = await evento(
            "prazo_proximo",
            f"{'Prazo ultrapassado' if atrasada else 'Prazo a chegar'}: {e.get('numero')} ({e.get('cliente') or ''})",
            f"Prazo de entrega {date.fromisoformat(prazo).strftime('%d/%m/%Y')} e a encomenda ainda não está concluída.",
            link=f"/encomendas/{e['id']}", entidade="encomenda", entidade_id=e["id"],
            chave=f"prazo:{e['id']}:{prazo}:{'atraso' if atrasada else 'aviso'}",
        )
        n += 1 if r else 0
    return n


async def verificar_orcamentos() -> int:
    """Orçamentos enviados sem resposta há X dias ou a expirar em X dias → alerta (uma vez por orçamento)."""
    cfg = await get_config()
    regra = cfg["alertas"].get("orcamento_follow_up") or {}
    if not regra.get("ativo"):
        return 0
    from app.repositories import orcamentos_repo
    dias = int(regra.get("dias") or 3)
    hoje = datetime.now(timezone.utc).date()
    n = 0
    for o in await orcamentos_repo.find({"status": "enviado", "encomenda_id": None}, limit=5000):
        data = (o.get("data") or o.get("created_at") or "")[:10]
        val = (o.get("validade") or "")[:10]
        cli = o.get("cliente") or ""
        if val and hoje.isoformat() <= val <= (hoje + timedelta(days=dias)).isoformat():
            r = await evento("orcamento_follow_up", f"Orçamento a expirar: {o.get('numero')} ({cli})",
                             f"Válido até {date.fromisoformat(val).strftime('%d/%m/%Y')} e ainda sem resposta do cliente.",
                             link=f"/orcamentos/{o['id']}", entidade="orcamento", entidade_id=o["id"], chave=f"orc_expira:{o['id']}")
            n += 1 if r else 0
        elif data and data <= (hoje - timedelta(days=dias)).isoformat():
            r = await evento("orcamento_follow_up", f"Sem resposta: {o.get('numero')} ({cli})",
                             f"Enviado há mais de {dias} dias. Vale a pena contactar o cliente.",
                             link=f"/orcamentos/{o['id']}", entidade="orcamento", entidade_id=o["id"], chave=f"orc_followup:{o['id']}")
            n += 1 if r else 0
    return n


# ---------------------------------------------------------------------------
# Aprovações
# ---------------------------------------------------------------------------
def _regras_violadas(entidade: str, valores: dict, cfg: dict) -> List[dict]:
    out = []
    for k, r in REGRAS_APROVACAO.items():
        regra = cfg["aprovacoes"][k]
        if r["entidade"] != entidade or not regra.get("ativo"):
            continue
        v = valores.get(r["campo"])
        if v is None:
            continue
        if r["excede"](float(v), float(regra.get("limite") or 0)):
            out.append({"regra": k, "label": r["label"], "limite": regra.get("limite"), "unidade": r["unidade"],
                        "valor": round2(float(v)), "aprovadores": regra.get("aprovadores") or []})
    return out


def _cobre(aprovados: dict, atuais: dict) -> bool:
    """A aprovação antiga continua válida se os valores não pioraram."""
    for campo, v in atuais.items():
        a = aprovados.get(campo)
        if a is None or v is None:
            continue
        if campo == "margem_pct":
            if float(v) < float(a) - 0.01:
                return False
        elif float(v) > float(a) + 0.01:
            return False
    return True


def _texto_regras(violadas: List[dict]) -> str:
    return "; ".join(f"{v['label']} {v['limite']:g}{v['unidade']} (está em {v['valor']:g}{v['unidade']})" for v in violadas)


async def estado_aprovacao(entidade: str, entidade_id: str) -> Optional[dict]:
    ts = await tarefas_repo.find({"tipo": "aprovacao", "entidade": entidade, "entidade_id": entidade_id},
                                 sort=("created_at", -1), limit=1)
    return ts[0] if ts else None


async def exigir_aprovacao(entidade: str, entidade_id: str, valores: dict, user: dict, *,
                           titulo: str, link: str, acao: str) -> None:
    """Bloqueia a ação (409) se alguma regra exigir aprovação e ainda não houver uma válida."""
    cfg = await get_config()
    violadas = _regras_violadas(entidade, valores, cfg)
    if not violadas:
        return
    ultima = await estado_aprovacao(entidade, entidade_id)
    if ultima and ultima.get("estado") == "aprovado" and _cobre(ultima.get("valores") or {}, valores):
        return
    if ultima and ultima.get("estado") == "pendente":
        if _cobre(ultima.get("valores") or {}, valores):
            raise HTTPException(409, {"codigo": "aprovacao_pendente", "mensagem": f"Aguarda aprovação: {ultima.get('texto')}",
                                      "tarefa_id": ultima["id"]})
        await tarefas_repo.update(ultima["id"], {"estado": "substituido"})
    aprovadores = sorted({a for v in violadas for a in v["aprovadores"]})
    destinatarios = [u["id"] for u in await _utilizadores(aprovadores)]
    texto = _texto_regras(violadas)
    t = {
        "id": new_id(), "tipo": "aprovacao", "evento": "aprovacao", "estado": "pendente",
        "titulo": f"Aprovar: {titulo}", "texto": texto, "acao": acao, "link": link,
        "entidade": entidade, "entidade_id": entidade_id, "valores": valores,
        "regras": [v["regra"] for v in violadas], "destinatarios": destinatarios, "lida_por": [],
        "pedido_por": _quem(user), "created_at": now_iso(),
    }
    await tarefas_repo.insert(t)
    try:
        await _enviar_emails(await _utilizadores(destinatarios), t["titulo"], f"{_nome(user)} pediu aprovação para {acao}.\n{texto}",
                             _url_publica(link))
    except Exception:
        pass
    # Quem é aprovador e pede, aprova-se a si próprio? Não: fica o pedido para outro (ou para ele, na caixa).
    raise HTTPException(409, {"codigo": "aprovacao_pedida",
                              "mensagem": f"Precisa de aprovação ({texto}). Pedido enviado aos aprovadores.",
                              "tarefa_id": t["id"]})


async def pode_decidir(t: dict, user: dict) -> bool:
    from app.core.security import resolve_perfil
    if user.get("id") in (t.get("destinatarios") or []):
        return True
    return bool((await resolve_perfil(user)).get("admin"))


async def decidir(tid: str, aprovar: bool, motivo: str, user: dict) -> dict:
    t = await tarefas_repo.get(tid)
    if not t or t.get("tipo") != "aprovacao":
        raise HTTPException(404, "Pedido de aprovação não encontrado")
    if t.get("estado") != "pendente":
        raise HTTPException(409, "Este pedido já foi decidido")
    if not await pode_decidir(t, user):
        raise HTTPException(403, "Não é aprovador deste pedido")
    if not aprovar and not (motivo or "").strip():
        raise HTTPException(400, "Indique o motivo da rejeição")
    patch = {"estado": "aprovado" if aprovar else "rejeitado", "decidido_por": _quem(user), "decidido_at": now_iso(),
             "motivo": (motivo or "").strip()}
    await tarefas_repo.update(tid, patch)
    t.update(patch)
    from app.services import audit
    await audit.registar(t.get("entidade") or "tarefa", t.get("entidade_id") or tid, "aprovacao", user,
                         f"{'Aprovado' if aprovar else 'Rejeitado'}: {t.get('titulo', '').replace('Aprovar: ', '')}"
                         + (f" — {patch['motivo']}" if patch["motivo"] else ""), "")
    quem_pediu = (t.get("pedido_por") or {}).get("id")
    if quem_pediu and quem_pediu != user.get("id"):
        await evento("aprovacao_decidida",
                     f"{'Aprovado' if aprovar else 'Rejeitado'}: {t.get('titulo', '').replace('Aprovar: ', '')}",
                     (f"Por {_nome(user)}." + (f" Motivo: {patch['motivo']}" if patch["motivo"] else "")),
                     link=t.get("link") or "", entidade=t.get("entidade") or "", entidade_id=t.get("entidade_id") or "",
                     para=[quem_pediu])
    return t


# ---------------------------------------------------------------------------
# Caixa de tarefas
# ---------------------------------------------------------------------------
def _para_utilizador(t: dict, uid: str) -> dict:
    return {**{k: v for k, v in t.items() if k not in ("_id", "lida_por", "destinatarios")},
            "lida": uid in (t.get("lida_por") or []), "para_mim": uid in (t.get("destinatarios") or [])}


async def listar(user: dict, *, filtro: str = "pendentes", todas: bool = False, limite: int = 200) -> dict:
    await verificar_prazos()
    uid = user.get("id")
    q: Dict[str, Any] = {} if todas else {"destinatarios": uid}
    ts = await tarefas_repo.find(q, sort=("created_at", -1), limit=1000)
    if not todas:
        ts = [t for t in ts if uid in (t.get("destinatarios") or [])]
    if filtro == "pendentes":
        ts = [t for t in ts if (t.get("tipo") == "aprovacao" and t.get("estado") == "pendente")
              or (t.get("tipo") == "alerta" and uid not in (t.get("lida_por") or []))]
    elif filtro == "aprovacoes":
        ts = [t for t in ts if t.get("tipo") == "aprovacao"]
    elif filtro == "alertas":
        ts = [t for t in ts if t.get("tipo") == "alerta"]
    meus_pedidos = []
    if filtro in ("pendentes", "aprovacoes"):
        meus_pedidos = [_para_utilizador(t, uid) for t in await tarefas_repo.find(
            {"tipo": "aprovacao", "pedido_por.id": uid}, sort=("created_at", -1), limit=50)]
    return {"items": [_para_utilizador(t, uid) for t in ts[:limite]], "meus_pedidos": meus_pedidos[:20],
            "contagem": await contagem(user)}


async def contagem(user: dict) -> dict:
    uid = user.get("id")
    ts = [t for t in await tarefas_repo.find({"destinatarios": uid}, limit=2000) if uid in (t.get("destinatarios") or [])]
    aprov = sum(1 for t in ts if t.get("tipo") == "aprovacao" and t.get("estado") == "pendente")
    alertas = sum(1 for t in ts if t.get("tipo") == "alerta" and uid not in (t.get("lida_por") or []))
    return {"aprovacoes": aprov, "alertas": alertas, "total": aprov + alertas}


async def marcar_lida(tid: Optional[str], user: dict) -> None:
    uid = user.get("id")
    alvo = [await tarefas_repo.get(tid)] if tid else await tarefas_repo.find({"tipo": "alerta", "destinatarios": uid}, limit=2000)
    for t in alvo:
        if t and t.get("tipo") == "alerta" and uid not in (t.get("lida_por") or []):
            await tarefas_repo.update(t["id"], {"lida_por": (t.get("lida_por") or []) + [uid]})


# ---------------------------------------------------------------------------
# Atalhos usados pelas rotas
# ---------------------------------------------------------------------------
async def apos_pagamento(eid: str, status_antes: str, valor: float, *, origem: str = "") -> None:
    """Alertas de pagamento registado e de encomenda totalmente paga."""
    try:
        from app.repositories import encomendas_repo
        from app.services.costing import compute_encomenda
        enc = await encomendas_repo.get(eid)
        if not enc:
            return
        c = await compute_encomenda(enc)
        await evento("pagamento_registado", f"Pagamento de {valor:.2f} € — {c.get('numero')} ({c.get('cliente') or ''})",
                     f"{origem or 'Registado no ERP'}. Pago {float(c.get('valor_pago') or 0):.2f} € de {float(c.get('total_com_iva') or 0):.2f} €.",
                     link=f"/encomendas/{eid}?tab=pagamentos", entidade="encomenda", entidade_id=eid)
        if c.get("status_pagamento") == "pago" and status_antes != "pago":
            await evento("encomenda_paga", f"Encomenda paga: {c.get('numero')} ({c.get('cliente') or ''})",
                         "A encomenda está totalmente paga e pode entrar em produção.",
                         link=f"/encomendas/{eid}?tab=producao", entidade="encomenda", entidade_id=eid,
                         chave=f"paga:{eid}:{len(enc.get('pagamentos') or [])}")
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Falha nos alertas de pagamento")


async def status_pagamento(eid: str) -> str:
    from app.repositories import encomendas_repo
    from app.services.costing import compute_encomenda
    enc = await encomendas_repo.get(eid)
    return (await compute_encomenda(enc)).get("status_pagamento") if enc else ""


async def encomenda_criada(enc: dict, origem: str = "") -> None:
    await evento("encomenda_criada", f"Encomenda nova: {enc.get('numero')} ({enc.get('cliente') or ''})",
                 origem or "Criada no ERP.", link=f"/encomendas/{enc.get('id')}", entidade="encomenda",
                 entidade_id=enc.get("id") or "", chave=f"enc_criada:{enc.get('id')}")


def valores_orcamento(t: dict) -> dict:
    """Desconto total (linhas + global) em %, margem % e total — para as regras de aprovação."""
    desc = float(t.get("desconto_linhas") or 0) + float(t.get("desconto_total_valor") or 0)
    total = float(t.get("total") or 0)
    base = total + desc
    return {"desconto_pct": round2(desc / base * 100) if base > 0 else 0.0,
            "margem_pct": round2(float(t.get("margem_pct") or 0)), "total": round2(total)}


async def exigir_aprovacao_orcamento(orc_t: dict, user: dict, acao: str) -> None:
    await exigir_aprovacao("orcamento", orc_t["id"], valores_orcamento(orc_t), user,
                           titulo=f"Orçamento {orc_t.get('numero') or '(rascunho)'} — {orc_t.get('cliente') or ''}",
                           link=f"/orcamentos/{orc_t['id']}", acao=acao)


async def exigir_aprovacao_oc(oc: dict, user: dict, acao: str) -> None:
    await exigir_aprovacao("ordem_compra", oc["id"], {"total": round2(float(oc.get("total") or 0))}, user,
                           titulo=f"Ordem de compra {oc.get('codigo') or ''} — {oc.get('fornecedor_nome') or ''}",
                           link=f"/ordens-compra/{oc['id']}", acao=acao)


# ---------------------------------------------------------------------------
# Bloqueio manual da encomenda
# ---------------------------------------------------------------------------
def assert_nao_bloqueada(enc: Optional[dict], acao: str) -> None:
    b = (enc or {}).get("bloqueio") or {}
    if b.get("ativo"):
        raise HTTPException(409, f"Encomenda {enc.get('numero')} bloqueada ({b.get('motivo') or 'sem motivo'}) — não é possível {acao}. "
                                 "Desbloqueie-a primeiro.")
