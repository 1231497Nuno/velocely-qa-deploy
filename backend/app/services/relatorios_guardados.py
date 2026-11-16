"""Relatórios guardados (parâmetros, período relativo e colunas) e envio automático por email."""
from __future__ import annotations

import asyncio
import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException

from app.core.database import new_id, now_iso
from app.repositories import relatorios_guardados_repo as repo
from app.services import relatorios as rel_svc

logger = logging.getLogger(__name__)

PERIODOS = {
    "ano_atual": "Este ano", "ano_anterior": "Ano passado", "mes_atual": "Este mês", "mes_anterior": "Mês passado",
    "trimestre_atual": "Este trimestre", "trimestre_anterior": "Trimestre passado", "semana_atual": "Esta semana",
    "semana_anterior": "Semana passada", "ultimos_7": "Últimos 7 dias", "ultimos_30": "Últimos 30 dias",
    "ultimos_12m": "Últimos 12 meses", "personalizado": "Datas fixas",
}
FREQUENCIAS = ("diario", "semanal", "mensal")


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Europe/Lisbon")
    except Exception:
        return timezone.utc


def agora() -> datetime:
    return datetime.now(_tz())


def intervalo(periodo: str, hoje: date, de: str = "", ate: str = "") -> Tuple[str, str]:
    """Converte o período relativo em datas (calculadas no dia em que o relatório corre)."""
    def mes(y, m):
        return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    if periodo == "ano_anterior":
        a, b = date(hoje.year - 1, 1, 1), date(hoje.year - 1, 12, 31)
    elif periodo == "mes_atual":
        a, b = date(hoje.year, hoje.month, 1), hoje
    elif periodo == "mes_anterior":
        p = date(hoje.year, hoje.month, 1) - timedelta(days=1)
        a, b = mes(p.year, p.month)
    elif periodo in ("trimestre_atual", "trimestre_anterior"):
        q = (hoje.month - 1) // 3
        y = hoje.year
        if periodo == "trimestre_anterior":
            q -= 1
            if q < 0:
                q, y = 3, y - 1
        a = date(y, q * 3 + 1, 1)
        b = mes(y, q * 3 + 3)[1] if periodo == "trimestre_anterior" else hoje
    elif periodo == "semana_atual":
        a, b = hoje - timedelta(days=hoje.weekday()), hoje
    elif periodo == "semana_anterior":
        a = hoje - timedelta(days=hoje.weekday() + 7)
        b = a + timedelta(days=6)
    elif periodo == "ultimos_7":
        a, b = hoje - timedelta(days=6), hoje
    elif periodo == "ultimos_30":
        a, b = hoje - timedelta(days=29), hoje
    elif periodo == "ultimos_12m":
        a, b = date(hoje.year - 1, hoje.month, 1), hoje
    elif periodo == "personalizado" and de and ate:
        return de[:10], ate[:10]
    else:  # ano_atual
        a, b = date(hoje.year, 1, 1), hoje
    return a.isoformat(), b.isoformat()


def proximo_envio(envio: dict, depois_de: datetime) -> Optional[str]:
    if not envio or not envio.get("ativo"):
        return None
    hora = min(23, max(0, int(envio.get("hora") or 8)))
    freq = envio.get("frequencia") or "semanal"
    base = depois_de.astimezone(_tz())
    d = base.date()
    for _ in range(400):
        cand = datetime(d.year, d.month, d.day, hora, 0, tzinfo=_tz())
        ok = (freq == "diario"
              or (freq == "semanal" and d.weekday() == int(envio.get("dia_semana") or 0))
              or (freq == "mensal" and d.day == min(int(envio.get("dia_mes") or 1), calendar.monthrange(d.year, d.month)[1])))
        if ok and cand > base:
            return cand.astimezone(timezone.utc).isoformat()
        d += timedelta(days=1)
    return None


