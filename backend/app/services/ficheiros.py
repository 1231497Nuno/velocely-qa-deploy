"""Ficheiros e fotos: do artigo + anexos próprios de cada documento."""
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile

from app.core.database import new_id, now_iso
from app.domain.models import Anexo
from app.repositories import (
    artigos_repo, orcamentos_repo, encomendas_repo, ordens_repo,
    pedidos_cotacao_repo, ordens_compra_repo, nao_conformidades_repo,
)
from app.services import audit
from app.api.routes.uploads import store_upload

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# tipo URL → repo, permissão, como encontrar artigos, rótulo do grupo do documento
ENTIDADES: Dict[str, Dict[str, Any]] = {
    "artigo": {
        "repo": artigos_repo,
        "perm": "artigos",
        "audit": "artigo",
        "titulo_doc": "Deste artigo",
        "not_found": "Artigo não encontrado",
        "self_artigo": True,
    },
    "orcamento": {
        "repo": orcamentos_repo,
        "perm": "orcamentos",
        "audit": "orcamento",
        "titulo_doc": "Deste orçamento",
        "not_found": "Orçamento não encontrado",
        "linhas": "linhas",
    },
    "encomenda": {
        "repo": encomendas_repo,
        "perm": "encomendas",
        "audit": "encomenda",
        "titulo_doc": "Desta encomenda",
        "not_found": "Encomenda não encontrada",
        "linhas": "artigos",
    },
    "ordem_fabrico": {
        "repo": ordens_repo,
        "perm": "ordens_fabrico",
        "audit": "ordem_fabrico",
        "titulo_doc": "Desta ordem de fabrico",
        "not_found": "Ordem de fabrico não encontrada",
        "linhas": "itens",
    },
    "pedido_cotacao": {
        "repo": pedidos_cotacao_repo,
        "perm": "pedidos_cotacao",
        "audit": "pedido_cotacao",
        "titulo_doc": "Deste pedido de cotação",
        "not_found": "Pedido de cotação não encontrado",
        "linhas": "linhas",
    },
    "ordem_compra": {
        "repo": ordens_compra_repo,
        "perm": "ordens_compra",
        "audit": "ordem_compra",
        "titulo_doc": "Desta ordem de compra",
        "not_found": "Ordem de compra não encontrada",
        "linhas": "linhas",
    },
    "nao_conformidade": {
        "repo": nao_conformidades_repo,
        "perm": "nao_conformidades",
        "audit": "nao_conformidade",
        "titulo_doc": "Desta não conformidade",
        "not_found": "Não conformidade não encontrada",
        "artigo_id_field": "artigo_id",
    },
}


def cfg(tipo: str) -> dict:
    c = ENTIDADES.get(tipo)
    if not c:
        raise HTTPException(404, "Tipo inválido")
    return c


def is_image(path: str = "", content_type: str = "", nome: str = "") -> bool:
    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return True
    suffix = Path(path or nome or "").suffix.lower()
    return suffix in IMAGE_EXT


def _item(*, iid: str, fonte: str, path: str, nome: str = "", content_type: str = "",
          size: int = 0, created_at: str = "", can_delete: bool = True) -> dict:
    kind = "imagem" if is_image(path, content_type, nome) else "ficheiro"
    return {
        "id": iid,
        "fonte": fonte,
        "kind": kind,
        "path": path,
        "nome": nome or Path(path).name or "ficheiro",
        "content_type": content_type,
        "size": size,
        "created_at": created_at,
        "can_delete": can_delete,
    }


def itens_do_registo(doc: dict, *, can_delete: bool, include_capa: bool = True) -> List[dict]:
    out: List[dict] = []
    seen = set()
    if include_capa and doc.get("imagem"):
        p = doc["imagem"]
        seen.add(p)
        out.append(_item(
            iid=f"capa:{p}", fonte="capa", path=p, nome="Foto principal",
            can_delete=False,
        ))
    for p in doc.get("imagens") or []:
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(_item(
            iid=f"img:{p}", fonte="imagens", path=p, nome=Path(p).name,
            can_delete=can_delete,
        ))
    for a in doc.get("anexos") or []:
        p = a.get("path") or ""
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(_item(
            iid=a.get("id") or new_id(),
            fonte="anexos",
            path=p,
            nome=a.get("nome") or "",
            content_type=a.get("content_type") or "",
            size=int(a.get("size") or 0),
            created_at=a.get("created_at") or "",
            can_delete=can_delete,
        ))
    return out


