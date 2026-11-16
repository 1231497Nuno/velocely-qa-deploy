"""Utilidades: preferências do utilizador (painel e atalhos), cópias de segurança e RGPD."""
from __future__ import annotations

import asyncio
import gzip
import json
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso
from app.repositories import clientes_repo, encomendas_repo, integracoes_repo, leads_repo, orcamentos_repo, users_repo

# ---------------------------------------------------------------------------
# Preferências do utilizador (painel e atalhos)
# ---------------------------------------------------------------------------
async def get_preferencias(user: dict) -> dict:
    u = await users_repo.get(user["id"]) or {}
    p = u.get("preferencias") or {}
    return {"painel_ocultos": p.get("painel_ocultos") or [], "atalhos": p.get("atalhos") or [],
            "painel_ordem": p.get("painel_ordem") or [], "menu": p.get("menu") or None}


def _limpar_menu(m) -> Optional[dict]:
    """Menu lateral personalizado: grupos (id, nome, itens por tid) e itens ocultos. `None` repõe o predefinido."""
    if not isinstance(m, dict):
        return None
    grupos = []
    vistos = set()
    for g in (m.get("grupos") or [])[:30]:
        if not isinstance(g, dict):
            continue
        itens = []
        for t in g.get("itens") or []:
            t = str(t)[:60]
            if t and t not in vistos:
                vistos.add(t)
                itens.append(t)
        grupos.append({"id": str(g.get("id") or new_id())[:40], "label": (str(g.get("label") or "").strip() or "Grupo")[:40], "itens": itens[:80]})
    ocultos = [str(x)[:60] for x in (m.get("ocultos") or [])][:120]
    return {"grupos": grupos, "ocultos": ocultos}


async def guardar_preferencias(user: dict, dados: dict) -> dict:
    atual = await get_preferencias(user)
    if "painel_ocultos" in dados:
        atual["painel_ocultos"] = [str(x)[:40] for x in dados.get("painel_ocultos") or []][:30]
    if "painel_ordem" in dados:
        atual["painel_ordem"] = [str(x)[:40] for x in dados.get("painel_ordem") or []][:30]
    if "menu" in dados:
        atual["menu"] = _limpar_menu(dados.get("menu"))
    if "atalhos" in dados:
        at = []
        for a in dados.get("atalhos") or []:
            url = str(a.get("url") or "")
            if url.startswith("/") and not url.startswith("//") and (a.get("nome") or "").strip():
                at.append({"id": a.get("id") or new_id(), "nome": a["nome"].strip()[:60], "url": url[:500]})
        atual["atalhos"] = at[:30]
    await users_repo.update(user["id"], {"preferencias": atual})
    return atual


# ---------------------------------------------------------------------------
# Cópias de segurança
# ---------------------------------------------------------------------------
BACKUP_CFG = "backups"
EXCLUIR = {"system.views"}
MANTER = 14


def _json_default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    try:
        from bson import ObjectId
        if isinstance(o, ObjectId):
            return str(o)
    except Exception:  # pragma: no cover
        pass
    return str(o)


async def gerar_backup() -> bytes:
    from app.core.database import db
    out = {"versao": 1, "criado_at": now_iso(), "colecoes": {}}
    for nome in await db.list_collection_names():
        if nome in EXCLUIR or nome.startswith("fs.") or nome == "importacoes_tmp":
            continue
        docs = []
        async for d in db[nome].find({}):
            d.pop("_id", None)
            docs.append(d)
        out["colecoes"][nome] = docs
    return gzip.compress(json.dumps(out, default=_json_default, ensure_ascii=False).encode("utf-8"))


async def backup_automatico(forcar: bool = False) -> Optional[dict]:
    """Uma cópia por dia guardada no armazenamento de ficheiros; mantém as últimas 14."""
    from app.services import storage
    cfg = await integracoes_repo.get(BACKUP_CFG) or {"id": BACKUP_CFG, "lista": []}
    hoje = datetime.now(timezone.utc).date().isoformat()
    if not forcar and any(b["data"] == hoje for b in cfg.get("lista") or []):
        return None
    dados = await gerar_backup()
    caminho = f"backups/velocely-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json.gz"
    await asyncio.to_thread(storage.put_object, caminho, dados, "application/gzip")
    lista = (cfg.get("lista") or []) + [{"id": new_id(), "data": hoje, "at": now_iso(), "caminho": caminho, "bytes": len(dados)}]
    while len(lista) > MANTER:
        velho = lista.pop(0)
        try:
            await asyncio.to_thread(storage.delete_object, velho["caminho"])
        except Exception:
            pass
    await integracoes_repo.update_where({"id": BACKUP_CFG}, {"id": BACKUP_CFG, "lista": lista}, upsert=True)
    return lista[-1]


