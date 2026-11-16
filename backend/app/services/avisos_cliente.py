"""Avisos automáticos ao cliente por email quando a encomenda avança.

Eventos: recebida (encomenda criada), em_producao, pronta (concluída e por entregar), entregue e prazo
(data de entrega prevista definida/alterada). Cada email leva o link do cliente (estado, maquetas e pagamento).

Corre no ciclo de 5 minutos e compara o estado de cada encomenda com o que já foi avisado
(`encomenda.avisos_cliente`), por isso não depende de onde a encomenda foi alterada. Ao ligar os avisos,
o estado atual de todas as encomendas é marcado como já avisado (só se avisam mudanças daí para a frente).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from app.core.database import now_iso
from app.repositories import empresa_repo, encomendas_repo

logger = logging.getLogger(__name__)

EVENTOS = {
    "recebida": "Encomenda recebida",
    "em_producao": "Entrou em produção",
    "prazo": "Data de entrega prevista (definida ou alterada)",
    "pronta": "Pronta para levantar / enviar",
    "entregue": "Entregue",
}
PADRAO = {"ativo": False, "eventos": ["recebida", "em_producao", "prazo", "pronta", "entregue"], "anexar_pdf": False}
SISTEMA = {"id": "avisos", "name": "Avisos automáticos"}


async def get_config() -> dict:
    e = await empresa_repo.find_one({"id": "empresa"}) or {}
    return {**PADRAO, **(e.get("avisos_cliente") or {})}


def estado_atual(e: dict) -> dict:
    """Marcadores do que já devia ter sido avisado nesta encomenda (evento → valor)."""
    m = {"recebida": "1"}
    est = e.get("estado")
    if est in ("em_producao", "concluida") or e.get("entregue"):
        m["em_producao"] = "1"
    if (est == "concluida" and not e.get("entregue")) or e.get("entregue"):
        m["pronta"] = "1"
    if e.get("entregue"):
        m["entregue"] = "1"
    if (e.get("prazo_entrega") or "").strip():
        m["prazo"] = e["prazo_entrega"][:10]
    return m


async def guardar_config(dados: dict) -> dict:
    antes = await get_config()
    cfg = {"ativo": bool(dados.get("ativo")),
           "eventos": [x for x in dados.get("eventos") or [] if x in EVENTOS],
           "anexar_pdf": bool(dados.get("anexar_pdf"))}
    await empresa_repo.update_where({"id": "empresa"}, {"avisos_cliente": cfg}, upsert=True)
    if cfg["ativo"] and not antes.get("ativo"):
        # Ao ligar: o que já aconteceu fica como avisado (não se enviam emails de encomendas antigas)
        n = 0
        for e in await encomendas_repo.find({"estado": {"$ne": "cancelada"}}, limit=50000):
            marc = {k: {"valor": v, "at": now_iso(), "ignorado": True} for k, v in estado_atual(e).items()}
            await encomendas_repo.col.update_one({"id": e["id"]}, {"$set": {"avisos_cliente": {**marc, **(e.get("avisos_cliente") or {})}}})
            n += 1
        logger.info("Avisos ao cliente ligados; %s encomendas marcadas", n)
    return cfg


def _pendentes(e: dict, eventos: List[str]) -> List[tuple]:
    feitos = e.get("avisos_cliente") or {}
    out = []
    for k, v in estado_atual(e).items():
        if k in eventos and (feitos.get(k) or {}).get("valor") != v:
            out.append((k, v))
    # um email de cada vez, pela ordem natural; os anteriores ficam marcados sem email
    ordem = list(EVENTOS)
    out.sort(key=lambda x: ordem.index(x[0]))
    return out


async def _texto(evento: str, e: dict, nome: str, link: str, valores: dict) -> tuple:
    from app.services import email as email_svc
    from app.services.email_templates import text_to_html_fragments
    num = e.get("numero") or ""
    emp = (await empresa_repo.find_one({"id": "empresa"}) or {}).get("nome") or "Fam'Art"
    if evento == "pronta":
        subject, text, html = await email_svc.encomenda_pronta_email(nome, num, valores=valores)
    elif evento == "prazo":
        subject, text, html = await email_svc.encomenda_prazo_email(nome, num, e.get("prazo_entrega") or "", valores=valores)
    else:
        frases = {
            "recebida": ("Recebemos a sua encomenda {n}", "Obrigado! A sua encomenda {n} foi registada.\n\n"
                         "No link abaixo pode acompanhar o estado, aprovar as maquetas e fazer o pagamento. "
                         "A produção começa depois do pagamento."),
            "em_producao": ("Encomenda {n} em produção", "Boas notícias: a sua encomenda {n} entrou em produção."),
            "entregue": ("Encomenda {n} entregue", "A sua encomenda {n} foi entregue. Obrigado pela preferência!\n\n"
                         "Se gostou do resultado, a sua opinião ajuda-nos muito."),
        }
        assunto, corpo = frases[evento]
        subject = f"{emp} — " + assunto.format(n=num)
        text = f"Olá {nome},\n\n{corpo.format(n=num)}\n\n— {emp}\n"
        html = None
    if link and link not in (text or ""):
        text = (text or "").rstrip() + f"\n\nAcompanhe a sua encomenda: {link}\n"
        html = None
    if html is None:
        html = email_svc._branded_html(text_to_html_fragments(text))
    return subject, text, html


async def avisar(e: dict, evento: str, cfg: dict) -> Optional[str]:
    """Envia o email do evento. Devolve o email (mascarado) ou None se não houver destinatário."""
    from app.services import audit, contactos as contactos_svc, email as email_svc, portal
    from app.services.costing import compute_encomenda
    from app.services.pdf import fetch_cliente
    cliente = await fetch_cliente(e.get("cliente_id"))
    to = contactos_svc.resolve_email_destinatario(e, cliente, prefer_papel="")
    if not to or "@" not in to:
        return None
    c = await compute_encomenda(dict(e))
    valores = email_svc.valores_encomenda_email(c)
    link = ""
    try:
        link = portal.url_publico((await portal.criar_link("encomenda", e["id"], SISTEMA))["token"])
        if not link.startswith("http"):
            link = ""
    except Exception:  # noqa: BLE001
        link = ""
    nome = (e.get("contacto_nome") or (cliente or {}).get("nome") or e.get("cliente") or "").strip() or "Cliente"
    subject, text, html = await _texto(evento, e, nome, link, valores)
    anexos = []
    if cfg.get("anexar_pdf") and evento in ("pronta", "prazo"):
        try:
            from app.services.pdf import build_encomenda_pdf, load_pdf_config
            settings, fields, branding = await load_pdf_config(None, "encomenda")
            anexos = [(f"{e.get('numero') or 'encomenda'}.pdf", build_encomenda_pdf(c, settings, fields, branding, cliente, None), "application/pdf")]
        except Exception:  # noqa: BLE001
            anexos = []
    ok, motivo = await asyncio.to_thread(email_svc.send_email, to, subject, text, html=html, attachments=anexos)
    if not ok:
        raise RuntimeError(motivo or "falha no envio")
    await audit.registar("encomenda", e["id"], "email_enviado", SISTEMA,
                         f"Aviso automático ao cliente «{EVENTOS[evento]}» enviado para {email_svc.mask_email(to)}", e.get("numero"))
    return email_svc.mask_email(to)


async def verificar() -> int:
    """Chamado no ciclo: envia os avisos em falta. Devolve quantos emails foram enviados."""
    from app.services import email as email_svc
    cfg = await get_config()
    if not cfg.get("ativo") or not cfg.get("eventos") or not email_svc.smtp_configured():
        return 0
    limite = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    enviados = 0
    for e in await encomendas_repo.find({"estado": {"$ne": "cancelada"}, "created_at": {"$gte": limite}}, limit=5000):
        pend = _pendentes(e, cfg["eventos"])
        if not pend:
            continue
        feitos = dict(e.get("avisos_cliente") or {})
        # Só o último evento gera email (ex.: criada e já pronta → um só aviso «pronta»); os outros ficam marcados
        for k, v in pend[:-1]:
            feitos[k] = {"valor": v, "at": now_iso(), "ignorado": True}
        k, v = pend[-1]
        try:
            para = await avisar(e, k, cfg)
            feitos[k] = {"valor": v, "at": now_iso(), "para": para} if para else {"valor": v, "at": now_iso(), "sem_email": True}
            enviados += 1 if para else 0
        except Exception as ex:  # noqa: BLE001 — tenta outra vez no próximo ciclo (até 3 vezes)
            tent = int((feitos.get(k) or {}).get("tentativas") or 0) + 1
            feitos[k] = {"valor": v if tent >= 3 else None, "at": now_iso(), "erro": str(ex)[:200], "tentativas": tent}
            logger.warning("Aviso %s da encomenda %s falhou: %s", k, e.get("numero"), ex)
        await encomendas_repo.col.update_one({"id": e["id"]}, {"$set": {"avisos_cliente": feitos}})
    return enviados