def _artigo_ids_from(doc: dict, meta: dict) -> List[Tuple[str, str]]:
    """[(artigo_id, nome_na_linha), ...] unique by id, order preserved."""
    seen = set()
    out = []
    if meta.get("self_artigo"):
        aid = doc.get("id")
        if aid:
            return [(aid, doc.get("nome") or "")]
        return []
    field = meta.get("artigo_id_field")
    if field:
        aid = doc.get(field)
        if aid and aid not in seen:
            seen.add(aid)
            out.append((aid, doc.get("artigo_nome") or ""))
        return out
    key = meta.get("linhas")
    for linha in doc.get(key) or []:
        aid = linha.get("artigo_id")
        if not aid or aid in seen:
            continue
        seen.add(aid)
        out.append((aid, linha.get("artigo_nome") or linha.get("nome") or ""))
    return out


async def listar(tipo: str, eid: str) -> dict:
    meta = cfg(tipo)
    doc = await meta["repo"].get(eid)
    if not doc:
        raise HTTPException(404, meta["not_found"])
    grupos = []
    doc_itens = itens_do_registo(doc, can_delete=True, include_capa=(tipo == "artigo"))
    grupos.append({
        "id": "documento",
        "origem": "documento",
        "titulo": meta["titulo_doc"],
        "artigo_id": doc.get("id") if tipo == "artigo" else None,
        "artigo_codigo": doc.get("codigo") if tipo == "artigo" else None,
        "itens": doc_itens,
    })
    if tipo != "artigo":
        refs = _artigo_ids_from(doc, meta)
        for aid, nome_linha in refs:
            art = await artigos_repo.get(aid)
            if not art:
                continue
            codigo = art.get("codigo") or ""
            nome = art.get("nome") or nome_linha or "Artigo"
            titulo = f"{codigo} · {nome}".strip(" ·") if codigo else nome
            grupos.append({
                "id": f"artigo:{aid}",
                "origem": "artigo",
                "titulo": titulo,
                "artigo_id": aid,
                "artigo_codigo": codigo,
                "itens": itens_do_registo(art, can_delete=False, include_capa=True),
            })
    return {"tipo": tipo, "id": eid, "grupos": grupos}


async def adicionar(tipo: str, eid: str, file: UploadFile, user: dict) -> dict:
    meta = cfg(tipo)
    doc = await meta["repo"].get(eid)
    if not doc:
        raise HTTPException(404, meta["not_found"])
    stored = await store_upload(file)
    anexo = Anexo(
        id=new_id(),
        nome=stored["nome"] or "ficheiro",
        path=stored["path"],
        content_type=stored["content_type"],
        size=stored["size"],
        created_at=now_iso(),
    ).model_dump()
    anexos = list(doc.get("anexos") or [])
    anexos.append(anexo)
    imagens = list(doc.get("imagens") or [])
    patch = {"anexos": anexos}
    if is_image(anexo["path"], anexo["content_type"], anexo["nome"]) and tipo != "artigo":
        if anexo["path"] not in imagens:
            imagens.append(anexo["path"])
            patch["imagens"] = imagens
    await meta["repo"].update(eid, patch)
    await audit.registar(
        meta["audit"], eid, "anexo", user,
        f"Ficheiro «{anexo['nome']}» associado",
        doc.get("numero") or doc.get("codigo") or doc.get("nome"),
    )
    return await listar(tipo, eid)


async def remover(tipo: str, eid: str, item_id: str, user: dict) -> dict:
    meta = cfg(tipo)
    doc = await meta["repo"].get(eid)
    if not doc:
        raise HTTPException(404, meta["not_found"])
    if item_id.startswith("capa:"):
        raise HTTPException(400, "A foto principal altera-se no artigo.")
    if item_id.startswith("img:"):
        path = item_id[4:]
        imagens = [p for p in (doc.get("imagens") or []) if p != path]
        anexos = [a for a in (doc.get("anexos") or []) if a.get("path") != path]
        await meta["repo"].update(eid, {"imagens": imagens, "anexos": anexos})
        await audit.registar(
            meta["audit"], eid, "anexo", user,
            "Imagem removida",
            doc.get("numero") or doc.get("codigo") or doc.get("nome"),
        )
        return await listar(tipo, eid)
    anexos = list(doc.get("anexos") or [])
    found = next((a for a in anexos if a.get("id") == item_id), None)
    if not found:
        raise HTTPException(404, "Ficheiro não encontrado")
    anexos = [a for a in anexos if a.get("id") != item_id]
    patch: dict = {"anexos": anexos}
    path = found.get("path")
    if path and path in (doc.get("imagens") or []):
        patch["imagens"] = [p for p in doc.get("imagens") or [] if p != path]
    await meta["repo"].update(eid, patch)
    await audit.registar(
        meta["audit"], eid, "anexo", user,
        f"Ficheiro «{found.get('nome') or ''}» removido",
        doc.get("numero") or doc.get("codigo") or doc.get("nome"),
    )
    return await listar(tipo, eid)


def preserve_anexos(update: dict, existing: Optional[dict] = None) -> dict:
    """PUT do documento não deve apagar anexos geridos na tab Ficheiros."""
    update.pop("anexos", None)
    return update
