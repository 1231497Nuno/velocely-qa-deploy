from io import BytesIO
from typing import Optional
import copy
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.database import now_iso, new_id, next_sequence, round2
from app.core.security import get_current_user, require_perm
from app.core.pagination import parse_page, page_payload, text_search, apply_status_filter
from app.domain.models import OrcamentoInput, Orcamento, Encomenda, STATUS_PT
from app.repositories import orcamentos_repo, encomendas_repo, empresa_repo
from app.services.costing import (
    compute_orcamento_totais, fill_linha_custos, fill_materiais, compute_encomenda,
)
from app.services.pdf import load_pdf_config, fetch_cliente, build_orcamento_pdf
from app.services import audit
from app.services import email as email_service
from app.services import cliente_default as cliente_default_svc
from app.services import contactos as contactos_svc

_ORC_CAMPOS = [
    "cliente", "descricao", "numero_encomenda", "validade", "margem", "notas", "desconto_total",
    "portes", "contacto_id", "contacto_nome",
]

# Estados em que a grelha/conteúdo comercial é editável
_EDITAVEL = ("rascunho", "negociado")

router = APIRouter()


def _linha_pronta(l: dict) -> bool:
    if not l:
        return False
    if l.get("artigo_id"):
        return True
    if (l.get("tipo_linha") == "descritor" or l.get("descricao_livre")) and (l.get("artigo_nome") or "").strip():
        return True
    return bool((l.get("artigo_nome") or "").strip())


def _tem_numero(orc: dict) -> bool:
    return bool((orc.get("numero") or "").strip())


def _status(orc_or_s) -> str:
    s = orc_or_s.get("status") if isinstance(orc_or_s, dict) else orc_or_s
    if s == "finalizado":
        return "criado"
    if s == "aceite":
        return "ganho"
    if s == "rejeitado":
        return "perdido"
    return s or "rascunho"


def _is_ganho(orc) -> bool:
    return _status(orc) == "ganho"


def _versao(orc: dict) -> int:
    v = orc.get("versao")
    try:
        v = int(v or 0)
    except (TypeError, ValueError):
        v = 0
    if v > 0:
        return v
    return 1 if _tem_numero(orc) else 0


def _numero_label(orc: dict) -> str:
    n = (orc.get("numero") or "").strip()
    if not n:
        return "Rascunho"
    v = _versao(orc)
    return f"{n} V{v}" if v > 1 else n


def _snapshot(orc: dict) -> dict:
    tot = compute_orcamento_totais(copy.deepcopy(orc))
    return {
        "versao": _versao(orc),
        "label": _numero_label(orc),
        "data": now_iso(),
        "cliente": orc.get("cliente"),
        "cliente_id": orc.get("cliente_id"),
        "descricao": orc.get("descricao"),
        "numero_encomenda": orc.get("numero_encomenda"),
        "validade": orc.get("validade"),
        "linhas": copy.deepcopy(orc.get("linhas") or []),
        "materiais": copy.deepcopy(orc.get("materiais") or []),
        "desconto_total": orc.get("desconto_total") or 0,
        "desconto_total_tipo": orc.get("desconto_total_tipo") or "pct",
        "portes": orc.get("portes") or 0,
        "notas": orc.get("notas") or "",
        "imagens": list(orc.get("imagens") or []),
        "anexos": copy.deepcopy(orc.get("anexos") or []),
        "total": tot.get("total"),
        "lucro": tot.get("lucro"),
        "margem_pct": tot.get("margem_pct"),
        "status": _status(orc),
    }


def _preco_linha_efectivo(l: dict) -> float:
    """Preço unitário comercial da linha (o que o cliente vê / deve ir para a ENC)."""
    if not l:
        return 0.0
    origem = (l.get("preco_origem") or "").strip().lower()
    if l.get("preco_unit_manual") or origem == "manual":
        return round2(float(l.get("preco_unit") or 0))
    cat = l.get("preco_venda_catalogo")
    if cat is not None and cat != "":
        try:
            v = float(cat)
            if v > 0:
                return round2(v)
        except (TypeError, ValueError):
            pass
    if origem == "calculado":
        custo = float(l.get("custo_producao_unit") or 0)
        margem = float(l.get("margem") or 0)
        if custo > 0:
            return round2(custo * (1 + margem / 100.0))
    return round2(float(l.get("preco_unit") or 0))


