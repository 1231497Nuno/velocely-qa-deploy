from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ----------------------- Helpers -----------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


async def next_sequence(prefix: str) -> str:
    """Sequential numbering that resets per year, e.g. ORC-2026-0001."""
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}"
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = doc["seq"]
    return f"{prefix}-{year}-{seq:04d}"


def round2(v: float) -> float:
    return round(v + 1e-9, 2)


# ----------------------- Auth: JWT + RBAC -----------------------
import bcrypt
import jwt
from fastapi import Depends, Header

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


# Módulos e ações para RBAC
RBAC_MODULES = [
    "dashboard", "clientes", "encomendas", "artigos", "materiais", "maquinas", "mao_obra",
    "personalizacao", "orcamentos", "ordens_fabrico", "analise_producao", "utilizadores",
]
RBAC_ACTIONS = ["view", "create", "edit", "delete"]


def perms_all(value: bool) -> dict:
    return {m: {a: value for a in RBAC_ACTIONS} for m in RBAC_MODULES}


def perms_colaborador() -> dict:
    p = perms_all(False)
    for m in RBAC_MODULES:
        if m != "utilizadores":
            p[m]["view"] = True
    for m in ("orcamentos", "ordens_fabrico"):
        p[m]["create"] = True
        p[m]["edit"] = True
    for m in ("clientes", "encomendas"):
        p[m]["create"] = True
        p[m]["edit"] = True
    return p


async def resolve_perfil(user: dict) -> dict:
    perfil = None
    if user.get("perfil_id"):
        perfil = await db.perfis.find_one({"id": user["perfil_id"]}, {"_id": 0})
    if not perfil:
        if user.get("role") == "admin":
            perfil = await db.perfis.find_one({"sistema": True, "admin": True}, {"_id": 0})
        else:
            perfil = await db.perfis.find_one({"nome": "Colaborador", "sistema": True}, {"_id": 0})
    return perfil or {"nome": "Colaborador", "admin": False, "permissoes": perms_colaborador()}


async def user_public(u: dict) -> dict:
    perfil = await resolve_perfil(u)
    return {
        "id": u.get("id"),
        "email": u.get("email"),
        "name": u.get("name", ""),
        "role": "admin" if perfil.get("admin") else "colaborador",
        "perfil_id": u.get("perfil_id"),
        "perfil": {
            "id": perfil.get("id"),
            "nome": perfil.get("nome"),
            "admin": bool(perfil.get("admin")),
            "permissoes": perfil.get("permissoes") or perms_all(False),
        },
        "created_at": u.get("created_at"),
    }


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utilizador não encontrado")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    perfil = await resolve_perfil(user)
    can = perfil.get("admin") or (perfil.get("permissoes") or {}).get("utilizadores", {}).get("edit")
    if not can:
        raise HTTPException(status_code=403, detail="Sem permissão de gestão de utilizadores")
    return user


