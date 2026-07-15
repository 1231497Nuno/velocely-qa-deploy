"""Consulta de utilizações ("onde é usado") de entidades de catálogo.

Faz a pesquisa inversa: dado um id de máquina/material/mão de obra/personalização/artigo,
devolve os documentos onde está a ser aplicado, com dados para navegação.
"""
from app.repositories import artigos_repo, orcamentos_repo, encomendas_repo, ordens_repo


def _art_ref(a: dict) -> dict:
    return {"id": a.get("id"), "nome": a.get("nome", "")}


def _orc_ref(o: dict) -> dict:
    return {"id": o.get("id"), "numero": o.get("numero", ""), "cliente": o.get("cliente", ""), "estado": o.get("status", "")}


def _enc_ref(e: dict) -> dict:
    return {"id": e.get("id"), "numero": e.get("numero", ""), "cliente": e.get("cliente", ""), "estado": e.get("estado", "")}


def _of_ref(f: dict) -> dict:
    return {"id": f.get("id"), "numero": f.get("numero", ""), "cliente": f.get("cliente", ""), "estado": f.get("status", "")}


def _has_pers(pers_list, tid) -> bool:
    return any((p or {}).get("id") == tid for p in (pers_list or []))


async def maquina_utilizacoes(mid: str) -> dict:
    artigos = await artigos_repo.find(sort=("nome", 1), limit=5000)
    used = [a for a in artigos if any((op or {}).get("maquina_id") == mid for op in (a.get("roteiro") or []))]
    return {"artigos": [_art_ref(a) for a in used]}


async def mao_obra_utilizacoes(mid: str) -> dict:
    artigos = await artigos_repo.find(sort=("nome", 1), limit=5000)
    used = [a for a in artigos if any((op or {}).get("mao_obra_id") == mid for op in (a.get("roteiro") or []))]
    return {"artigos": [_art_ref(a) for a in used]}


async def consumivel_utilizacoes(cid: str) -> dict:
    artigos = await artigos_repo.find(sort=("nome", 1), limit=5000)
    used = [a for a in artigos if any((m or {}).get("material_id") == cid for m in (a.get("materiais") or []))]
    return {"artigos": [_art_ref(a) for a in used]}


async def tipo_pers_utilizacoes(tid: str) -> dict:
    orcs = await orcamentos_repo.find(sort=("created_at", -1), limit=5000)
    o_used = [o for o in orcs if any(_has_pers(l.get("personalizacoes"), tid) or l.get("tipo_personalizacao_id") == tid for l in (o.get("linhas") or []))]
    encs = await encomendas_repo.find(sort=("created_at", -1), limit=5000)
    e_used = [e for e in encs if any(_has_pers(a.get("personalizacoes"), tid) for a in (e.get("artigos") or []))]
    ofs = await ordens_repo.find(sort=("created_at", -1), limit=5000)
    f_used = [f for f in ofs if any(_has_pers(it.get("personalizacoes"), tid) or it.get("tipo_personalizacao_id") == tid for it in (f.get("itens") or []))]
    return {
        "orcamentos": [_orc_ref(o) for o in o_used],
        "encomendas": [_enc_ref(e) for e in e_used],
        "ordens_fabrico": [_of_ref(f) for f in f_used],
    }


async def artigo_utilizacoes(aid: str) -> dict:
    orcs = await orcamentos_repo.find(sort=("created_at", -1), limit=5000)
    o_used = [o for o in orcs if any((l or {}).get("artigo_id") == aid for l in (o.get("linhas") or []))]
    encs = await encomendas_repo.find(sort=("created_at", -1), limit=5000)
    e_used = [e for e in encs if any((a or {}).get("artigo_id") == aid for a in (e.get("artigos") or []))]
    ofs = await ordens_repo.find(sort=("created_at", -1), limit=5000)
    f_used = [f for f in ofs if any((it or {}).get("artigo_id") == aid for it in (f.get("itens") or []))]
    return {
        "orcamentos": [_orc_ref(o) for o in o_used],
        "encomendas": [_enc_ref(e) for e in e_used],
        "ordens_fabrico": [_of_ref(f) for f in f_used],
    }