def _sincronizar_precos_linhas(linhas: list) -> list:
    """Garante que preco_unit = preço efectivo (catalogo/calculado/manual)."""
    out = []
    for l in linhas or []:
        row = dict(l)
        row["preco_unit"] = _preco_linha_efectivo(row)
        out.append(row)
    return out


def _congelar_custos(linhas: list) -> list:
    out = []
    for l in _sincronizar_precos_linhas(linhas or []):
        row = dict(l)
        row["custo_congelado"] = True
        out.append(row)
    return out


def _descongelar_custos(linhas: list) -> list:
    out = []
    for l in linhas or []:
        row = dict(l)
        row["custo_congelado"] = False
        out.append(row)
    return out


async def _validade_default(data_ymd: str) -> str:
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    dias = int(settings.get("orcamento_validade_dias") or 15)
    try:
        base = date.fromisoformat(data_ymd[:10])
    except Exception:
        base = date.fromisoformat(_hoje())
    return (base + timedelta(days=max(1, dias))).isoformat()


def _orc_editavel(orc: dict) -> bool:
    return _status(orc) in _EDITAVEL


async def _margem_minima() -> float:
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    return float(settings.get("margem_risco_pct") if settings.get("margem_risco_pct") is not None else 20)


def _ymd(v) -> str:
    s = str(v or "").strip()[:10]
    return s if len(s) == 10 and s[4] == "-" else ""


def _hoje() -> str:
    try:
        return datetime.now(ZoneInfo("Europe/Lisbon")).date().isoformat()
    except Exception:
        return datetime.now().date().isoformat()


def requisitos_datas(orc: dict, *, ao_finalizar: bool = False) -> list[str]:
    faltas = []
    data = _ymd(orc.get("data"))
    validade = _ymd(orc.get("validade"))
    if data and validade and validade < data:
        faltas.append("A validade não pode ser anterior à data do orçamento")
    if ao_finalizar:
        hoje = _hoje()
        if not data:
            faltas.append("Indique a data do orçamento")
        elif data != hoje:
            faltas.append("A data do orçamento tem de ser o dia de hoje")
        if not validade:
            faltas.append("Indique a validade do orçamento")
    return faltas


def requisitos_finalizar(orc: dict) -> list[str]:
    faltas = []
    if not (orc.get("cliente_id") or (orc.get("cliente") or "").strip()):
        faltas.append("Indique o cliente para finalizar o orçamento")
    if not any(_linha_pronta(l) for l in orc.get("linhas") or []):
        faltas.append("Adicione pelo menos uma linha para finalizar o orçamento")
    faltas.extend(requisitos_datas(orc, ao_finalizar=True))
    return faltas


def orc_expirado(orc: dict) -> bool:
    validade = _ymd(orc.get("validade"))
    if not validade:
        return False
    return validade < _hoje()


def requisitos_encomenda(orc: dict) -> list[str]:
    """Lista de bloqueios (vazia = pode criar encomenda)."""
    faltas = []
    if not _tem_numero(orc):
        faltas.append("Finalize o orçamento para obter o número")
    if not (orc.get("cliente_id") or (orc.get("cliente") or "").strip()):
        faltas.append("Selecione o cliente")
    linhas = orc.get("linhas") or []
    if not any(_linha_pronta(l) for l in linhas):
        faltas.append("Adicione pelo menos uma linha (artigo, serviço ou descritor)")
    if not _is_ganho(orc):
        faltas.append("O orçamento tem de estar Ganho")
    return faltas


class EnviarEmailBody(BaseModel):
    to: Optional[str] = None
    template_id: Optional[str] = None
    mensagem: str = Field(default="", max_length=2000)
    # Força envio apesar de margem crítica (< risco) — requer autorização
    autorizar_margem_baixa: bool = False


@router.get("/orcamentos")
async def list_orcamentos(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str = Query(""),
    status: Optional[str] = Query(None),
    encomenda_id: Optional[str] = Query(None),
    _u: dict = Depends(require_perm("orcamentos", "view")),
):
    query = {}
    apply_status_filter(query, status)
    if encomenda_id:
        query["encomenda_id"] = encomenda_id
    ts = text_search(["numero", "cliente", "numero_encomenda"], q)
    if ts:
        query.update(ts)
    if page is None:
        orcs = await orcamentos_repo.find(query, sort=("created_at", -1), limit=5000)
        return [compute_orcamento_totais(o) for o in orcs]
    p, ps, skip = parse_page(page, page_size)
    total = await orcamentos_repo.count(query)
    orcs = await orcamentos_repo.find(query, sort=("created_at", -1), limit=ps, skip=skip)
    return page_payload([compute_orcamento_totais(o) for o in orcs], total, p, ps)


