"""CRM — funil de leads com estados configuráveis (kanban).

Estados: cada empresa define as colunas (nome, cor, ordem, tipo aberto/ganho/perdido).
Leads: contacto + origem + valor estimado + interações + ligação a cliente e orçamentos.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from app.services import campos as campos_svc
from app.core.database import new_id, now_iso
from app.core.security import require_perm
from app.domain.crm import (
    CORES_ESTADO, ESTADOS_DEFAULT, ORIGENS_SUGERIDAS,
    ConverterLeadInput, Estado, EstadoInput, InteracaoInput, LeadInput,
    LigarOrcamentoInput, MoverLeadInput, OrdemEstadosInput,
)
from app.domain.models import Cliente, ClienteInput
from app.repositories import (
    clientes_repo, crm_estados_repo, leads_repo, orcamentos_repo, users_repo,
)
from app.services import audit
from app.services.costing import compute_orcamento_totais
from app.services.numeracao import next_codigo

router = APIRouter(tags=["CRM"])

ORDEM_PASSO = 1000.0

_LEAD_CAMPOS = [
    "nome", "empresa", "telefone", "email", "origem", "descricao",
    "valor_estimado", "estado_id", "responsavel_id", "proxima_acao_at",
    "proxima_acao_nota", "motivo_perda",
]


# ----------------------------------------------------------------- helpers
def _nome_user(user: Optional[dict]) -> str:
    if not user:
        return "Sistema"
    return user.get("name") or user.get("login") or (user.get("email") or "").split("@")[0] or "Utilizador"


def _titulo_lead(lead: dict) -> str:
    return lead.get("empresa") or lead.get("nome") or "Lead"


async def ensure_estados() -> None:
    """Cria os estados por defeito se a empresa ainda não tiver nenhum."""
    if await crm_estados_repo.count() > 0:
        return
    for i, e in enumerate(ESTADOS_DEFAULT):
        await crm_estados_repo.insert(Estado(**e, ordem=i).model_dump())


async def _estados() -> list:
    await ensure_estados()
    return await crm_estados_repo.find(sort=("ordem", 1), limit=200)


async def _estado_inicial_id() -> str:
    estados = await _estados()
    abertos = [e for e in estados if e.get("tipo") == "aberto"]
    return (abertos or estados)[0]["id"]


async def _get_estado(eid: str) -> dict:
    e = await crm_estados_repo.get(eid)
    if not e:
        raise HTTPException(400, "Estado do funil inválido")
    return e


async def _get_lead(lid: str) -> dict:
    lead = await leads_repo.get(lid)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    return lead


async def _nome_responsavel(uid: Optional[str]) -> str:
    if not uid:
        return ""
    u = await users_repo.get(uid, projection={"name": 1, "login": 1, "email": 1})
    if not u:
        raise HTTPException(400, "Responsável inválido")
    return _nome_user(u)


async def _ordem_no_fim(estado_id: str, excluir_id: Optional[str] = None) -> float:
    q = {"estado_id": estado_id}
    if excluir_id:
        q["id"] = {"$ne": excluir_id}
    ultimos = await leads_repo.find(q, sort=("ordem", -1), limit=1, projection={"ordem": 1})
    return (float(ultimos[0].get("ordem") or 0) + ORDEM_PASSO) if ultimos else ORDEM_PASSO


async def _ordem_antes_de(estado_id: str, antes_de_id: str, excluir_id: str) -> float:
    alvo = await leads_repo.get(antes_de_id, projection={"ordem": 1, "estado_id": 1})
    if not alvo or alvo.get("estado_id") != estado_id or antes_de_id == excluir_id:
        return await _ordem_no_fim(estado_id, excluir_id)
    alvo_ordem = float(alvo.get("ordem") or 0)
    anteriores = await leads_repo.find(
        {"estado_id": estado_id, "id": {"$ne": excluir_id}, "ordem": {"$lt": alvo_ordem}},
        sort=("ordem", -1), limit=1, projection={"ordem": 1},
    )
    if anteriores:
        return (float(anteriores[0].get("ordem") or 0) + alvo_ordem) / 2
    return alvo_ordem - ORDEM_PASSO


def _interacao_sistema(texto: str, user: Optional[dict]) -> dict:
    ts = now_iso()
    return {
        "id": new_id(), "tipo": "sistema", "texto": texto, "at": ts, "created_at": ts,
        "autor_id": (user or {}).get("id"), "autor_nome": _nome_user(user),
    }


def _campos_fecho(estado: dict) -> dict:
    fechado = estado.get("tipo") in ("ganho", "perdido")
    return {"fechado_at": now_iso() if fechado else None}


def _lead_publico(lead: dict, estados_by_id: Optional[dict] = None) -> dict:
    out = dict(lead)
    out["interacoes"] = sorted(out.get("interacoes") or [], key=lambda i: i.get("at") or "", reverse=True)
    out["orcamento_ids"] = out.get("orcamento_ids") or []
    out["is_cliente"] = bool(out.get("cliente_id"))
    if estados_by_id is not None:
        e = estados_by_id.get(out.get("estado_id")) or {}
        out["estado_nome"] = e.get("nome", "")
        out["estado_cor"] = e.get("cor", "")
        out["estado_tipo"] = e.get("tipo", "aberto")
    return out


async def _check_perm(user: dict, modulo: str, acao: str) -> None:
    """Verifica uma permissão extra dentro de um endpoint (ex.: criar cliente a partir do CRM)."""
    await require_perm(modulo, acao)(user=user)


# ----------------------------------------------------------------- meta
@router.get("/crm/meta")
async def crm_meta(_u: dict = Depends(require_perm("crm", "view"))):
    users = await users_repo.find(
        {"status": {"$ne": "disabled"}}, sort=("name", 1), limit=500,
        projection={"id": 1, "name": 1, "login": 1, "email": 1},
    )
    from app.services import listas as listas_svc
    listas = await listas_svc.todas()
    return {
        "origens": listas.get("origens_lead") or ORIGENS_SUGERIDAS,
        "motivos_perda": listas.get("motivos_perda") or [],
        "cores": CORES_ESTADO,
        "responsaveis": [{"id": u["id"], "nome": _nome_user(u)} for u in users if u.get("id")],
    }


# ----------------------------------------------------------------- estados
@router.get("/crm/estados")
async def list_estados(_u: dict = Depends(require_perm("crm", "view"))):
    estados = await _estados()
    for e in estados:
        e["total_leads"] = await leads_repo.count({"estado_id": e["id"]})
    return estados


@router.post("/crm/estados")
async def create_estado(data: EstadoInput, user: dict = Depends(require_perm("crm", "edit"))):
    estados = await _estados()
    if any(e["nome"].lower() == data.nome.lower() for e in estados):
        raise HTTPException(400, f"Já existe um estado chamado «{data.nome}»")
    ordem = (max((e.get("ordem") or 0) for e in estados) + 1) if estados else 0
    e = Estado(**data.model_dump(), ordem=ordem)
    await crm_estados_repo.insert(e.model_dump())
    await audit.registar("crm_estado", e.id, "criado", user, f"Estado do funil «{e.nome}» criado", e.nome)
    return {**e.model_dump(), "total_leads": 0}


@router.put("/crm/estados-ordem")
async def reordenar_estados(data: OrdemEstadosInput, user: dict = Depends(require_perm("crm", "edit"))):
    estados = await _estados()
    atuais = {e["id"] for e in estados}
    if set(data.ids) != atuais or len(data.ids) != len(atuais):
        raise HTTPException(400, "A nova ordem tem de incluir todos os estados")
    for i, eid in enumerate(data.ids):
        await crm_estados_repo.update(eid, {"ordem": i})
    await audit.registar("crm_estado", "ordem", "editado", user, "Ordem dos estados do funil alterada", "Funil")
    return await list_estados(user)


@router.put("/crm/estados/{eid}")
async def update_estado(eid: str, data: EstadoInput, user: dict = Depends(require_perm("crm", "edit"))):
    existing = await crm_estados_repo.get(eid)
    if not existing:
        raise HTTPException(404, "Estado não encontrado")
    estados = await _estados()
    if any(e["id"] != eid and e["nome"].lower() == data.nome.lower() for e in estados):
        raise HTTPException(400, f"Já existe um estado chamado «{data.nome}»")
    novo = data.model_dump()
    await crm_estados_repo.update(eid, novo)
    alteracoes = audit.diff_campos(existing, novo, ["nome", "cor", "tipo"])
    if alteracoes:
        await audit.registar("crm_estado", eid, "editado", user,
                             f"Estado do funil «{novo['nome']}» editado", novo["nome"], alteracoes)
    return {**existing, **novo, "total_leads": await leads_repo.count({"estado_id": eid})}


@router.delete("/crm/estados/{eid}")
async def delete_estado(
    eid: str,
    mover_para: Optional[str] = Query(None, description="Estado para onde passam os leads deste estado"),
    user: dict = Depends(require_perm("crm", "delete")),
):
    existing = await crm_estados_repo.get(eid)
    if not existing:
        raise HTTPException(404, "Estado não encontrado")
    if await crm_estados_repo.count() <= 1:
        raise HTTPException(400, "O funil precisa de pelo menos um estado")
    n = await leads_repo.count({"estado_id": eid})
    if n:
        if not mover_para or mover_para == eid:
            raise HTTPException(400, f"Este estado tem {n} lead(s). Escolha para que estado passam.")
        destino = await _get_estado(mover_para)
        base = await _ordem_no_fim(destino["id"])
        leads = await leads_repo.find({"estado_id": eid}, sort=("ordem", 1), limit=10000)
        for i, lead in enumerate(leads):
            inter = _interacao_sistema(
                f"Estado: {existing['nome']} → {destino['nome']} (estado eliminado)", user)
            await leads_repo.col.update_one(
                {"id": lead["id"]},
                {"$set": {"estado_id": destino["id"], "ordem": base + i * ORDEM_PASSO,
                          "estado_desde": now_iso(), "updated_at": now_iso(), **_campos_fecho(destino)},
                 "$push": {"interacoes": inter}},
            )
    await crm_estados_repo.delete({"id": eid})
    await audit.registar("crm_estado", eid, "eliminado", user,
                         f"Estado do funil «{existing['nome']}» eliminado", existing["nome"])
    return {"ok": True, "leads_movidos": n}


# ----------------------------------------------------------------- leads
@router.get("/crm/leads")
async def list_leads(
    q: str = Query(""),
    origem: str = Query(""),
    responsavel_id: str = Query(""),
    estado_id: str = Query(""),
    _u: dict = Depends(require_perm("crm", "view")),
):
    query: dict = {}
    termo = (q or "").strip()
    if termo:
        # Igual ao resto do ERP: pesquisa pelo início do texto
        rx = {"$regex": "^" + re.escape(termo), "$options": "i"}
        query["$or"] = [{"nome": rx}, {"empresa": rx}, {"telefone": rx}, {"email": rx},
                        {"descricao": rx}, {"cliente_nome": rx}]
    if origem:
        query["origem"] = origem
    if responsavel_id:
        query["responsavel_id"] = responsavel_id
    if estado_id:
        query["estado_id"] = estado_id
    from app.core.security import filtro_proprios
    fp = await filtro_proprios(_u, "crm")
    if fp:
        query = {"$and": [query, fp]} if query else fp
    estados = {e["id"]: e for e in await _estados()}
    leads = await leads_repo.find(query, sort=("ordem", 1), limit=5000)
    out = []
    for lead in leads:
        p = _lead_publico(lead, estados)
        # A listagem não precisa do histórico completo
        p["num_interacoes"] = len(p.pop("interacoes", []))
        p["num_orcamentos"] = len(p.get("orcamento_ids") or [])
        out.append(p)
    return out


@router.get("/crm/leads/{lid}")
async def get_lead(lid: str, _u: dict = Depends(require_perm("crm", "view"))):
    lead = await _get_lead(lid)
    from app.core.security import assert_proprio
    await assert_proprio(_u, "crm", lead)
    estados = {e["id"]: e for e in await _estados()}
    out = _lead_publico(lead, estados)
    orcs = []
    for oid in out["orcamento_ids"]:
        o = await orcamentos_repo.get(oid)
        if not o:
            continue
        o = compute_orcamento_totais(o)
        orcs.append({"id": o["id"], "numero": o.get("numero") or "", "status": o.get("status"),
                     "total": o.get("total"), "data": o.get("data"), "descricao": o.get("descricao", "")})
    out["orcamentos"] = sorted(orcs, key=lambda x: x.get("data") or "", reverse=True)
    return out


@router.post("/crm/leads")
async def create_lead(data: LeadInput, user: dict = Depends(require_perm("crm", "create"))):
    payload = await campos_svc.aplicar("crm", data.model_dump(), "criar")
    estado = await _get_estado(payload["estado_id"]) if payload.get("estado_id") else \
        await _get_estado(await _estado_inicial_id())
    ts = now_iso()
    lead = {
        **payload,
        "id": new_id(),
        "estado_id": estado["id"],
        "ordem": await _ordem_no_fim(estado["id"]),
        "responsavel_nome": await _nome_responsavel(payload.get("responsavel_id")),
        "cliente_id": None,
        "cliente_nome": "",
        "orcamento_ids": [],
        "interacoes": [_interacao_sistema(f"Lead criado em «{estado['nome']}»", user)],
        "criado_por_id": user.get("id"),
        "criado_por_nome": _nome_user(user),
        "created_at": ts,
        "updated_at": ts,
        "estado_desde": ts,
        **_campos_fecho(estado),
    }
    await leads_repo.insert(lead)
    await audit.registar("lead", lead["id"], "criado", user, f"Lead «{_titulo_lead(lead)}» criado", _titulo_lead(lead))
    return await get_lead(lead["id"], user)


@router.put("/crm/leads/{lid}")
async def update_lead(lid: str, data: LeadInput, user: dict = Depends(require_perm("crm", "edit"))):
    existing = await _get_lead(lid)
    novo = await campos_svc.aplicar("crm", data.model_dump(), "guardar", existing)
    patch = dict(novo)
    patch["estado_id"] = novo.get("estado_id") or existing.get("estado_id")
    patch["responsavel_nome"] = await _nome_responsavel(novo.get("responsavel_id"))
    push = []
    if patch["estado_id"] != existing.get("estado_id"):
        antes = await crm_estados_repo.get(existing.get("estado_id") or "") or {}
        depois = await _get_estado(patch["estado_id"])
        patch["ordem"] = await _ordem_no_fim(depois["id"], lid)
        patch["estado_desde"] = now_iso()
        patch.update(_campos_fecho(depois))
        push.append(_interacao_sistema(f"Estado: {antes.get('nome', '—')} → {depois['nome']}", user))
    patch["updated_at"] = now_iso()
    upd = {"$set": patch}
    if push:
        upd["$push"] = {"interacoes": {"$each": push}}
    await leads_repo.col.update_one({"id": lid}, upd)
    alteracoes = audit.diff_campos(existing, patch, _LEAD_CAMPOS)
    if alteracoes:
        await audit.registar("lead", lid, "editado", user, f"Lead «{_titulo_lead(patch)}» editado",
                             _titulo_lead(patch), alteracoes)
    return await get_lead(lid, user)


@router.post("/crm/leads/{lid}/mover")
async def mover_lead(lid: str, data: MoverLeadInput, user: dict = Depends(require_perm("crm", "edit"))):
    """Arrastar no kanban: muda de estado e/ou de posição dentro da coluna."""
    lead = await _get_lead(lid)
    destino = await _get_estado(data.estado_id)
    if data.antes_de_id:
        ordem = await _ordem_antes_de(destino["id"], data.antes_de_id, lid)
    else:
        ordem = await _ordem_no_fim(destino["id"], lid)
    patch = {"estado_id": destino["id"], "ordem": ordem, "updated_at": now_iso()}
    upd: dict = {"$set": patch}
    if destino["id"] != lead.get("estado_id"):
        antes = await crm_estados_repo.get(lead.get("estado_id") or "") or {}
        patch["estado_desde"] = now_iso()
        patch.update(_campos_fecho(destino))
        upd["$push"] = {"interacoes": _interacao_sistema(
            f"Estado: {antes.get('nome', '—')} → {destino['nome']}", user)}
        await audit.registar("lead", lid, "estado_alterado", user,
                             f"Lead «{_titulo_lead(lead)}»: {antes.get('nome', '—')} → {destino['nome']}",
                             _titulo_lead(lead))
    await leads_repo.col.update_one({"id": lid}, upd)
    return {"ok": True, "estado_id": destino["id"], "ordem": ordem}


@router.post("/crm/leads/{lid}/interacoes")
async def add_interacao(lid: str, data: InteracaoInput, user: dict = Depends(require_perm("crm", "edit"))):
    await _get_lead(lid)
    ts = now_iso()
    inter = {
        "id": new_id(), "tipo": data.tipo, "texto": data.texto, "at": data.at or ts,
        "created_at": ts, "autor_id": user.get("id"), "autor_nome": _nome_user(user),
    }
    await leads_repo.col.update_one({"id": lid}, {"$push": {"interacoes": inter}, "$set": {"updated_at": ts}})
    return inter


@router.delete("/crm/leads/{lid}/interacoes/{iid}")
async def delete_interacao(lid: str, iid: str, _u: dict = Depends(require_perm("crm", "edit"))):
    lead = await _get_lead(lid)
    inter = next((i for i in lead.get("interacoes") or [] if i.get("id") == iid), None)
    if not inter:
        raise HTTPException(404, "Interação não encontrada")
    if inter.get("tipo") == "sistema":
        raise HTTPException(400, "Os registos automáticos não podem ser apagados")
    await leads_repo.col.update_one({"id": lid}, {"$pull": {"interacoes": {"id": iid}}})
    return {"ok": True}


@router.post("/crm/leads/{lid}/converter")
async def converter_lead(lid: str, data: ConverterLeadInput, user: dict = Depends(require_perm("crm", "edit"))):
    """Associa o lead a um cliente existente ou cria um cliente novo com os dados do lead."""
    lead = await _get_lead(lid)
    if data.cliente_id:
        cliente = await clientes_repo.get(data.cliente_id)
        if not cliente:
            raise HTTPException(404, "Cliente não encontrado")
        texto = f"Associado ao cliente «{cliente.get('nome')}»"
    elif data.cliente:
        await _check_perm(user, "clientes", "create")
        try:
            payload = ClienteInput(**data.cliente).model_dump()
        except ValidationError as e:
            msg = (e.errors() or [{}])[0].get("msg") or "Dados do cliente inválidos"
            raise HTTPException(400, msg.replace("Value error, ", ""))
        payload["sistema"] = False
        payload["is_default"] = False
        c = Cliente(**payload)
        c.codigo = await next_codigo("cliente")
        cliente = c.model_dump()
        await clientes_repo.insert(cliente)
        cliente.pop("_id", None)
        await audit.registar("cliente", c.id, "criado", user,
                             f"Cliente «{c.nome}» criado a partir do CRM", c.codigo or c.nome)
        texto = f"Convertido em cliente «{c.nome}» ({c.codigo})"
    else:
        raise HTTPException(400, "Escolha um cliente existente ou preencha os dados do novo cliente")
    ts = now_iso()
    await leads_repo.col.update_one(
        {"id": lid},
        {"$set": {"cliente_id": cliente["id"], "cliente_nome": cliente.get("nome", ""), "updated_at": ts},
         "$push": {"interacoes": _interacao_sistema(texto, user)}},
    )
    await audit.registar("lead", lid, "convertido", user, f"Lead «{_titulo_lead(lead)}»: {texto}", _titulo_lead(lead))
    return await get_lead(lid, user)


@router.post("/crm/leads/{lid}/desassociar-cliente")
async def desassociar_cliente(lid: str, user: dict = Depends(require_perm("crm", "edit"))):
    lead = await _get_lead(lid)
    if not lead.get("cliente_id"):
        return await get_lead(lid, user)
    await leads_repo.col.update_one(
        {"id": lid},
        {"$set": {"cliente_id": None, "cliente_nome": "", "updated_at": now_iso()},
         "$push": {"interacoes": _interacao_sistema(
             f"Desassociado do cliente «{lead.get('cliente_nome') or ''}»", user)}},
    )
    return await get_lead(lid, user)


@router.post("/crm/leads/{lid}/orcamentos")
async def ligar_orcamento(lid: str, data: LigarOrcamentoInput, user: dict = Depends(require_perm("crm", "edit"))):
    lead = await _get_lead(lid)
    orc = await orcamentos_repo.get(data.orcamento_id)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if data.orcamento_id in (lead.get("orcamento_ids") or []):
        return await get_lead(lid, user)
    ref = orc.get("numero") or "rascunho"
    await leads_repo.col.update_one(
        {"id": lid},
        {"$addToSet": {"orcamento_ids": data.orcamento_id},
         "$push": {"interacoes": _interacao_sistema(f"Orçamento {ref} associado", user)},
         "$set": {"updated_at": now_iso()}},
    )
    await orcamentos_repo.update(data.orcamento_id, {"lead_id": lid})
    return await get_lead(lid, user)


@router.delete("/crm/leads/{lid}")
async def delete_lead(lid: str, user: dict = Depends(require_perm("crm", "delete"))):
    lead = await _get_lead(lid)
    await leads_repo.delete({"id": lid})
    await audit.registar("lead", lid, "eliminado", user, f"Lead «{_titulo_lead(lead)}» eliminado", _titulo_lead(lead))
    return {"ok": True}