class LoginInput(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    email: str
    name: str = ""
    password: str
    perfil_id: Optional[str] = None
    role: str = "colaborador"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    perfil_id: Optional[str] = None
    role: Optional[str] = None


class PerfilInput(BaseModel):
    nome: str
    admin: bool = False
    permissoes: dict = Field(default_factory=lambda: perms_all(False))


auth_router = APIRouter(prefix="/api/auth")


@auth_router.post("/login")
async def login(data: LoginInput):
    email = (data.email or "").strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Email ou password incorretos")
    perfil = await resolve_perfil(user)
    role = "admin" if perfil.get("admin") else "colaborador"
    token = create_access_token(user["id"], user["email"], role)
    return {"token": token, "user": await user_public(user)}


@auth_router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return await user_public(user)



# ----------------------- Models -----------------------
class Maquina(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class MaquinaInput(BaseModel):
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0


class Consumivel(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    unidade: str = "un"
    custo_unitario: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class ConsumivelInput(BaseModel):
    nome: str
    unidade: str = "un"
    custo_unitario: float = 0.0


class MaoObra(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    custo_hora: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class MaoObraInput(BaseModel):
    nome: str
    custo_hora: float = 0.0


class ArtigoMaterial(BaseModel):
    id: str = Field(default_factory=new_id)
    material_id: str
    material_nome: str = ""
    unidade: str = ""
    quantidade: float = 0.0
    custo_unitario: float = 0.0


class Operacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = ""
    maquina_id: Optional[str] = None
    maquina_nome: Optional[str] = None
    tempo_maquina: float = 0.0
    tempo_maquina_unidade: str = "min"
    mao_obra_id: Optional[str] = None
    mao_obra_nome: Optional[str] = None
    tempo_mao_obra: float = 0.0
    tempo_mao_obra_unidade: str = "min"


class Artigo(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    descricao: str = ""
    custo_artigo: float = 0.0
    margem: float = 30.0
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class ArtigoInput(BaseModel):
    nome: str
    descricao: str = ""
    custo_artigo: float = 0.0
    margem: float = 30.0
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)


class TipoPersonalizacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    descricao: str = ""
    valor: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class TipoPersonalizacaoInput(BaseModel):
    nome: str
    descricao: str = ""
    valor: float = 0.0


class PersonalizacaoSel(BaseModel):
    id: Optional[str] = None
    nome: str = ""
    valor: float = 0.0


class OrcamentoLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    quantidade: float = 1
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    valor_personalizacao: float = 0.0
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    custo_base_unit: Optional[float] = None
    margem: Optional[float] = None
    roteiro: List[Operacao] = Field(default_factory=list)
    custo_producao_unit: float = 0.0
    preco_unit: float = 0.0


class MaterialLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    consumivel_id: Optional[str] = None
    nome: str = ""
    unidade: str = "un"
    custo_unitario: float = 0.0
    quantidade: float = 1
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    margem: float = 50.0
    custo: float = 0.0
    valor: float = 0.0


class ClienteInput(BaseModel):
    nome: str
    morada: str = ""
    codigo_postal: str = ""
    cidade: str = ""
    pais: str = "Portugal"
    contacto: str = ""
    email: str = ""
    nif: str = ""
    notas: str = ""


class Cliente(ClienteInput):
    id: str = Field(default_factory=new_id)
    created_at: str = Field(default_factory=now_iso)


class OrcamentoInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    validade: Optional[str] = None
    status: str = "rascunho"
    margem: float = 0.0
    notas: str = ""
    linhas: List[OrcamentoLinha] = Field(default_factory=list)
    materiais: List[MaterialLinha] = Field(default_factory=list)


class Orcamento(OrcamentoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    of_id: Optional[str] = None
    of_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class OFOperacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    maquina_nome: Optional[str] = None
    mao_obra_nome: Optional[str] = None
    tempo_maquina: float = 0.0
    tempo_mao_obra: float = 0.0
    tempo_min: float = 0.0
    custo_estimado: float = 0.0
    timer_inicio: Optional[str] = None
    tempo_real_seg: float = 0.0
    concluida: bool = False


class OFItem(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    quantidade: float = 1
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    operacoes: List[OFOperacao] = Field(default_factory=list)


class OrdemFabricoInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    encomenda_id: Optional[str] = None
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    status: str = "pendente"
    notas: str = ""
    itens: List[OFItem] = Field(default_factory=list)


class OrdemFabrico(OrdemFabricoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    encomenda_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class EncomendaArtigo(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: Optional[str] = None
    artigo_nome: str = ""
    quantidade: float = 1
    preco_unit: float = 0.0
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)


class EncomendaInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    descricao: str = ""
    data: Optional[str] = None
    estado: str = "aberta"
    notas: str = ""
    artigos: List[EncomendaArtigo] = Field(default_factory=list)
    valor_total: Optional[float] = None
    valor_total_manual: bool = False
    valor_pago: float = 0.0
    autorizada_producao: bool = False


class Encomenda(EncomendaInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Cost computation -----------------------
def to_minutes(val, unidade) -> float:
    val = val or 0
    return val * 60.0 if unidade == "h" else val


def maquina_custo_hora(m: Optional[dict]) -> float:
    if not m:
        return 0.0
    if "custo_amortizacao_hora" in m or "custo_energia_hora" in m:
        return (m.get("custo_amortizacao_hora") or 0) + (m.get("custo_energia_hora") or 0)
    return m.get("custo_hora") or 0


def op_minutos_maquina(op: dict) -> float:
    if "tempo_maquina" in op:
        return to_minutes(op.get("tempo_maquina"), op.get("tempo_maquina_unidade", "min"))
    return op.get("min_maquina") or 0


def op_minutos_mao_obra(op: dict) -> float:
    if "tempo_mao_obra" in op:
        return to_minutes(op.get("tempo_mao_obra"), op.get("tempo_mao_obra_unidade", "min"))
    return op.get("min_mao_obra") or 0


async def artigo_breakdown(artigo: dict) -> dict:
    custo_materiais = 0.0
    cons_cache = {}
    for mat in artigo.get("materiais", []):
        cid = mat.get("material_id")
        custo_unit = mat.get("custo_unitario") or 0
        if cid:
            if cid not in cons_cache:
                c = await db.consumiveis.find_one({"id": cid}, {"_id": 0})
                cons_cache[cid] = c.get("custo_unitario") if c else None
            if cons_cache[cid] is not None:
                custo_unit = cons_cache[cid]
        custo_materiais += (mat.get("quantidade") or 0) * custo_unit

    custo_maquinas = 0.0
    custo_mao_obra = 0.0
    maq_cache = {}
    mo_cache = {}
    for op in artigo.get("roteiro", []):
        mid = op.get("maquina_id")
        if mid:
            if mid not in maq_cache:
                m = await db.maquinas.find_one({"id": mid}, {"_id": 0})
                maq_cache[mid] = maquina_custo_hora(m)
            custo_maquinas += (op_minutos_maquina(op) / 60.0) * maq_cache[mid]
        moid = op.get("mao_obra_id")
        if moid:
            if moid not in mo_cache:
                mo = await db.mao_obra.find_one({"id": moid}, {"_id": 0})
                mo_cache[moid] = (mo or {}).get("custo_hora", 0.0)
            custo_mao_obra += (op_minutos_mao_obra(op) / 60.0) * mo_cache[moid]

    custo_materiais = round2(custo_materiais)
    custo_maquinas = round2(custo_maquinas)
    custo_mao_obra = round2(custo_mao_obra)
    custo_artigo = round2(artigo.get("custo_artigo") or 0)
    custo_total = round2(custo_artigo + custo_materiais + custo_maquinas + custo_mao_obra)
    margem = artigo.get("margem")
    if margem is None:
        margem = 30.0
    return {
        "custo_artigo": custo_artigo,
        "custo_materiais": custo_materiais,
        "custo_maquinas": custo_maquinas,
        "custo_mao_obra": custo_mao_obra,
        "custo_producao_total": custo_total,
        "preco_venda": round2(custo_total * (1 + margem / 100.0)),
    }


async def artigo_custo_total(artigo: dict) -> float:
    return (await artigo_breakdown(artigo))["custo_producao_total"]


def enrich_artigo(artigo: dict, breakdown: dict) -> dict:
    return {**artigo, **breakdown}


def pers_valor_unit(l: dict) -> float:
    ps = l.get("personalizacoes")
    if ps:
        return sum((p.get("valor") or 0) for p in ps)
    return l.get("valor_personalizacao") or 0


def pers_nomes(l: dict) -> str:
    ps = l.get("personalizacoes")
    if ps:
        nomes = [p.get("nome", "") for p in ps if p.get("nome")]
        if nomes:
            return ", ".join(nomes)
    return l.get("tipo_personalizacao_nome") or ""


MATERIAL_MARKUP = 1.5  # margem default de 50% (usada quando a linha não define margem)


def material_margem_factor(m: dict) -> float:
    margem = m.get("margem")
    if margem is None:
        return MATERIAL_MARKUP
    return 1.0 + (float(margem) / 100.0)


def material_custo(m: dict) -> float:
    unidade = (m.get("unidade") or "").lower()
    if unidade in ("m²", "m2"):
        c = (float(m.get("comprimento_mm") or 0) / 1000.0) * (float(m.get("largura_mm") or 0) / 1000.0)
        return round2(c * (float(m.get("custo_unitario") or 0)) * (float(m.get("quantidade") or 1)))
    return round2(float(m.get("quantidade") or 0) * float(m.get("custo_unitario") or 0))


def fill_materiais(materiais: List[dict]) -> List[dict]:
    out = []
    for m in materiais or []:
        m = {**m}
        if m.get("margem") is None:
            m["margem"] = 50.0
        custo = material_custo(m)
        m["custo"] = custo
        m["valor"] = round2(custo * material_margem_factor(m))
        out.append(m)
    return out


def compute_orcamento_totais(orc: dict) -> dict:
    subtotal_custo = 0.0
    subtotal_venda = 0.0
    total_pers = 0.0
    for l in orc.get("linhas", []):
        qtd = l.get("quantidade") or 0
        subtotal_custo += (l.get("custo_producao_unit") or 0) * qtd
        subtotal_venda += (l.get("preco_unit") or 0) * qtd
        total_pers += pers_valor_unit(l) * qtd
    custo_materiais = 0.0
    venda_materiais = 0.0
    for m in orc.get("materiais", []):
        c = material_custo(m)
        custo_materiais += c
        venda_materiais += round2(c * material_margem_factor(m))
    subtotal_custo = round2(subtotal_custo)
    subtotal_venda = round2(subtotal_venda)
    total_pers = round2(total_pers)
    custo_materiais = round2(custo_materiais)
    venda_materiais = round2(venda_materiais)
    subtotal_custo = round2(subtotal_custo + custo_materiais)
    total = round2(subtotal_venda + total_pers + venda_materiais)
    orc = {**orc}
    orc["subtotal_custo"] = subtotal_custo
    orc["subtotal_venda"] = subtotal_venda
    orc["total_personalizacao"] = total_pers
    orc["custo_materiais"] = custo_materiais
    orc["total_materiais"] = venda_materiais
    orc["total"] = total
    orc["lucro"] = round2(total - subtotal_custo)
    return orc


# ----------------------- PDF generation -----------------------
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)

DARK = colors.HexColor("#0A0A0A")
GREY = colors.HexColor("#6B7280")
LIGHT = colors.HexColor("#F3F4F6")
LINE = colors.HexColor("#E5E7EB")


def fmt_eur(v) -> str:
    s = f"{(v or 0):,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} €"


def _pdf_styles():
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=22, textColor=DARK, spaceAfter=2),
        "brand": ParagraphStyle("brand", fontName="Helvetica-Bold", fontSize=16, textColor=DARK),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, textColor=GREY),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=GREY),
        "val": ParagraphStyle("val", fontName="Helvetica", fontSize=10, textColor=DARK),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=9, textColor=DARK),
        "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=9, textColor=DARK),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, textColor=colors.white),
    }


STATUS_PT = {
    "rascunho": "Rascunho", "enviado": "Enviado", "aceite": "Aceite", "rejeitado": "Rejeitado",
    "pendente": "Pendente", "em_producao": "Em Produção", "concluido": "Concluído",
}


def _header(elems, st, doc_title, numero, meta_pairs):
    head = Table(
        [[Paragraph("Gestão <font color='#9CA3AF'>Produção</font>", st["brand"]),
          Paragraph(doc_title, st["h1"])]],
        colWidths=[95 * mm, 75 * mm],
    )
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    elems.append(head)
    elems.append(Paragraph(f"<b>{numero}</b>", ParagraphStyle("num", fontName="Helvetica-Bold", fontSize=11, textColor=GREY, alignment=2)))
    elems.append(Spacer(1, 6))
    elems.append(HRFlowable(width="100%", thickness=1, color=DARK))
    elems.append(Spacer(1, 10))
    rows = []
    for label, value in meta_pairs:
        rows.append([Paragraph(label.upper(), st["label"]), Paragraph(str(value or "—"), st["val"])])
    meta = Table(rows, colWidths=[40 * mm, 130 * mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(meta)
    elems.append(Spacer(1, 12))


def build_orcamento_pdf(orc: dict) -> bytes:
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    _header(elems, st, "ORÇAMENTO", orc.get("numero", ""), [
        ("Cliente", orc.get("cliente")),
        ("Descrição", orc.get("descricao")),
        ("Nº Encomenda", orc.get("numero_encomenda")),
        ("Data", orc.get("data")),
        ("Validade", orc.get("validade")),
        ("Estado", STATUS_PT.get(orc.get("status"), orc.get("status"))),
    ])

    header = [Paragraph(t, st["th"]) for t in ["Artigo", "Personalização", "Qtd", "Preço Unit.", "Pers. €/un", "Subtotal"]]
    data = [header]
    for l in orc.get("linhas", []):
        qtd = l.get("quantidade") or 0
        preco = l.get("preco_unit") or 0
        pers = pers_valor_unit(l)
        sub = (preco + pers) * qtd
        data.append([
            Paragraph(l.get("artigo_nome") or "—", st["cell"]),
            Paragraph(pers_nomes(l) or "—", st["cell"]),
            Paragraph(f"{qtd:g}", st["cell"]),
            Paragraph(fmt_eur(preco), st["cell"]),
            Paragraph(fmt_eur(pers), st["cell"]),
            Paragraph(fmt_eur(sub), st["cellb"]),
        ])
    tbl = Table(data, colWidths=[55 * mm, 35 * mm, 15 * mm, 25 * mm, 22 * mm, 18 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(tbl)
    elems.append(Spacer(1, 14))

    materiais = orc.get("materiais") or []
    if materiais:
        elems.append(Paragraph("Materiais / Consumíveis", st["cellb"]))
        elems.append(Spacer(1, 4))
        mhead = [Paragraph(t, st["th"]) for t in ["Material", "Unidade", "Dimensões", "Qtd", "Custo", "Margem", "Valor"]]
        mdata = [mhead]
        for m in materiais:
            unidade = (m.get("unidade") or "").lower()
            dims = f"{m.get('comprimento_mm') or 0:g}×{m.get('largura_mm') or 0:g} mm" if unidade in ("m²", "m2") else "—"
            margem = m.get("margem")
            margem = 50.0 if margem is None else margem
            mdata.append([
                Paragraph(m.get("nome") or "—", st["cell"]),
                Paragraph(m.get("unidade") or "—", st["cell"]),
                Paragraph(dims, st["cell"]),
                Paragraph(f"{m.get('quantidade') or 0:g}", st["cell"]),
                Paragraph(fmt_eur(material_custo(m)), st["cell"]),
                Paragraph(f"{margem:g}%", st["cell"]),
                Paragraph(fmt_eur(round2(material_custo(m) * material_margem_factor(m))), st["cellb"]),
            ])
        mtbl = Table(mdata, colWidths=[44 * mm, 20 * mm, 30 * mm, 14 * mm, 22 * mm, 18 * mm, 22 * mm])
        mtbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK),
            ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (2, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        elems.append(mtbl)
        elems.append(Spacer(1, 14))

    tot_rows = [["Preço dos artigos", fmt_eur(orc.get("subtotal_venda"))]]
    if (orc.get("total_personalizacao") or 0) > 0:
        tot_rows.append(["Personalização", fmt_eur(orc.get("total_personalizacao"))])
    if (orc.get("total_materiais") or 0) > 0:
        tot_rows.append(["Materiais", fmt_eur(orc.get("total_materiais"))])
    tot_rows.append(["PREÇO FINAL", fmt_eur(orc.get("total"))])
    last = len(tot_rows) - 1
    tot = Table(tot_rows, colWidths=[45 * mm, 35 * mm], hAlign="RIGHT")
    tot.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, last - 1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, last - 1), 9),
        ("TEXTCOLOR", (0, 0), (-1, last - 1), GREY),
        ("LINEABOVE", (0, last), (-1, last), 1, DARK),
        ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
        ("FONTSIZE", (0, last), (-1, last), 13),
        ("TEXTCOLOR", (0, last), (-1, last), DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems.append(tot)
    doc.build(elems)
    return buf.getvalue()


def build_of_pdf(of: dict) -> bytes:
    st = _pdf_styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    elems = []
    _header(elems, st, "ORDEM DE FABRICO", of.get("numero", ""), [
        ("Cliente", of.get("cliente")),
        ("Descrição", of.get("descricao")),
        ("Nº Encomenda", of.get("numero_encomenda")),
        ("Data", of.get("data")),
        ("Estado", STATUS_PT.get(of.get("status"), of.get("status"))),
        ("Progresso", f"{round(of.get('progresso') or 0)}%"),
        ("Origem", of.get("orcamento_numero")),
    ])

    for it in of.get("itens", []):
        title = f"{it.get('artigo_nome') or 'Artigo'}  ×{it.get('quantidade') or 0:g}"
        _pn = pers_nomes(it)
        if _pn:
            title += f"   ·   {_pn}"
        elems.append(Paragraph(title, st["cellb"]))
        elems.append(Spacer(1, 4))
        header = [Paragraph(t, st["th"]) for t in ["Operação", "Máquina", "T. Máq", "Mão de Obra", "T. M.O", "T. Real", "Concl."]]
        data = [header]
        for op in it.get("operacoes", []):
            real_min = (op.get("tempo_real_seg") or 0) / 60.0
            data.append([
                Paragraph(op.get("nome") or "—", st["cell"]),
                Paragraph(op.get("maquina_nome") or "—", st["cell"]),
                Paragraph(f"{op.get('tempo_maquina') or 0:g} min", st["cell"]),
                Paragraph(op.get("mao_obra_nome") or "—", st["cell"]),
                Paragraph(f"{op.get('tempo_mao_obra') or 0:g} min", st["cell"]),
                Paragraph(f"{real_min:.1f} min", st["cell"]),
                Paragraph("Sim" if op.get("concluida") else "—", st["cellb"] if op.get("concluida") else st["cell"]),
            ])
        if len(data) == 1:
            data.append([Paragraph("Sem operações", st["cell"]), "", "", "", "", "", ""])
        tbl = Table(data, colWidths=[33 * mm, 31 * mm, 17 * mm, 31 * mm, 17 * mm, 18 * mm, 13 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("ALIGN", (4, 0), (5, -1), "RIGHT"),
            ("ALIGN", (6, 0), (6, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        elems.append(tbl)
        elems.append(Spacer(1, 14))

    if not of.get("itens"):
        elems.append(Paragraph("Sem artigos nesta ordem de fabrico.", st["cell"]))
    if of.get("notas"):
        elems.append(Spacer(1, 6))
        elems.append(Paragraph(f"<b>Notas:</b> {of.get('notas')}", st["small"]))
    doc.build(elems)
    return buf.getvalue()


# ----------------------- Routes: Maquinas -----------------------
@api_router.get("/maquinas", response_model=List[Maquina])
async def list_maquinas():
    return await db.maquinas.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)


@api_router.post("/maquinas", response_model=Maquina)
async def create_maquina(data: MaquinaInput):
    m = Maquina(**data.model_dump())
    await db.maquinas.insert_one(m.model_dump())
    return m


@api_router.put("/maquinas/{mid}", response_model=Maquina)
async def update_maquina(mid: str, data: MaquinaInput):
    existing = await db.maquinas.find_one({"id": mid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Máquina não encontrada")
    existing.update(data.model_dump())
    await db.maquinas.update_one({"id": mid}, {"$set": data.model_dump()})
    return existing


@api_router.delete("/maquinas/{mid}")
async def delete_maquina(mid: str):
    await db.maquinas.delete_one({"id": mid})
    return {"ok": True}


# ----------------------- Routes: Consumiveis (Materiais) -----------------------
@api_router.get("/consumiveis", response_model=List[Consumivel])
async def list_consumiveis():
    return await db.consumiveis.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)


@api_router.post("/consumiveis", response_model=Consumivel)
async def create_consumivel(data: ConsumivelInput):
    c = Consumivel(**data.model_dump())
    await db.consumiveis.insert_one(c.model_dump())
    return c


@api_router.put("/consumiveis/{cid}", response_model=Consumivel)
async def update_consumivel(cid: str, data: ConsumivelInput):
    existing = await db.consumiveis.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Consumível não encontrado")
    await db.consumiveis.update_one({"id": cid}, {"$set": data.model_dump()})
    existing.update(data.model_dump())
    return existing


@api_router.delete("/consumiveis/{cid}")
async def delete_consumivel(cid: str):
    await db.consumiveis.delete_one({"id": cid})
    return {"ok": True}


# ----------------------- Routes: Mao de Obra -----------------------
@api_router.get("/mao-obra", response_model=List[MaoObra])
async def list_mao_obra():
    return await db.mao_obra.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)


@api_router.post("/mao-obra", response_model=MaoObra)
async def create_mao_obra(data: MaoObraInput):
    m = MaoObra(**data.model_dump())
    await db.mao_obra.insert_one(m.model_dump())
    return m


@api_router.put("/mao-obra/{mid}", response_model=MaoObra)
async def update_mao_obra(mid: str, data: MaoObraInput):
    existing = await db.mao_obra.find_one({"id": mid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Mão de obra não encontrada")
    await db.mao_obra.update_one({"id": mid}, {"$set": data.model_dump()})
    existing.update(data.model_dump())
    return existing


@api_router.delete("/mao-obra/{mid}")
async def delete_mao_obra(mid: str):
    await db.mao_obra.delete_one({"id": mid})
    return {"ok": True}


# ----------------------- Routes: Artigos -----------------------
@api_router.get("/artigos")
async def list_artigos():
    artigos = await db.artigos.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)
    result = []
    for a in artigos:
        result.append(enrich_artigo(a, await artigo_breakdown(a)))
    return result


@api_router.get("/artigos/{aid}")
async def get_artigo(aid: str):
    a = await db.artigos.find_one({"id": aid}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    return enrich_artigo(a, await artigo_breakdown(a))


@api_router.post("/artigos")
async def create_artigo(data: ArtigoInput):
    a = Artigo(**data.model_dump())
    doc = a.model_dump()
    await db.artigos.insert_one(doc)
    doc.pop("_id", None)
    return enrich_artigo(doc, await artigo_breakdown(doc))


@api_router.put("/artigos/{aid}")
async def update_artigo(aid: str, data: ArtigoInput):
    existing = await db.artigos.find_one({"id": aid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Artigo não encontrado")
    update = data.model_dump()
    await db.artigos.update_one({"id": aid}, {"$set": update})
    existing.update(update)
    return enrich_artigo(existing, await artigo_breakdown(existing))


@api_router.delete("/artigos/{aid}")
async def delete_artigo(aid: str):
    await db.artigos.delete_one({"id": aid})
    return {"ok": True}


# ----------------------- Routes: Tipos Personalizacao -----------------------
@api_router.get("/tipos-personalizacao", response_model=List[TipoPersonalizacao])
async def list_tipos():
    return await db.tipos_personalizacao.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)


@api_router.post("/tipos-personalizacao", response_model=TipoPersonalizacao)
async def create_tipo(data: TipoPersonalizacaoInput):
    t = TipoPersonalizacao(**data.model_dump())
    await db.tipos_personalizacao.insert_one(t.model_dump())
    return t


@api_router.put("/tipos-personalizacao/{tid}", response_model=TipoPersonalizacao)
async def update_tipo(tid: str, data: TipoPersonalizacaoInput):
    existing = await db.tipos_personalizacao.find_one({"id": tid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Tipo não encontrado")
    await db.tipos_personalizacao.update_one({"id": tid}, {"$set": data.model_dump()})
    existing.update(data.model_dump())
    return existing


@api_router.delete("/tipos-personalizacao/{tid}")
async def delete_tipo(tid: str):
    await db.tipos_personalizacao.delete_one({"id": tid})
    return {"ok": True}


# ----------------------- Routes: Orcamentos -----------------------
async def fill_linha_custos(linhas: List[dict]) -> List[dict]:
    out = []
    for l in linhas:
        a = await db.artigos.find_one({"id": l.get("artigo_id")}, {"_id": 0})
        if a:
            l["artigo_nome"] = a.get("nome", l.get("artigo_nome", ""))
            if l.get("custo_base_unit") is None:
                bd_a = await artigo_breakdown(a)
                l["custo_base_unit"] = round2(bd_a["custo_artigo"] + bd_a["custo_materiais"])
                if l.get("margem") is None:
                    l["margem"] = a.get("margem", 30)
                if not l.get("roteiro"):
                    l["roteiro"] = a.get("roteiro", [])
            pseudo = {
                "custo_artigo": l.get("custo_base_unit") or 0,
                "materiais": [],
                "roteiro": l.get("roteiro", []),
                "margem": l.get("margem") if l.get("margem") is not None else 30,
            }
            bd = await artigo_breakdown(pseudo)
            l["custo_producao_unit"] = bd["custo_producao_total"]
            l["preco_unit"] = bd["preco_venda"]
        out.append(l)
    return out


@api_router.get("/orcamentos")
async def list_orcamentos():
    orcs = await db.orcamentos.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [compute_orcamento_totais(o) for o in orcs]


@api_router.get("/orcamentos/{oid}")
async def get_orcamento(oid: str):
    o = await db.orcamentos.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    return compute_orcamento_totais(o)


@api_router.get("/orcamentos/{oid}/pdf")
async def orcamento_pdf(oid: str):
    o = await db.orcamentos.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Orçamento não encontrado")
    o = compute_orcamento_totais(o)
    pdf = build_orcamento_pdf(o)
    filename = f"{o.get('numero', 'orcamento')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api_router.post("/orcamentos")
async def create_orcamento(data: OrcamentoInput):
    o = Orcamento(**data.model_dump())
    o.numero = await next_sequence("ORC")
    if not o.data:
        o.data = now_iso()[:10]
    doc = o.model_dump()
    doc["linhas"] = await fill_linha_custos(doc.get("linhas", []))
    doc["materiais"] = fill_materiais(doc.get("materiais", []))
    await db.orcamentos.insert_one(doc)
    doc.pop("_id", None)
    return compute_orcamento_totais(doc)


@api_router.put("/orcamentos/{oid}")
async def update_orcamento(oid: str, data: OrcamentoInput):
    existing = await db.orcamentos.find_one({"id": oid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Orçamento não encontrado")
    update = data.model_dump()
    update["linhas"] = await fill_linha_custos(update.get("linhas", []))
    update["materiais"] = fill_materiais(update.get("materiais", []))
    await db.orcamentos.update_one({"id": oid}, {"$set": update})
    existing.update(update)
    return compute_orcamento_totais(existing)


@api_router.delete("/orcamentos/{oid}")
async def delete_orcamento(oid: str):
    await db.orcamentos.delete_one({"id": oid})
    return {"ok": True}


# ----------------------- Routes: Ordens de Fabrico -----------------------
def recompute_of_status(of: dict) -> dict:
    all_ops = [op for it in of.get("itens", []) for op in it.get("operacoes", [])]
    of = {**of}
    running = any(op.get("timer_inicio") for op in all_ops)
    has_progress = any((op.get("tempo_real_seg") or 0) > 0 or op.get("concluida") for op in all_ops)
    if all_ops:
        done = sum(1 for op in all_ops if op.get("concluida"))
        if done == len(all_ops):
            of["status"] = "concluido"
        elif done > 0 or running or has_progress:
            of["status"] = "em_producao"
        else:
            of["status"] = "pendente"
        of["progresso"] = round2(done / len(all_ops) * 100)
    else:
        of["progresso"] = 0
    # Estado do cronómetro: por_iniciar (cinza), em_curso (verde), em_pausa (amarelo), concluido
    if of.get("status") == "concluido":
        of["timer_estado"] = "concluido"
    elif running:
        of["timer_estado"] = "em_curso"
    elif has_progress:
        of["timer_estado"] = "em_pausa"
    else:
        of["timer_estado"] = "por_iniciar"
    return of


async def build_of_itens(itens: List[dict]) -> List[dict]:
    """Auto-load roteiro de operações from artigo for each item."""
    out = []
    for it in itens:
        if not it.get("id"):
            it["id"] = new_id()
        a = await db.artigos.find_one({"id": it.get("artigo_id")}, {"_id": 0})
        operacoes = it.get("operacoes")
        if a:
            it["artigo_nome"] = a.get("nome", it.get("artigo_nome", ""))
            if not operacoes:
                operacoes = []
                for op in a.get("roteiro", []):
                    t_maq = op_minutos_maquina(op)
                    t_mo = op_minutos_mao_obra(op)
                    maq = await db.maquinas.find_one({"id": op.get("maquina_id")}, {"_id": 0}) if op.get("maquina_id") else None
                    mo = await db.mao_obra.find_one({"id": op.get("mao_obra_id")}, {"_id": 0}) if op.get("mao_obra_id") else None
                    custo_est = round2((t_maq / 60.0) * maquina_custo_hora(maq) + (t_mo / 60.0) * ((mo or {}).get("custo_hora") or 0))
                    operacoes.append(
                        OFOperacao(
                            nome=op.get("nome", ""),
                            maquina_nome=op.get("maquina_nome"),
                            mao_obra_nome=op.get("mao_obra_nome"),
                            tempo_maquina=t_maq,
                            tempo_mao_obra=t_mo,
                            tempo_min=t_maq + t_mo,
                            custo_estimado=custo_est,
                        ).model_dump()
                    )
        it["operacoes"] = operacoes or []
        out.append(it)
    return out


@api_router.get("/ordens-fabrico")
async def list_ofs():
    ofs = await db.ordens_fabrico.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [recompute_of_status(o) for o in ofs]


@api_router.get("/ordens-fabrico/{ofid}")
async def get_of(ofid: str):
    o = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "OF não encontrada")
    return recompute_of_status(o)


@api_router.get("/ordens-fabrico/{ofid}/pdf")
async def of_pdf(ofid: str):
    o = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "OF não encontrada")
    o = recompute_of_status(o)
    pdf = build_of_pdf(o)
    filename = f"{o.get('numero', 'ordem-fabrico')}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api_router.post("/ordens-fabrico")
async def create_of(data: OrdemFabricoInput):
    of = OrdemFabrico(**data.model_dump())
    of.numero = await next_sequence("OF")
    if of.encomenda_id:
        enc = await db.encomendas.find_one({"id": of.encomenda_id}, {"_id": 0})
        if enc:
            of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await db.ordens_fabrico.insert_one({k: v for k, v in doc.items() if k != "progresso"})
    return doc


@api_router.put("/ordens-fabrico/{ofid}")
async def update_of(ofid: str, data: OrdemFabricoInput):
    existing = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "OF não encontrada")
    update = data.model_dump()
    update["itens"] = await build_of_itens(update.get("itens", []))
    merged = {**existing, **update}
    merged = recompute_of_status(merged)
    to_save = {k: v for k, v in merged.items() if k != "progresso"}
    await db.ordens_fabrico.update_one({"id": ofid}, {"$set": to_save})
    return merged


class ToggleOp(BaseModel):
    item_id: str
    operacao_id: str
    concluida: bool


def _find_op(of: dict, item_id: str, operacao_id: str):
    for it in of.get("itens", []):
        if it.get("id") == item_id:
            for op in it.get("operacoes", []):
                if op.get("id") == operacao_id:
                    return op
    return None


async def _save_of(ofid: str, of: dict):
    of = recompute_of_status(of)
    to_save = {k: v for k, v in of.items() if k != "progresso"}
    await db.ordens_fabrico.update_one({"id": ofid}, {"$set": to_save})
    return of


class TimerBody(BaseModel):
    item_id: str
    operacao_id: str


@api_router.post("/ordens-fabrico/{ofid}/operacao/iniciar")
async def iniciar_operacao(ofid: str, body: TimerBody):
    of = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    if of.get("encomenda_id"):
        enc = await db.encomendas.find_one({"id": of["encomenda_id"]}, {"_id": 0})
        if enc:
            enc_c = await compute_encomenda(enc)
            if not enc_c["pode_produzir"]:
                raise HTTPException(
                    403,
                    "Produção não autorizada: pagamento pendente. Registe o pagamento total ou autorize a produção manualmente na encomenda.",
                )
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    if not op.get("timer_inicio"):
        op["timer_inicio"] = now_iso()
    return await _save_of(ofid, of)


def _stop_op(op: dict):
    if op.get("timer_inicio"):
        inicio = datetime.fromisoformat(op["timer_inicio"])
        elapsed = (datetime.now(timezone.utc) - inicio).total_seconds()
        op["tempo_real_seg"] = (op.get("tempo_real_seg") or 0) + max(0, elapsed)
        op["timer_inicio"] = None


@api_router.post("/ordens-fabrico/{ofid}/operacao/parar")
async def parar_operacao(ofid: str, body: TimerBody):
    of = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    op = _find_op(of, body.item_id, body.operacao_id)
    if not op:
        raise HTTPException(404, "Operação não encontrada")
    _stop_op(op)
    return await _save_of(ofid, of)


@api_router.post("/ordens-fabrico/{ofid}/finalizar")
async def finalizar_of(ofid: str):
    of = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    for it in of.get("itens", []):
        for op in it.get("operacoes", []):
            _stop_op(op)
            op["concluida"] = True
    return await _save_of(ofid, of)


@api_router.post("/ordens-fabrico/{ofid}/toggle-operacao")
async def toggle_operacao(ofid: str, body: ToggleOp):
    of = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    op = _find_op(of, body.item_id, body.operacao_id)
    if op:
        op["concluida"] = body.concluida
        if body.concluida:
            _stop_op(op)
    return await _save_of(ofid, of)


@api_router.delete("/ordens-fabrico/{ofid}")
async def delete_of(ofid: str):
    await db.ordens_fabrico.delete_one({"id": ofid})
    return {"ok": True}


@api_router.post("/orcamentos/{oid}/converter")
async def converter_orcamento(oid: str):
    orc = await db.orcamentos.find_one({"id": oid}, {"_id": 0})
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if orc.get("of_id"):
        existing = await db.ordens_fabrico.find_one({"id": orc["of_id"]}, {"_id": 0})
        if existing:
            return recompute_of_status(existing)

    itens = []
    for l in orc.get("linhas", []):
        operacoes = []
        for op in l.get("roteiro", []):
            t_maq = op_minutos_maquina(op)
            t_mo = op_minutos_mao_obra(op)
            maq = await db.maquinas.find_one({"id": op.get("maquina_id")}, {"_id": 0}) if op.get("maquina_id") else None
            mo = await db.mao_obra.find_one({"id": op.get("mao_obra_id")}, {"_id": 0}) if op.get("mao_obra_id") else None
            custo_est = round2((t_maq / 60.0) * maquina_custo_hora(maq) + (t_mo / 60.0) * ((mo or {}).get("custo_hora") or 0))
            operacoes.append(
                OFOperacao(
                    nome=op.get("nome", ""),
                    maquina_nome=op.get("maquina_nome") or ((maq or {}).get("nome")),
                    mao_obra_nome=op.get("mao_obra_nome") or ((mo or {}).get("nome")),
                    tempo_maquina=t_maq,
                    tempo_mao_obra=t_mo,
                    tempo_min=t_maq + t_mo,
                    custo_estimado=custo_est,
                ).model_dump()
            )
        itens.append(
            {
                "artigo_id": l.get("artigo_id"),
                "artigo_nome": l.get("artigo_nome"),
                "quantidade": l.get("quantidade", 1),
                "tipo_personalizacao_id": l.get("tipo_personalizacao_id"),
                "tipo_personalizacao_nome": pers_nomes(l) or l.get("tipo_personalizacao_nome"),
                "personalizacoes": l.get("personalizacoes") or [],
                "operacoes": operacoes,
            }
        )
    of = OrdemFabrico(
        cliente=orc.get("cliente", ""),
        cliente_id=orc.get("cliente_id"),
        descricao=orc.get("descricao", ""),
        numero_encomenda=orc.get("numero_encomenda", ""),
        data=now_iso()[:10],
        status="pendente",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
    )
    of.numero = await next_sequence("OF")
    of.orcamento_id = orc["id"]
    of.orcamento_numero = orc.get("numero")
    # criar encomenda associada
    orc_t = compute_orcamento_totais(orc)
    enc_artigos = [
        {
            "id": new_id(),
            "artigo_id": l.get("artigo_id"),
            "artigo_nome": l.get("artigo_nome", ""),
            "quantidade": l.get("quantidade", 1),
            "preco_unit": l.get("preco_unit") or 0,
            "personalizacoes": l.get("personalizacoes") or [],
        }
        for l in orc.get("linhas", [])
    ]
    enc = Encomenda(
        cliente=orc.get("cliente", ""),
        cliente_id=orc.get("cliente_id"),
        descricao=orc.get("descricao", ""),
        data=now_iso()[:10],
        estado="aberta",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
        artigos=enc_artigos,
        valor_total=orc_t.get("total"),
    )
    enc.numero = await next_sequence("ENC")
    enc.orcamento_id = orc["id"]
    enc.orcamento_numero = orc.get("numero")
    await db.encomendas.insert_one(enc.model_dump())
    of.encomenda_id = enc.id
    of.encomenda_numero = enc.numero
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(itens)
    doc = recompute_of_status(doc)
    await db.ordens_fabrico.insert_one({k: v for k, v in doc.items() if k != "progresso"})
    await db.orcamentos.update_one(
        {"id": oid}, {"$set": {"of_id": of.id, "of_numero": of.numero}}
    )
    return doc


# ----------------------- Clientes -----------------------
@api_router.get("/clientes")
async def list_clientes(_u: dict = Depends(get_current_user)):
    return await db.clientes.find({}, {"_id": 0}).sort("nome", 1).to_list(5000)


@api_router.post("/clientes")
async def create_cliente(data: ClienteInput, _u: dict = Depends(get_current_user)):
    c = Cliente(**data.model_dump())
    await db.clientes.insert_one(c.model_dump())
    return c.model_dump()


@api_router.put("/clientes/{cid}")
async def update_cliente(cid: str, data: ClienteInput, _u: dict = Depends(get_current_user)):
    existing = await db.clientes.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Cliente não encontrado")
    await db.clientes.update_one({"id": cid}, {"$set": data.model_dump()})
    return {**existing, **data.model_dump()}


@api_router.delete("/clientes/{cid}")
async def delete_cliente(cid: str, _u: dict = Depends(get_current_user)):
    await db.clientes.delete_one({"id": cid})
    return {"ok": True}


# ----------------------- Encomendas -----------------------
PAY_PT = {"pendente": "Pendente", "parcial": "Pago parcial", "pago": "Pago total"}
ENC_ESTADO_PT = {"aberta": "Aberta", "em_producao": "Em Produção", "concluida": "Concluída", "cancelada": "Cancelada"}


def encomenda_artigos_total(enc: dict) -> float:
    total = 0.0
    for a in enc.get("artigos", []):
        qtd = a.get("quantidade") or 0
        total += (a.get("preco_unit") or 0) * qtd + pers_valor_unit(a) * qtd
    return round2(total)


async def compute_encomenda(enc: dict) -> dict:
    enc = {**enc}
    ofs = await db.ordens_fabrico.find({"encomenda_id": enc["id"]}, {"_id": 0}).to_list(1000)
    ofs = [recompute_of_status(o) for o in ofs]
    enc["num_ofs"] = len(ofs)

    custo_est = custo_real = 0.0
    for o in ofs:
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                t = op.get("tempo_min") or 0
                rmin = (op.get("tempo_real_seg") or 0) / 60.0
                ec = op.get("custo_estimado") or 0
                rc = (rmin / t) * ec if t > 0 else 0.0
                custo_est += ec
                custo_real += rc
    enc["custo_producao_estimado"] = round2(custo_est)
    enc["custo_producao_real"] = round2(custo_real)

    if enc.get("valor_total_manual") and enc.get("valor_total") is not None:
        valor = enc.get("valor_total") or 0
    elif enc.get("orcamento_id"):
        orc = await db.orcamentos.find_one({"id": enc["orcamento_id"]}, {"_id": 0})
        valor = compute_orcamento_totais(orc)["total"] if orc else encomenda_artigos_total(enc)
    else:
        valor = encomenda_artigos_total(enc)
    enc["valor_total"] = round2(valor)

    pago = enc.get("valor_pago") or 0
    if pago <= 0:
        enc["status_pagamento"] = "pendente"
    elif pago < enc["valor_total"]:
        enc["status_pagamento"] = "parcial"
    else:
        enc["status_pagamento"] = "pago"
    enc["valor_pendente"] = round2(max(0.0, enc["valor_total"] - pago))
    enc["pode_produzir"] = bool(enc.get("autorizada_producao") or enc["status_pagamento"] == "pago")

    if enc.get("estado") != "cancelada":
        if ofs and all(o.get("status") == "concluido" for o in ofs):
            enc["estado"] = "concluida"
        elif any(o.get("status") in ("em_producao", "concluido") for o in ofs):
            enc["estado"] = "em_producao"
        else:
            enc["estado"] = "aberta"
    enc["margem_producao"] = round2(enc["valor_total"] - enc["custo_producao_real"])
    enc["ordens_resumo"] = [
        {"id": o["id"], "numero": o.get("numero"), "status": o.get("status"), "progresso": o.get("progresso")}
        for o in ofs
    ]
    return enc


@api_router.get("/encomendas")
async def list_encomendas(_u: dict = Depends(get_current_user)):
    encs = await db.encomendas.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return [await compute_encomenda(e) for e in encs]


@api_router.get("/encomendas/{eid}")
async def get_encomenda(eid: str, _u: dict = Depends(get_current_user)):
    e = await db.encomendas.find_one({"id": eid}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Encomenda não encontrada")
    e = await compute_encomenda(e)
    ofs = await db.ordens_fabrico.find({"encomenda_id": eid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    e["ordens_fabrico"] = [recompute_of_status(o) for o in ofs]
    return e


@api_router.post("/encomendas")
async def create_encomenda(data: EncomendaInput, _u: dict = Depends(get_current_user)):
    enc = Encomenda(**data.model_dump())
    enc.numero = await next_sequence("ENC")
    if not enc.data:
        enc.data = now_iso()[:10]
    await db.encomendas.insert_one(enc.model_dump())
    return await compute_encomenda(enc.model_dump())


@api_router.put("/encomendas/{eid}")
async def update_encomenda(eid: str, data: EncomendaInput, _u: dict = Depends(get_current_user)):
    existing = await db.encomendas.find_one({"id": eid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Encomenda não encontrada")
    await db.encomendas.update_one({"id": eid}, {"$set": data.model_dump()})
    merged = {**existing, **data.model_dump()}
    return await compute_encomenda(merged)


@api_router.delete("/encomendas/{eid}")
async def delete_encomenda(eid: str, _u: dict = Depends(get_current_user)):
    await db.ordens_fabrico.update_many(
        {"encomenda_id": eid}, {"$set": {"encomenda_id": None, "encomenda_numero": None}}
    )
    await db.encomendas.delete_one({"id": eid})
    return {"ok": True}


@api_router.post("/encomendas/{eid}/ordens-fabrico")
async def create_of_for_encomenda(eid: str, data: OrdemFabricoInput, _u: dict = Depends(get_current_user)):
    enc = await db.encomendas.find_one({"id": eid}, {"_id": 0})
    if not enc:
        raise HTTPException(404, "Encomenda não encontrada")
    payload = data.model_dump()
    payload["encomenda_id"] = eid
    payload["cliente"] = enc.get("cliente") or payload.get("cliente") or ""
    payload["cliente_id"] = enc.get("cliente_id")
    of = OrdemFabrico(**payload)
    of.numero = await next_sequence("OF")
    of.encomenda_numero = enc.get("numero")
    if not of.data:
        of.data = now_iso()[:10]
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(doc.get("itens", []))
    doc = recompute_of_status(doc)
    await db.ordens_fabrico.insert_one({k: v for k, v in doc.items() if k != "progresso"})
    return doc



# ----------------------- Dashboard -----------------------
# ----------------------- Produção: tempos estimado vs real -----------------------
@api_router.get("/producao/tempos")
async def producao_tempos():
    ofs = await db.ordens_fabrico.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for o in ofs:
        o = recompute_of_status(o)
        est_maq = est_mo = est_tot = real_seg = 0.0
        custo_est_total = custo_real_total = 0.0
        ops = []
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                tmaq = op.get("tempo_maquina") or 0
                tmo = op.get("tempo_mao_obra") or 0
                ttot = op.get("tempo_min") or (tmaq + tmo)
                rseg = op.get("tempo_real_seg") or 0
                rmin = rseg / 60.0
                est_c = op.get("custo_estimado") or 0
                real_c = round2((rmin / ttot) * est_c) if ttot > 0 else 0.0
                est_maq += tmaq
                est_mo += tmo
                est_tot += ttot
                real_seg += rseg
                custo_est_total += est_c
                custo_real_total += real_c
                ops.append({
                    "artigo": it.get("artigo_nome"),
                    "nome": op.get("nome"),
                    "maquina_nome": op.get("maquina_nome"),
                    "mao_obra_nome": op.get("mao_obra_nome"),
                    "tempo_maquina": tmaq,
                    "tempo_mao_obra": tmo,
                    "tempo_estimado": round2(ttot),
                    "tempo_real_min": round2(rmin),
                    "desvio_min": round2(rmin - ttot),
                    "custo_estimado": round2(est_c),
                    "custo_real": real_c,
                    "desvio_custo": round2(real_c - est_c),
                    "em_curso": bool(op.get("timer_inicio")),
                    "concluida": bool(op.get("concluida")),
                })
        real_min = round2(real_seg / 60.0)
        custo_est_total = round2(custo_est_total)
        custo_real_total = round2(custo_real_total)
        result.append({
            "id": o["id"],
            "numero": o.get("numero"),
            "cliente": o.get("cliente"),
            "status": o.get("status"),
            "progresso": o.get("progresso"),
            "tempo_estimado_maquina": round2(est_maq),
            "tempo_estimado_mao_obra": round2(est_mo),
            "tempo_estimado_total": round2(est_tot),
            "tempo_real_min": real_min,
            "desvio_min": round2(real_min - est_tot),
            "custo_estimado": custo_est_total,
            "custo_real": custo_real_total,
            "desvio_custo": round2(custo_real_total - custo_est_total),
            "operacoes": ops,
        })
    return result


@api_router.get("/producao/analise")
async def producao_analise():
    from collections import defaultdict
    ofs = await db.ordens_fabrico.find({}, {"_id": 0}).to_list(2000)
    by_month = defaultdict(lambda: {"criadas": 0, "concluidas": 0, "tempo_est": 0.0, "tempo_real": 0.0, "custo_est": 0.0, "custo_real": 0.0})
    for o in ofs:
        o = recompute_of_status(o)
        mes = (o.get("created_at") or "")[:7]
        if not mes:
            continue
        m = by_month[mes]
        m["criadas"] += 1
        if o.get("status") == "concluido":
            m["concluidas"] += 1
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                t = op.get("tempo_min") or 0
                rmin = (op.get("tempo_real_seg") or 0) / 60.0
                ec = op.get("custo_estimado") or 0
                rc = (rmin / t) * ec if t > 0 else 0.0
                m["tempo_est"] += t
                m["tempo_real"] += rmin
                m["custo_est"] += ec
                m["custo_real"] += rc
    result = []
    for mes in sorted(by_month.keys()):
        m = by_month[mes]
        criadas = m["criadas"] or 1
        result.append({
            "mes": mes,
            "ofs_criadas": m["criadas"],
            "ofs_concluidas": m["concluidas"],
            "taxa_conclusao": round2(m["concluidas"] / criadas * 100),
            "tempo_estimado": round2(m["tempo_est"]),
            "tempo_real": round2(m["tempo_real"]),
            "desvio_tempo": round2(m["tempo_real"] - m["tempo_est"]),
            "custo_estimado": round2(m["custo_est"]),
            "custo_real": round2(m["custo_real"]),
            "desvio_custo": round2(m["custo_real"] - m["custo_est"]),
            "custo_estimado_medio": round2(m["custo_est"] / criadas),
            "custo_real_medio": round2(m["custo_real"] / criadas),
        })
    return result


@api_router.get("/dashboard")
async def dashboard():
    artigos = await db.artigos.find({}, {"_id": 0}).to_list(1000)
    custos = [await artigo_custo_total(a) for a in artigos]
    orcs = await db.orcamentos.find({}, {"_id": 0}).to_list(1000)
    orcs_t = [compute_orcamento_totais(o) for o in orcs]
    ofs = await db.ordens_fabrico.find({}, {"_id": 0}).to_list(1000)
    ofs_t = [recompute_of_status(o) for o in ofs]

    orc_estados = ["rascunho", "enviado", "aceite", "rejeitado"]
    orcamentos_por_estado = [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in orcs_t if o.get("status") == e),
            "valor": round2(sum(o["total"] for o in orcs_t if o.get("status") == e)),
        }
        for e in orc_estados
    ]
    of_estados = ["pendente", "em_producao", "concluido"]
    ofs_por_estado = [
        {
            "estado": e,
            "label": STATUS_PT.get(e, e),
            "count": sum(1 for o in ofs_t if o.get("status") == e),
        }
        for e in of_estados
    ]

    # valor mensal de orçamentos (últimos 6 meses pelo created_at)
    from collections import defaultdict
    mensal = defaultdict(float)
    for o in orcs_t:
        mes = (o.get("created_at") or "")[:7]
        if mes:
            mensal[mes] += o.get("total") or 0
    valor_mensal = [{"mes": k, "valor": round2(v)} for k, v in sorted(mensal.items())][-6:]

    # tempo estimado vs real por OF (todas)
    tempo_por_of = []
    for o in ofs_t:
        est = real = 0.0
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                est += op.get("tempo_min") or 0
                real += (op.get("tempo_real_seg") or 0) / 60.0
        if est > 0 or real > 0:
            tempo_por_of.append({"numero": o.get("numero"), "estimado": round2(est), "real": round2(real)})
    tempo_por_of = tempo_por_of[-8:]

    # top artigos por preço de venda
    arts_bd = []
    for a in artigos:
        bd = await artigo_breakdown(a)
        arts_bd.append({"nome": a.get("nome"), "custo": bd["custo_producao_total"], "preco": bd["preco_venda"]})
    arts_bd.sort(key=lambda x: x["preco"], reverse=True)
    top_artigos = arts_bd[:6]

    # ---- Encomendas ----
    encs = await db.encomendas.find({}, {"_id": 0}).to_list(2000)
    encs_c = [await compute_encomenda(e) for e in encs]
    valor_encomendas = round2(sum(e["valor_total"] for e in encs_c))
    valor_pago_total = round2(sum((e.get("valor_pago") or 0) for e in encs_c))
    valor_pendente_total = round2(sum(e["valor_pendente"] for e in encs_c))
    custo_real_encomendas = round2(sum(e["custo_producao_real"] for e in encs_c))
    custo_estimado_encomendas = round2(sum(e["custo_producao_estimado"] for e in encs_c))

    pay_states = ["pendente", "parcial", "pago"]
    encomendas_por_pagamento = [
        {
            "estado": s,
            "label": PAY_PT[s],
            "count": sum(1 for e in encs_c if e["status_pagamento"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["status_pagamento"] == s)),
        }
        for s in pay_states
    ]
    enc_estados = ["aberta", "em_producao", "concluida", "cancelada"]
    encomendas_por_estado = [
        {
            "estado": s,
            "label": ENC_ESTADO_PT[s],
            "count": sum(1 for e in encs_c if e["estado"] == s),
            "valor": round2(sum(e["valor_total"] for e in encs_c if e["estado"] == s)),
        }
        for s in enc_estados
    ]
    # valor encomenda vs custo de produção real (top por valor)
    enc_valor_vs_custo = sorted(encs_c, key=lambda e: e["valor_total"], reverse=True)[:8]
    enc_valor_vs_custo = [
        {
            "numero": e.get("numero"),
            "valor": e["valor_total"],
            "custo_estimado": e["custo_producao_estimado"],
            "custo_real": e["custo_producao_real"],
            "margem": e["margem_producao"],
        }
        for e in enc_valor_vs_custo
    ]
    encomendas_por_autorizar = sum(
        1 for e in encs_c if e["estado"] not in ("concluida", "cancelada") and not e["pode_produzir"]
    )

    return {
        "total_artigos": len(artigos),
        "total_maquinas": await db.maquinas.count_documents({}),
        "total_tipos": await db.tipos_personalizacao.count_documents({}),
        "total_materiais": await db.consumiveis.count_documents({}),
        "custo_medio": round2(sum(custos) / len(custos)) if custos else 0,
        "total_orcamentos": len(orcs_t),
        "valor_orcamentos": round2(sum(o["total"] for o in orcs_t)),
        "valor_aceites": round2(sum(o["total"] for o in orcs_t if o.get("status") == "aceite")),
        "orcamentos_aceites": sum(1 for o in orcs_t if o.get("status") == "aceite"),
        "total_ofs": len(ofs_t),
        "ofs_pendentes": sum(1 for o in ofs_t if o.get("status") == "pendente"),
        "ofs_em_producao": sum(1 for o in ofs_t if o.get("status") == "em_producao"),
        "ofs_concluidas": sum(1 for o in ofs_t if o.get("status") == "concluido"),
        "orcamentos_por_estado": orcamentos_por_estado,
        "ofs_por_estado": ofs_por_estado,
        "valor_mensal": valor_mensal,
        "tempo_por_of": tempo_por_of,
        "top_artigos": top_artigos,
        "total_encomendas": len(encs_c),
        "valor_encomendas": valor_encomendas,
        "valor_pago_total": valor_pago_total,
        "valor_pendente_total": valor_pendente_total,
        "custo_real_encomendas": custo_real_encomendas,
        "custo_estimado_encomendas": custo_estimado_encomendas,
        "margem_encomendas": round2(valor_encomendas - custo_real_encomendas),
        "encomendas_por_pagamento": encomendas_por_pagamento,
        "encomendas_por_estado": encomendas_por_estado,
        "enc_valor_vs_custo": enc_valor_vs_custo,
        "encomendas_por_autorizar": encomendas_por_autorizar,
    }


# ----------------------- Seed demo data -----------------------
@api_router.post("/seed")
async def seed():
    if await db.artigos.count_documents({}) > 0:
        return {"ok": True, "message": "Dados já existem"}

    m1 = Maquina(nome="Impressora DTF UV", custo_amortizacao_hora=14.0, custo_energia_hora=6.0)
    m2 = Maquina(nome="Prensa Térmica", custo_amortizacao_hora=8.0, custo_energia_hora=4.0)
    m3 = Maquina(nome="Plotter de Corte", custo_amortizacao_hora=12.0, custo_energia_hora=3.0)
    await db.maquinas.insert_many([m1.model_dump(), m2.model_dump(), m3.model_dump()])

    mo1 = MaoObra(nome="Operador de Produção", custo_hora=12.0)
    mo2 = MaoObra(nome="Designer", custo_hora=18.0)
    await db.mao_obra.insert_many([mo1.model_dump(), mo2.model_dump()])

    c1 = Consumivel(nome="Filme DTF UV (A4)", unidade="folha", custo_unitario=1.20)
    c2 = Consumivel(nome="Tinta UV", unidade="ml", custo_unitario=0.08)
    c3 = Consumivel(nome="Filme DTF Têxtil (A4)", unidade="folha", custo_unitario=0.45)
    c4 = Consumivel(nome="Pó Hot-Melt", unidade="g", custo_unitario=0.02)
    await db.consumiveis.insert_many(
        [c1.model_dump(), c2.model_dump(), c3.model_dump(), c4.model_dump()]
    )

    tipos = [
        TipoPersonalizacao(nome="DTF UV", descricao="Transfer DTF UV para superfícies rígidas"),
        TipoPersonalizacao(nome="DTF Têxtil", descricao="Transfer DTF para tecidos"),
        TipoPersonalizacao(nome="Vinil de Corte", descricao="Aplicação de vinil recortado"),
    ]
    await db.tipos_personalizacao.insert_many([t.model_dump() for t in tipos])

    a1 = Artigo(
        nome="DTF UV",
        descricao="Etiqueta DTF UV premium",
        margem=40.0,
        materiais=[
            ArtigoMaterial(material_id=c1.id, material_nome=c1.nome, unidade=c1.unidade, quantidade=1, custo_unitario=c1.custo_unitario),
            ArtigoMaterial(material_id=c2.id, material_nome=c2.nome, unidade=c2.unidade, quantidade=5, custo_unitario=c2.custo_unitario),
        ],
        roteiro=[
            Operacao(nome="Impressão", maquina_id=m1.id, maquina_nome=m1.nome, tempo_maquina=4, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=4, tempo_mao_obra_unidade="min"),
            Operacao(nome="Prensagem", maquina_id=m2.id, maquina_nome=m2.nome, tempo_maquina=2, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=2, tempo_mao_obra_unidade="min"),
        ],
    )
    a2 = Artigo(
        nome="DTF Têxtil",
        descricao="Transfer têxtil para t-shirts",
        margem=35.0,
        materiais=[
            ArtigoMaterial(material_id=c3.id, material_nome=c3.nome, unidade=c3.unidade, quantidade=1, custo_unitario=c3.custo_unitario),
            ArtigoMaterial(material_id=c4.id, material_nome=c4.nome, unidade=c4.unidade, quantidade=10, custo_unitario=c4.custo_unitario),
        ],
        roteiro=[
            Operacao(nome="Corte", maquina_id=m3.id, maquina_nome=m3.nome, tempo_maquina=3, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=3, tempo_mao_obra_unidade="min"),
            Operacao(nome="Prensagem", maquina_id=m2.id, maquina_nome=m2.nome, tempo_maquina=2, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=2, tempo_mao_obra_unidade="min"),
        ],
    )
    await db.artigos.insert_many([a1.model_dump(), a2.model_dump()])
    return {"ok": True, "message": "Dados de demonstração criados"}


@api_router.get("/")
async def root():
    return {"message": "Production Costing API"}


@api_router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)
    out = []
    for u in users:
        perfil = await resolve_perfil(u)
        out.append({
            "id": u.get("id"),
            "email": u.get("email"),
            "name": u.get("name", ""),
            "perfil_id": u.get("perfil_id") or perfil.get("id"),
            "perfil_nome": perfil.get("nome"),
            "role": "admin" if perfil.get("admin") else "colaborador",
            "created_at": u.get("created_at"),
        })
    return out


async def _resolve_perfil_id(perfil_id: Optional[str], role: Optional[str]) -> str:
    if perfil_id:
        p = await db.perfis.find_one({"id": perfil_id}, {"_id": 0})
        if not p:
            raise HTTPException(400, "Perfil inválido")
        return perfil_id
    # compat: derivar do role
    if role == "admin":
        p = await db.perfis.find_one({"sistema": True, "admin": True}, {"_id": 0})
    else:
        p = await db.perfis.find_one({"nome": "Colaborador", "sistema": True}, {"_id": 0})
    return p["id"] if p else None


@api_router.post("/users")
async def create_user(data: UserCreate, admin: dict = Depends(require_admin)):
    email = (data.email or "").strip().lower()
    if not email or not data.password:
        raise HTTPException(400, "Email e password obrigatórios")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Já existe um utilizador com este email")
    perfil_id = await _resolve_perfil_id(data.perfil_id, data.role)
    doc = {
        "id": new_id(),
        "email": email,
        "name": data.name or "",
        "perfil_id": perfil_id,
        "password_hash": hash_password(data.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return await user_public(doc)


@api_router.put("/users/{uid}")
async def update_user(uid: str, data: UserUpdate, admin: dict = Depends(require_admin)):
    user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Utilizador não encontrado")
    patch = {}
    if data.name is not None:
        patch["name"] = data.name
    if data.perfil_id is not None or data.role is not None:
        patch["perfil_id"] = await _resolve_perfil_id(data.perfil_id, data.role)
    if data.password:
        patch["password_hash"] = hash_password(data.password)
    if patch:
        await db.users.update_one({"id": uid}, {"$set": patch})
        user.update(patch)
    return await user_public(user)


@api_router.delete("/users/{uid}")
async def delete_user(uid: str, admin: dict = Depends(require_admin)):
    if uid == admin.get("id"):
        raise HTTPException(400, "Não pode eliminar a própria conta")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


# ----------------------- Perfis (RBAC) -----------------------
@api_router.get("/perfis")
async def list_perfis(admin: dict = Depends(require_admin)):
    perfis = await db.perfis.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return perfis


@api_router.get("/rbac/modulos")
async def rbac_modulos(admin: dict = Depends(require_admin)):
    labels = {
        "dashboard": "Dashboard", "clientes": "Clientes", "encomendas": "Encomendas",
        "artigos": "Artigos", "materiais": "Materiais",
        "maquinas": "Máquinas", "mao_obra": "Mão de Obra", "personalizacao": "Tipos de Personalização",
        "orcamentos": "Orçamentos", "ordens_fabrico": "Ordens de Fabrico",
        "analise_producao": "Análise da Produção", "utilizadores": "Gestão de Utilizadores",
    }
    return {"modulos": [{"key": m, "label": labels.get(m, m)} for m in RBAC_MODULES], "acoes": RBAC_ACTIONS}


def _normalize_perms(permissoes: dict, admin_flag: bool) -> dict:
    base = perms_all(True) if admin_flag else perms_all(False)
    for m in RBAC_MODULES:
        for a in RBAC_ACTIONS:
            v = (permissoes or {}).get(m, {}).get(a)
            if v is not None:
                base[m][a] = bool(v)
            elif admin_flag:
                base[m][a] = True
    return base


@api_router.post("/perfis")
async def create_perfil(data: PerfilInput, admin: dict = Depends(require_admin)):
    nome = (data.nome or "").strip()
    if not nome:
        raise HTTPException(400, "Nome obrigatório")
    if await db.perfis.find_one({"nome": nome}):
        raise HTTPException(400, "Já existe um perfil com este nome")
    doc = {
        "id": new_id(),
        "nome": nome,
        "sistema": False,
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
        "created_at": now_iso(),
    }
    await db.perfis.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/perfis/{pid}")
async def update_perfil(pid: str, data: PerfilInput, admin: dict = Depends(require_admin)):
    perfil = await db.perfis.find_one({"id": pid}, {"_id": 0})
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema") and perfil.get("admin"):
        raise HTTPException(400, "O perfil de Administrador não pode ser alterado")
    patch = {
        "nome": (data.nome or perfil["nome"]).strip(),
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
    }
    await db.perfis.update_one({"id": pid}, {"$set": patch})
    perfil.update(patch)
    return perfil


@api_router.delete("/perfis/{pid}")
async def delete_perfil(pid: str, admin: dict = Depends(require_admin)):
    perfil = await db.perfis.find_one({"id": pid}, {"_id": 0})
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema"):
        raise HTTPException(400, "Perfis de sistema não podem ser eliminados")
    in_use = await db.users.find_one({"perfil_id": pid})
    if in_use:
        raise HTTPException(400, "Perfil em uso por utilizadores")
    await db.perfis.delete_one({"id": pid})
    return {"ok": True}


async def seed_perfis():
    admin_p = await db.perfis.find_one({"sistema": True, "admin": True})
    if not admin_p:
        await db.perfis.insert_one({
            "id": new_id(), "nome": "Administrador", "sistema": True, "admin": True,
            "permissoes": perms_all(True), "created_at": now_iso(),
        })
    colab_p = await db.perfis.find_one({"nome": "Colaborador", "sistema": True})
    if not colab_p:
        await db.perfis.insert_one({
            "id": new_id(), "nome": "Colaborador", "sistema": True, "admin": False,
            "permissoes": perms_colaborador(), "created_at": now_iso(),
        })
    # migrar perfis existentes: garantir que todos os módulos existem nas permissões
    async for p in db.perfis.find({}):
        perms = p.get("permissoes") or {}
        changed = False
        col_defaults = perms_colaborador()
        for m in RBAC_MODULES:
            if m not in perms:
                if p.get("nome") == "Colaborador" and p.get("sistema"):
                    perms[m] = col_defaults[m]
                else:
                    perms[m] = {a: bool(p.get("admin")) for a in RBAC_ACTIONS}
                changed = True
            else:
                for a in RBAC_ACTIONS:
                    if a not in perms[m]:
                        perms[m][a] = bool(p.get("admin"))
                        changed = True
        if changed:
            await db.perfis.update_one({"id": p["id"]}, {"$set": {"permissoes": perms}})


async def seed_admin():
    email = os.environ.get("ADMIN_EMAIL", "admin@prodcost.pt").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "Admin123!")
    admin_p = await db.perfis.find_one({"sistema": True, "admin": True}, {"_id": 0})
    colab_p = await db.perfis.find_one({"nome": "Colaborador", "sistema": True}, {"_id": 0})
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": new_id(),
            "email": email,
            "name": "Admin Geral",
            "perfil_id": admin_p["id"] if admin_p else None,
            "password_hash": hash_password(password),
            "created_at": now_iso(),
        })
    else:
        patch = {}
        if not verify_password(password, existing.get("password_hash", "")):
            patch["password_hash"] = hash_password(password)
        if existing.get("name") == "Administrador":
            patch["name"] = "Admin Geral"
        if not existing.get("perfil_id") and admin_p:
            patch["perfil_id"] = admin_p["id"]
        if patch:
            await db.users.update_one({"email": email}, {"$set": patch})
    # migrar utilizadores sem perfil_id
    if colab_p:
        await db.users.update_many(
            {"perfil_id": {"$in": [None, ""]}, "role": {"$ne": "admin"}},
            {"$set": {"perfil_id": colab_p["id"]}},
        )


@app.on_event("startup")
async def _startup_seed_admin():
    await db.users.create_index("email", unique=True)
    await seed_perfis()
    await seed_admin()


app.include_router(auth_router)
app.include_router(api_router)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