@router.get("/orcamentos/{oid}")
async def get_orcamento(oid: str, _u: dict = Depends(require_perm("orcamentos", "view"))):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    tot = compute_orcamento_totais(o)
    tot["expirado"] = orc_expirado(o)
    return tot


@router.get("/orcamentos/{oid}/pdf")
async def orcamento_pdf(oid: str, template_id: Optional[str] = None, _u: dict = Depends(require_perm("orcamentos", "view"))):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    if not _tem_numero(o):
        raise HTTPException(400, "Finalize o orçamento antes de gerar o PDF.")
    o = compute_orcamento_totais(o)
    settings, fields, show_branding = await load_pdf_config(template_id)
    cliente = await fetch_cliente(o.get("cliente_id"))
    pdf = build_orcamento_pdf(o, settings, fields, show_branding, cliente)
    filename = f"{_numero_label(o).replace(' ', '-')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/orcamentos/{oid}/enviar-email", summary="Enviar orçamento por email ao cliente")
async def enviar_orcamento_email(
    oid: str,
    body: EnviarEmailBody = EnviarEmailBody(),
    user: dict = Depends(require_perm("orcamentos", "edit")),
):
    o = await orcamentos_repo.get(oid)
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    if not _tem_numero(o):
        raise HTTPException(400, "Finalize o orçamento antes de enviar. Só depois de finalizado recebe número.")
    o = compute_orcamento_totais(o)
    margem_min = await _margem_minima()
    margem = float(o.get("margem_pct") or 0)
    if margem < margem_min and not body.autorizar_margem_baixa:
        raise HTTPException(
            400,
            detail={
                "code": "margem_critica",
                "message": (
                    f"Margem {margem:.1f}% abaixo do mínimo ({margem_min:.0f}%). "
                    "Peça autorização superior para enviar ao cliente."
                ),
                "margem_pct": margem,
                "margem_minima": margem_min,
            },
        )
    cliente = await fetch_cliente(o.get("cliente_id"))
    to = contactos_svc.resolve_email_destinatario(
        o, cliente, explicit_to=body.to or "",
    )
    if not to or "@" not in to:
        raise HTTPException(400, "O cliente não tem email válido. Indique um destinatário ou actualize o cliente.")

    settings, fields, show_branding = await load_pdf_config(body.template_id)
    pdf = build_orcamento_pdf(o, settings, fields, show_branding, cliente)
    numero = o.get("numero") or "orcamento"
    total = o.get("total_com_iva") or o.get("total")
    total_str = f"{float(total):.2f} €".replace(".", ",") if total is not None else None
    subject, text, html = await email_service.orcamento_email(
        (cliente or {}).get("nome") or o.get("cliente") or "",
        numero,
        total=total_str,
        mensagem=body.mensagem or "",
    )
    ok, reason = email_service.send_email(
        to,
        subject,
        text,
        html=html,
        attach_logo=True,
        attachments=[(f"{numero}.pdf", pdf, "application/pdf")],
    )
    if not ok and reason == "no_smtp":
        raise HTTPException(503, "Envio de email não está configurado. Contacte o administrador.")
    if not ok:
        raise HTTPException(500, f"Não foi possível enviar o email: {reason}")

    novo_status = o.get("status")
    if _status(o) not in ("ganho", "perdido"):
        await orcamentos_repo.update(oid, {"status": "enviado"})
        novo_status = "enviado"
        if _status(o) != "enviado":
            await audit.registar(
                "orcamento", oid, "estado_alterado", user,
                f"Estado do orçamento {_numero_label(o)} → Enviado (email)", numero,
            )
    await audit.registar(
        "orcamento", oid, "email_enviado", user,
        f"Orçamento {_numero_label(o)} enviado por email para {email_service.mask_email(to)}", numero,
    )
    return {
        "ok": True,
        "email_sent": True,
        "email_masked": email_service.mask_email(to),
        "message": f"Orçamento enviado para {email_service.mask_email(to)}",
        "status": novo_status,
    }