def normalizar(dados: dict, user: dict, existente: Optional[dict] = None) -> dict:
    rid = dados.get("relatorio_id") or (existente or {}).get("relatorio_id")
    if rid not in rel_svc.RELATORIOS:
        raise HTTPException(400, "Relatório desconhecido")
    nome = (dados.get("nome") or "").strip()
    if not nome:
        raise HTTPException(400, "Dê um nome ao relatório")
    periodo = dados.get("periodo") if dados.get("periodo") in PERIODOS else "ano_atual"
    envio = dict(dados.get("envio") or {})
    dest = [e.strip() for e in (envio.get("destinatarios") or []) if e and "@" in e]
    envio = {"ativo": bool(envio.get("ativo")) and bool(dest), "frequencia": envio.get("frequencia") if envio.get("frequencia") in FREQUENCIAS else "semanal",
             "dia_semana": int(envio.get("dia_semana") or 0) % 7, "dia_mes": min(28, max(1, int(envio.get("dia_mes") or 1))),
             "hora": min(23, max(0, int(envio.get("hora") if envio.get("hora") not in (None, "") else 8))),
             "formato": envio.get("formato") if envio.get("formato") in ("xlsx", "pdf") else "pdf", "destinatarios": dest,
             "mensagem": (envio.get("mensagem") or "").strip()}
    if (dados.get("envio") or {}).get("ativo") and not dest:
        raise HTTPException(400, "Indique pelo menos um email para o envio automático")
    doc = {"nome": nome, "relatorio_id": rid, "periodo": periodo,
           "de": (dados.get("de") or "")[:10], "ate": (dados.get("ate") or "")[:10],
           "agrupar": dados.get("agrupar") if dados.get("agrupar") in rel_svc.AGRUPAMENTOS else "mes",
           "comparar": dados.get("comparar") if dados.get("comparar") in ("anterior", "ano") else "",
           "cliente_id": (dados.get("cliente_id") or "").strip(), "cliente_nome": (dados.get("cliente_nome") or "").strip(),
           "limite": max(0, int(dados.get("limite") or 0)), "colunas": [c for c in dados.get("colunas") or [] if isinstance(c, str)],
           "partilhado": bool(dados.get("partilhado")), "envio": envio, "updated_at": now_iso()}
    doc["proximo_envio"] = proximo_envio(envio, agora())
    if not existente:
        doc.update({"id": new_id(), "created_at": now_iso(), "ultimo_envio": None,
                    "dono": {"id": user.get("id"), "nome": user.get("name") or user.get("nome") or ""}})
    return doc


def aplicar_colunas(rel: dict, colunas: List[str]) -> dict:
    """Mostra só as colunas escolhidas (pela ordem escolhida); mantém sempre a 1.ª coluna."""
    if not colunas:
        return rel
    por_key = {c["key"]: c for c in rel.get("colunas") or []}
    escolhidas = [por_key[k] for k in colunas if k in por_key]
    if not escolhidas:
        return rel
    primeira = (rel.get("colunas") or [None])[0]
    if primeira and primeira not in escolhidas:
        escolhidas.insert(0, primeira)
    return {**rel, "colunas": escolhidas}


async def gerar(g: dict, hoje: Optional[date] = None) -> dict:
    de, ate = intervalo(g.get("periodo") or "ano_atual", hoje or agora().date(), g.get("de") or "", g.get("ate") or "")
    p = rel_svc.normalizar(de, ate, g.get("agrupar") or "mes", g.get("comparar") or "", g.get("cliente_id") or "", int(g.get("limite") or 0))
    rel = await rel_svc.gerar(g["relatorio_id"], p)
    rel = aplicar_colunas(rel, g.get("colunas") or [])
    rel["guardado"] = {"id": g.get("id"), "nome": g.get("nome"), "periodo": PERIODOS.get(g.get("periodo"), "")}
    return rel