async def listar_backups() -> List[dict]:
    cfg = await integracoes_repo.get(BACKUP_CFG) or {}
    return list(reversed(cfg.get("lista") or []))


async def ler_backup(bid: str) -> bytes:
    from app.services import storage
    b = next((x for x in await listar_backups() if x["id"] == bid), None)
    if not b:
        raise HTTPException(404, "Cópia não encontrada")
    dados, _ = await asyncio.to_thread(storage.get_object, b["caminho"])
    return dados


async def restaurar(dados: bytes, user: dict) -> dict:
    """Repõe todas as coleções a partir de uma cópia. Antes faz uma cópia do estado atual."""
    from app.core.database import db
    try:
        conteudo = json.loads(gzip.decompress(dados) if dados[:2] == b"\x1f\x8b" else dados)
        cols = conteudo["colecoes"]
        assert isinstance(cols, dict) and "users" in cols
    except Exception:
        raise HTTPException(400, "Ficheiro de cópia inválido")
    antes = await backup_automatico(forcar=True)
    for nome, docs in cols.items():
        if nome in EXCLUIR or nome == BACKUP_CFG:
            continue
        await db[nome].delete_many({})
        if docs:
            await db[nome].insert_many(docs)
    # A lista de cópias é mantida (inclui a cópia feita antes de restaurar)
    from app.services import audit
    await audit.registar("sistema", "backup", "editado", user, f"Dados restaurados a partir de uma cópia ({len(cols)} coleções)", "Cópia")
    return {"ok": True, "colecoes": len(cols), "copia_antes": antes}


# ---------------------------------------------------------------------------
# RGPD
# ---------------------------------------------------------------------------
async def exportar_cliente(cid: str) -> dict:
    from app.repositories import documentos_financeiros_repo
    c = await clientes_repo.get(cid)
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    return {"exportado_at": now_iso(), "cliente": c,
            "orcamentos": await orcamentos_repo.find({"cliente_id": cid}, limit=5000),
            "encomendas": await encomendas_repo.find({"cliente_id": cid}, limit=5000),
            "documentos": await documentos_financeiros_repo.find({"cliente_id": cid}, limit=5000),
            "leads": await leads_repo.find({"cliente_id": cid}, limit=500)}


async def consentimento(cid: str, dados: dict, user: dict) -> dict:
    c = await clientes_repo.get(cid)
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    reg = {"marketing": bool(dados.get("marketing")), "origem": (dados.get("origem") or "").strip()[:80],
           "at": now_iso(), "por": user.get("name") or user.get("nome") or ""}
    hist = (c.get("rgpd") or {}).get("historico") or []
    await clientes_repo.update(cid, {"rgpd": {**reg, "historico": hist + [reg]}})
    return reg


async def anonimizar(cid: str, user: dict) -> dict:
    """Apaga os dados pessoais do cliente. Documentos fiscais e encomendas mantêm-se (obrigação legal de 10 anos),
    só com o nome substituído nas encomendas, orçamentos e leads (os documentos fiscais ficam como foram emitidos)."""
    from app.services import audit
    c = await clientes_repo.get(cid)
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    nome = f"Cliente anonimizado {c.get('codigo') or cid[:6]}"
    await clientes_repo.update(cid, {"nome": nome, "email": "", "contacto": "", "telefone": "", "morada": "", "codigo_postal": "",
                                     "cidade": "", "notas": "", "contactos": [],
                                     "anonimizado_at": now_iso(), "rgpd": {"marketing": False, "anonimizado": True, "at": now_iso()}})
    for repo, campo in ((encomendas_repo, "cliente"), (orcamentos_repo, "cliente")):
        await repo.update_many({"cliente_id": cid}, {campo: nome, "contacto_nome": "", "contacto_email": "", "contacto_telefone": ""})
    await leads_repo.update_many({"cliente_id": cid}, {"nome": nome, "email": "", "telefone": "", "cliente_nome": nome})
    await audit.registar("cliente", cid, "editado", user, "Dados pessoais anonimizados (RGPD)", nome)
    return {"ok": True, "nome": nome}