@router.post("/orcamentos")
async def create_orcamento(data: OrcamentoInput, user: dict = Depends(require_perm("orcamentos", "create"))):
    o = Orcamento(**data.model_dump())
    o.numero = ""  # só no finalizar
    o.status = "rascunho"
    if not o.data:
        o.data = _hoje()
    if not o.validade:
        o.validade = await _validade_default(o.data)
    faltas = requisitos_datas(o.model_dump())
    if faltas:
        raise HTTPException(400, detail="; ".join(faltas))
    doc = o.model_dump()
    doc = await cliente_default_svc.apply_cliente_default(doc)
    doc = await contactos_svc.apply_contacto_denorm(doc)
    doc["materiais"] = fill_materiais(doc.get("materiais", []))
    doc["linhas"] = await fill_linha_custos(doc.get("linhas", []), doc.get("materiais", []))
    doc["updated_at"] = now_iso()
    await orcamentos_repo.insert(doc)
    doc.pop("_id", None)
    await audit.registar("orcamento", o.id, "criado", user, "Orçamento rascunho criado", "")
    return compute_orcamento_totais(doc)


@router.put("/orcamentos/{oid}")
async def update_orcamento(oid: str, data: OrcamentoInput, user: dict = Depends(require_perm("orcamentos", "edit"))):
    existing = await orcamentos_repo.get(oid)
    if not existing:
        raise HTTPException(404, "Orçamento não encontrado")
    update = data.model_dump()
    update.pop("anexos", None)
    # Número só no finalizar — nunca atribuir/alterar aqui
    update.pop("numero", None)
    if not _tem_numero(existing) and _status(update.get("status")) in (
        "enviado", "ganho", "perdido", "criado", "negociado",
    ):
        raise HTTPException(400, "Finalize o orçamento (obtém número) antes de alterar o estado")

    # Após enviado/criado/ganho/perdido: grelha bloqueada — só estado e metadados leves
    if not _orc_editavel(existing):
        for k in (
            "linhas", "materiais", "desconto_total", "desconto_total_tipo",
            "portes", "margem", "cliente", "cliente_id", "descricao",
            "numero_encomenda", "data", "validade",
            "contacto_id", "contacto_nome", "contacto_email",
            "contacto_telefone", "contacto_cargo", "contacto_departamento",
        ):
            if k in existing:
                update[k] = existing.get(k)
        # notas podem actualizar; status vem do body

    faltas = requisitos_datas(update)
    if faltas:
        raise HTTPException(400, detail="; ".join(faltas))
    update = await contactos_svc.apply_contacto_denorm(update)
    if _orc_editavel(existing):
        update["materiais"] = fill_materiais(update.get("materiais", []))
        update["linhas"] = await fill_linha_custos(update.get("linhas", []), update.get("materiais", []))
        # Fotografia de custos em cada gravação (versão negociada / rascunho com custos actuais)
        if _tem_numero(existing) or _status(existing) == "negociado":
            update["linhas"] = _congelar_custos(update["linhas"])
    update["updated_at"] = now_iso()
    alteracoes = audit.diff_campos(existing, update, _ORC_CAMPOS)
    estado_mudou = existing.get("status") != update.get("status")
    await orcamentos_repo.update(oid, update)
    existing.update(update)
    numero = existing.get("numero")
    if estado_mudou:
        await audit.registar(
            "orcamento", oid, "estado_alterado", user,
            f"Estado do orçamento {numero} → {STATUS_PT.get(data.status, data.status)}", numero,
        )
    if alteracoes:
        await audit.registar("orcamento", oid, "editado", user, f"Orçamento {numero or 'rascunho'} editado", numero, alteracoes)
    tot = compute_orcamento_totais(existing)
    tot["expirado"] = orc_expirado(existing)
    return tot


@router.delete("/orcamentos/{oid}")
async def delete_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "delete"))):
    existing = await orcamentos_repo.get(oid)
    await orcamentos_repo.delete({"id": oid})
    if existing:
        await audit.registar("orcamento", oid, "eliminado", user,
                             f"Orçamento {existing.get('numero')} eliminado", existing.get("numero"))
    return {"ok": True}


