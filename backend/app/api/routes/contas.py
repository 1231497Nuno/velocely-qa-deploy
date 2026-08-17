"""Contas a pagar e a receber — controlo independente do módulo de faturas."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.core.database import new_id, now_iso, round2
from app.core.pagination import parse_page, page_payload, text_search
from app.core.security import require_perm
from app.domain.models import CONTA_ESTADO_PT, CONTA_TIPO_PT, Conta, ContaAnexo, ContaInput
from app.repositories import contas_repo
from app.services import audit
from app.services.numeracao import next_codigo
from app.api.routes.uploads import store_upload

router = APIRouter()

_TIPOS = set(CONTA_TIPO_PT)
_ESTADOS = set(CONTA_ESTADO_PT)
_CAMPOS = [
    "tipo", "entidade", "entidade_tipo", "entidade_id", "descricao", "referencia",
    "data", "vencimento", "valor", "valor_pago", "metodo", "notas", "estado",
]


def _estado_de(valor: float, valor_pago: float, estado: str = "pendente") -> str:
    if estado == "anulada":
        return "anulada"
    if valor_pago <= 0:
        return "pendente"
    if valor_pago + 0.005 >= valor:
        return "liquidada"
    return "parcial"


def enrich_conta(c: dict) -> dict:
    valor = round2(float(c.get("valor") or 0))
    pago = round2(float(c.get("valor_pago") or 0))
    estado = _estado_de(valor, pago, c.get("estado") or "pendente")
    pendente = 0.0 if estado == "anulada" else round2(max(0.0, valor - pago))
    c["valor"] = valor
    c["valor_pago"] = pago
    c["estado"] = estado
    c["valor_pendente"] = pendente
    return c


def _normalizar(data: dict) -> dict:
    tipo = data.get("tipo") or "receber"
    if tipo not in _TIPOS:
        raise HTTPException(400, f"Tipo inválido. Use: {', '.join(CONTA_TIPO_PT)}")
    data["tipo"] = tipo
    valor = round2(float(data.get("valor") or 0))
    if valor <= 0:
        raise HTTPException(400, "Indique um valor maior do que zero")
    pago = round2(float(data.get("valor_pago") or 0))
    if pago < 0:
        raise HTTPException(400, "O valor pago não pode ser negativo")
    if pago > valor:
        pago = valor
    estado = data.get("estado") or "pendente"
    if estado not in _ESTADOS:
        raise HTTPException(400, f"Estado inválido. Use: {', '.join(CONTA_ESTADO_PT)}")
    data["valor"] = valor
    data["valor_pago"] = pago
    data["estado"] = _estado_de(valor, pago, estado)
    data["entidade"] = (data.get("entidade") or "").strip()
    if not data["entidade"]:
        raise HTTPException(400, "Indique a entidade (cliente, fornecedor ou outro)")
    if not (data.get("data") or "").strip():
        data["data"] = date.today().isoformat()
    return data


@router.get("/contas")
async def list_contas(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    tipo: str = Query(""),
    estado: str = Query(""),
    _u: dict = Depends(require_perm("contas", "view")),
):
    query: dict = {}
    ts = text_search(["numero", "entidade", "descricao", "referencia"], q)
    if ts:
        query.update(ts)
    if tipo in _TIPOS:
        query["tipo"] = tipo
    if estado in _ESTADOS:
        query["estado"] = estado
    if page is None:
        items = await contas_repo.find(query, sort=("created_at", -1), limit=5000)
        return [enrich_conta(c) for c in items]
    import asyncio
    p, ps, skip = parse_page(page, page_size)
    total, items = await asyncio.gather(
        contas_repo.count(query),
        contas_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip),
    )
    return page_payload([enrich_conta(c) for c in items], total, p, ps)


@router.get("/contas/{cid}")
async def get_conta(cid: str, _u: dict = Depends(require_perm("contas", "view"))):
    c = await contas_repo.get(cid)
    if not c:
        raise HTTPException(404, "Conta não encontrada")
    return enrich_conta(c)


@router.post("/contas")
async def create_conta(
    data: ContaInput,
    user: dict = Depends(require_perm("contas", "create")),
):
    payload = data.model_dump()
    payload["anexos"] = []
    payload = _normalizar(payload)
    conta = Conta(**payload)
    chave = "conta_receber" if conta.tipo == "receber" else "conta_pagar"
    conta.numero = await next_codigo(chave)
    dumped = conta.model_dump()
    dumped = enrich_conta(dumped)
    await contas_repo.insert(dumped)
    await audit.registar(
        "conta", conta.id, "criado", user,
        f"Conta {conta.numero} ({CONTA_TIPO_PT.get(conta.tipo, conta.tipo)}) · {conta.entidade}",
        conta.numero,
    )
    return dumped


@router.put("/contas/{cid}")
async def update_conta(
    cid: str,
    data: ContaInput,
    user: dict = Depends(require_perm("contas", "edit")),
):
    existing = await contas_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Conta não encontrada")
    patch = data.model_dump(exclude_unset=True)
    patch.pop("anexos", None)
    patch = {k: patch[k] for k in _CAMPOS if k in patch}
    if not patch:
        return enrich_conta(existing)
    merged = {**existing, **patch}
    merged = _normalizar(merged)
    merged["anexos"] = existing.get("anexos") or []
    merged["numero"] = existing.get("numero") or ""
    merged["id"] = cid
    merged["created_at"] = existing.get("created_at")
    merged = enrich_conta(merged)
    await contas_repo.update(cid, {k: merged[k] for k in _CAMPOS})
    alteracoes = audit.diff_campos(existing, merged, _CAMPOS)
    if existing.get("estado") != merged.get("estado"):
        await audit.registar(
            "conta", cid, "estado_alterado", user,
            f"Conta {existing.get('numero')} → {CONTA_ESTADO_PT.get(merged.get('estado'), merged.get('estado'))}",
            existing.get("numero"),
        )
    elif alteracoes:
        await audit.registar(
            "conta", cid, "editado", user,
            f"Conta {existing.get('numero')} editada",
            existing.get("numero"),
            alteracoes,
        )
    return merged


@router.post("/contas/{cid}/anular")
async def anular_conta(cid: str, user: dict = Depends(require_perm("contas", "edit"))):
    existing = await contas_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Conta não encontrada")
    if existing.get("estado") == "anulada":
        return enrich_conta(existing)
    await contas_repo.update(cid, {"estado": "anulada"})
    await audit.registar(
        "conta", cid, "estado_alterado", user,
        f"Conta {existing.get('numero')} anulada",
        existing.get("numero"),
    )
    return enrich_conta({**existing, "estado": "anulada"})


@router.post("/contas/{cid}/anexos")
async def add_anexo(
    cid: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_perm("contas", "edit")),
):
    existing = await contas_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Conta não encontrada")
    stored = await store_upload(file)
    anexo = ContaAnexo(
        id=new_id(),
        nome=stored["nome"] or "documento",
        path=stored["path"],
        content_type=stored["content_type"],
        size=stored["size"],
        created_at=now_iso(),
    ).model_dump()
    anexos = list(existing.get("anexos") or [])
    anexos.append(anexo)
    await contas_repo.update(cid, {"anexos": anexos})
    await audit.registar(
        "conta", cid, "anexo", user,
        f"Documento «{anexo['nome']}» associado à conta {existing.get('numero')}",
        existing.get("numero"),
    )
    return enrich_conta({**existing, "anexos": anexos})


@router.delete("/contas/{cid}/anexos/{aid}")
async def delete_anexo(
    cid: str,
    aid: str,
    user: dict = Depends(require_perm("contas", "edit")),
):
    existing = await contas_repo.get(cid)
    if not existing:
        raise HTTPException(404, "Conta não encontrada")
    anexos = list(existing.get("anexos") or [])
    found = next((a for a in anexos if a.get("id") == aid), None)
    if not found:
        raise HTTPException(404, "Documento não encontrado")
    anexos = [a for a in anexos if a.get("id") != aid]
    await contas_repo.update(cid, {"anexos": anexos})
    await audit.registar(
        "conta", cid, "anexo", user,
        f"Documento «{found.get('nome') or ''}» removido da conta {existing.get('numero')}",
        existing.get("numero"),
    )
    return enrich_conta({**existing, "anexos": anexos})


@router.delete("/contas/{cid}")
async def delete_conta(cid: str, user: dict = Depends(require_perm("contas", "delete"))):
    existing = await contas_repo.get(cid)
    await contas_repo.delete({"id": cid})
    if existing:
        await audit.registar(
            "conta", cid, "eliminado", user,
            f"Conta {existing.get('numero')} eliminada",
            existing.get("numero"),
        )
    return {"ok": True}