async def enviar(g: dict) -> Tuple[bool, str]:
    from app.services.email import send_email, _branded_html, _esc
    env = g.get("envio") or {}
    dest = env.get("destinatarios") or []
    if not dest:
        return False, "Sem destinatários"
    rel = await gerar(g)
    empresa = await rel_svc.nome_empresa()
    fmt = env.get("formato") or "pdf"
    dados = rel_svc.exportar_pdf(rel, empresa) if fmt == "pdf" else rel_svc.exportar_xlsx(rel, empresa)
    mime = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    nome_fich = f"{g['nome']} {rel['parametros']['de']} a {rel['parametros']['ate']}.{fmt}".replace("/", "-")
    assunto = f"{g['nome']} — {rel_svc._subtitulo(rel).replace('Período: ', '')}"
    texto = (env.get("mensagem") + "\n\n" if env.get("mensagem") else "") + \
        f"Segue em anexo o relatório «{g['nome']}» ({rel['titulo']}).\n{rel_svc._subtitulo(rel)}\n\nEnviado automaticamente pelo Velocely."
    html = _branded_html("".join(f"<p>{_esc(par)}</p>" for par in texto.split("\n\n")))
    erros = []
    for to in dest:
        ok, err = await asyncio.to_thread(send_email, to, assunto, texto, html=html, attachments=[(nome_fich, dados, mime)])
        if not ok:
            erros.append(f"{to}: {'servidor de email não configurado' if err == 'no_smtp' else err}")
    return (not erros), "; ".join(erros)


async def processar(momento: Optional[datetime] = None) -> int:
    """Envia os relatórios agendados que estão na hora. Chamado periodicamente pelo servidor."""
    momento = momento or datetime.now(timezone.utc)
    n = 0
    for g in await repo.find({"envio.ativo": True}, limit=1000):
        prox = g.get("proximo_envio")
        if not prox or prox > momento.isoformat():
            continue
        novo = proximo_envio(g.get("envio") or {}, momento)
        # Reclamar o envio (evita duplicados se houver mais do que um processo)
        res = await repo.col.update_one({"id": g["id"], "proximo_envio": prox}, {"$set": {"proximo_envio": novo}})
        if res is not None and getattr(res, "modified_count", 1) == 0:
            continue
        try:
            ok, erro = await enviar(g)
        except Exception as ex:  # um relatório com erro não pode parar os outros
            logger.exception("Falha no envio do relatório %s", g.get("id"))
            ok, erro = False, str(ex)
        await repo.update(g["id"], {"ultimo_envio": {"at": now_iso(), "ok": ok, "erro": erro}})
        n += 1 if ok else 0
    return n


async def _tarefas_periodicas():
    """Cada tarefa corre isolada: uma falha (ex.: loja online em baixo) não impede as seguintes."""
    from app.services import avisos_cliente, manutencao, tesouraria, utilidades, workflow
    from app.services import stock as stock_svc
    from app.services.integracoes import enviar_para_loja
    return [
        ("prazos", workflow.verificar_prazos), ("orçamentos", workflow.verificar_orcamentos),
        ("manutenção", manutencao.verificar), ("cobranças", tesouraria.verificar_cobrancas),
        ("backup", utilidades.backup_automatico), ("loja online", lambda: enviar_para_loja(so_pendentes=True)),
        ("avisos a clientes", avisos_cliente.verificar), ("compras automáticas", stock_svc.compras_automaticas),
    ]


async def ciclo(intervalo_seg: int = 300) -> None:
    while True:
        try:
            await processar()
        except Exception:
            logger.exception("Ciclo de relatórios agendados falhou")
        try:
            tarefas = await _tarefas_periodicas()
        except Exception:
            logger.exception("Não foi possível preparar as tarefas periódicas")
            tarefas = []
        for nome, fn in tarefas:
            try:
                await fn()
            except Exception:
                logger.exception("Tarefa periódica «%s» falhou", nome)
        await asyncio.sleep(intervalo_seg)