@router.post("/orcamentos/{oid}/duplicar")
async def duplicar_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "create"))):
    """Novo rascunho com a mesma estrutura e custos actualizados do catálogo."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    data_hoje = _hoje()
    novo = {**orc}
    novo.update({
        "id": new_id(),
        "numero": "",
        "status": "rascunho",
        "of_id": None,
        "of_numero": None,
        "encomenda_id": None,
        "encomenda_numero": None,
        "numero_encomenda": orc.get("numero_encomenda") or "",
        "versao": 0,
        "versoes": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "data": data_hoje,
        "validade": await _validade_default(data_hoje),
    })
    # Recalcular custos à data de hoje (estrutura mantida)
    novo["linhas"] = _descongelar_custos(copy.deepcopy(orc.get("linhas") or []))
    novo["materiais"] = fill_materiais(copy.deepcopy(orc.get("materiais") or []))
    novo["linhas"] = await fill_linha_custos(novo["linhas"], novo["materiais"])
    await orcamentos_repo.insert(novo)
    await audit.registar("orcamento", novo["id"], "duplicado", user,
                         f"Rascunho criado a partir de {orc.get('numero') or 'rascunho'}", "")
    return compute_orcamento_totais(novo)


@router.post("/orcamentos/{oid}/finalizar")
async def finalizar_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "edit"))):
    """Atribui número ORC-… e passa a Criado (pronto a enviar). Exige cliente."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if _tem_numero(orc):
        return compute_orcamento_totais(orc)
    if not _ymd(orc.get("validade")):
        orc["validade"] = await _validade_default(orc.get("data") or _hoje())
        await orcamentos_repo.update(oid, {"validade": orc["validade"]})
    faltas = requisitos_finalizar(orc)
    if faltas:
        raise HTTPException(400, detail="; ".join(faltas))
    numero = await next_sequence("ORC")
    # Fotografia de custos/preços — catálogo futuro não altera este ORC
    mats = fill_materiais(list(orc.get("materiais") or []))
    linhas = await fill_linha_custos(list(orc.get("linhas") or []), mats)
    linhas = _congelar_custos(linhas)
    patch = {
        "numero": numero, "status": "criado", "versao": 1,
        "linhas": linhas, "materiais": mats, "updated_at": now_iso(),
        "validade": orc.get("validade"),
    }
    await orcamentos_repo.update(oid, patch)
    orc.update(patch)
    await audit.registar(
        "orcamento", oid, "estado_alterado", user,
        f"Orçamento criado → {numero} (custos congelados)", numero,
    )
    return compute_orcamento_totais(orc)


@router.post("/orcamentos/{oid}/nova-versao")
@router.post("/orcamentos/{oid}/negociar")
async def nova_versao_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "edit"))):
    """Arquiva a versão actual e abre V2/V3… editável (protege histórico de negociação)."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if not _tem_numero(orc):
        raise HTTPException(400, "Finalize o orçamento antes de criar uma nova versão")
    if _is_ganho(orc) and orc.get("encomenda_id"):
        raise HTTPException(400, "Este orçamento já gerou encomenda")
    snap = _snapshot(orc)
    versoes = list(orc.get("versoes") or [])
    if not any(int(v.get("versao") or 0) == snap["versao"] for v in versoes):
        versoes.append(snap)
    nova = _versao(orc) + 1
    # Nova versão editável; custos da versão anterior ficam no snapshot
    linhas = _descongelar_custos(copy.deepcopy(orc.get("linhas") or []))
    linhas = await fill_linha_custos(linhas, orc.get("materiais") or [])
    patch = {
        "versoes": versoes,
        "versao": nova,
        "status": "negociado",
        "linhas": linhas,
        "updated_at": now_iso(),
    }
    await orcamentos_repo.update(oid, patch)
    orc.update(patch)
    label = _numero_label(orc)
    await audit.registar(
        "orcamento", oid, "estado_alterado", user,
        f"Nova versão {label} (anterior {snap['label']} arquivada)",
        orc.get("numero"),
    )
    return compute_orcamento_totais(orc)


@router.post("/orcamentos/{oid}/recalcular-custos")
async def recalcular_custos_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "edit"))):
    """Recalcula custos do catálogo actual (ex.: orçamento expirado). Só se editável."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if not _orc_editavel(orc):
        raise HTTPException(400, "Crie uma nova versão para recalcular os custos")
    linhas = _descongelar_custos(list(orc.get("linhas") or []))
    mats = fill_materiais(list(orc.get("materiais") or []))
    linhas = await fill_linha_custos(linhas, mats)
    if _tem_numero(orc):
        linhas = _congelar_custos(linhas)
    patch = {"linhas": linhas, "materiais": mats, "updated_at": now_iso()}
    await orcamentos_repo.update(oid, patch)
    orc.update(patch)
    await audit.registar(
        "orcamento", oid, "editado", user,
        f"Custos recalculados em {_numero_label(orc)}", orc.get("numero"),
    )
    return compute_orcamento_totais(orc)


@router.post("/orcamentos/{oid}/converter")
async def converter_orcamento(oid: str, user: dict = Depends(require_perm("orcamentos", "edit"))):
    """Converte o orçamento numa ENCOMENDA (as OFs são criadas depois a partir da encomenda)."""
    orc = await orcamentos_repo.get(oid)
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if orc.get("encomenda_id"):
        existing = await encomendas_repo.get(orc["encomenda_id"])
        if existing:
            return await compute_encomenda(existing)
    # Compatibilidade: orçamentos convertidos no fluxo antigo já têm encomenda associada
    ja = await encomendas_repo.find_one({"orcamento_id": oid})
    if ja:
        await orcamentos_repo.update(oid, {"encomenda_id": ja["id"], "encomenda_numero": ja.get("numero")})
        return await compute_encomenda(ja)

    faltas = requisitos_encomenda(orc)
    if faltas:
        raise HTTPException(400, detail="; ".join(faltas))

    # Valores comerciais exactos do orçamento (não editáveis depois na ENC)
    mats = fill_materiais(list(orc.get("materiais") or []))
    linhas = list(orc.get("linhas") or [])
    # Se ainda não estavam congeladas, calcula e sincroniza preços efectivos
    if not any(l.get("custo_congelado") for l in linhas):
        linhas = await fill_linha_custos(linhas, mats)
    linhas = _sincronizar_precos_linhas(linhas)
    orc = {**orc, "linhas": linhas, "materiais": mats}
    orc_t = compute_orcamento_totais(orc)
    enc_artigos = []
    for l in linhas:
        if not _linha_pronta(l):
            continue
        piso = _preco_linha_efectivo(l)
        enc_artigos.append({
            "id": new_id(),
            "artigo_id": l.get("artigo_id"),
            "artigo_nome": l.get("artigo_nome", ""),
            "imagem": l.get("imagem") or "",
            "quantidade": float(l.get("quantidade") or 1),
            "preco_unit": piso,
            "preco_unit_orcamento": piso,
            "desconto": float(l.get("desconto") or 0),
            "desconto_tipo": l.get("desconto_tipo") or "pct",
            "desconto_base": l.get("desconto_base") or "linha",
            "personalizacoes": [
                {
                    "id": p.get("id"),
                    "nome": p.get("nome") or "",
                    "valor": float(p.get("valor") or 0),
                    "tempo": float(p.get("tempo") or 0),
                }
                for p in (l.get("personalizacoes") or [])
                if isinstance(p, dict)
            ],
            "arte_path": l.get("arte_path") or "",
            "arte_nome": l.get("arte_nome") or "",
            "arte_content_type": l.get("arte_content_type") or "",
        })
    if not enc_artigos:
        raise HTTPException(400, "O orçamento não tem linhas prontas para encomenda")
    enc = Encomenda(
        cliente=orc.get("cliente", ""),
        cliente_id=orc.get("cliente_id"),
        contacto_id=orc.get("contacto_id"),
        contacto_nome=orc.get("contacto_nome") or "",
        contacto_email=orc.get("contacto_email") or "",
        contacto_telefone=orc.get("contacto_telefone") or "",
        contacto_cargo=orc.get("contacto_cargo") or "",
        contacto_departamento=orc.get("contacto_departamento") or "",
        descricao=orc.get("descricao", ""),
        referencia_cliente=orc.get("numero_encomenda") or "",
        data=now_iso()[:10],
        estado="aberta",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
        artigos=enc_artigos,
        imagens=orc.get("imagens") or [],
        anexos=list(orc.get("anexos") or []),
        desconto_total=float(orc.get("desconto_total") or 0),
        desconto_total_tipo=orc.get("desconto_total_tipo") or "pct",
        envio=float(orc.get("portes") or 0),
        valor_total=orc_t.get("total"),
        valor_total_manual=False,
    )
    enc.numero = await next_sequence("ENC")
    enc.orcamento_id = orc["id"]
    enc.orcamento_numero = orc.get("numero")
    await encomendas_repo.insert(enc.model_dump())
    await orcamentos_repo.update(oid, {"encomenda_id": enc.id, "encomenda_numero": enc.numero})
    await audit.registar("orcamento", oid, "convertido", user,
                         f"Orçamento {orc.get('numero')} convertido → Encomenda {enc.numero}", orc.get("numero"))
    await audit.registar("encomenda", enc.id, "criado", user,
                         f"Encomenda {enc.numero} gerada do orçamento {orc.get('numero')}", enc.numero)
    return await compute_encomenda(enc.model_dump())
