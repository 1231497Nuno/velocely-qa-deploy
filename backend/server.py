from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


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


# ----------------------- Models -----------------------
class Maquina(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    custo_hora: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class MaquinaInput(BaseModel):
    nome: str
    custo_hora: float = 0.0


class Operacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    maquina_id: Optional[str] = None
    maquina_nome: Optional[str] = None
    tempo_min: float = 0.0


class Artigo(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    descricao: str = ""
    custo_materiais: float = 0.0
    custo_mao_obra: float = 0.0
    custo_overhead: float = 0.0
    roteiro: List[Operacao] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)

    @property
    def custo_maquinas(self) -> float:
        return round2(sum((op.tempo_min / 60.0) * 0 for op in self.roteiro))


class ArtigoInput(BaseModel):
    nome: str
    descricao: str = ""
    custo_materiais: float = 0.0
    custo_mao_obra: float = 0.0
    custo_overhead: float = 0.0
    roteiro: List[Operacao] = Field(default_factory=list)


class TipoPersonalizacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    descricao: str = ""
    created_at: str = Field(default_factory=now_iso)


class TipoPersonalizacaoInput(BaseModel):
    nome: str
    descricao: str = ""


class OrcamentoLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    quantidade: float = 1
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    custo_producao_unit: float = 0.0


class OrcamentoInput(BaseModel):
    cliente: str
    data: Optional[str] = None
    validade: Optional[str] = None
    status: str = "rascunho"
    margem: float = 0.0
    notas: str = ""
    linhas: List[OrcamentoLinha] = Field(default_factory=list)


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
    tempo_min: float = 0.0
    concluida: bool = False


class OFItem(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    quantidade: float = 1
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    operacoes: List[OFOperacao] = Field(default_factory=list)


class OrdemFabricoInput(BaseModel):
    cliente: str
    data: Optional[str] = None
    status: str = "pendente"
    notas: str = ""
    itens: List[OFItem] = Field(default_factory=list)


class OrdemFabrico(OrdemFabricoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Cost computation -----------------------
async def artigo_custo_total(artigo: dict) -> float:
    custo_maquinas = 0.0
    maquinas_cache = {}
    for op in artigo.get("roteiro", []):
        mid = op.get("maquina_id")
        tempo = op.get("tempo_min") or 0
        custo_hora = 0.0
        if mid:
            if mid not in maquinas_cache:
                m = await db.maquinas.find_one({"id": mid}, {"_id": 0})
                maquinas_cache[mid] = (m or {}).get("custo_hora", 0.0)
            custo_hora = maquinas_cache[mid]
        custo_maquinas += (tempo / 60.0) * custo_hora
    total = (
        (artigo.get("custo_materiais") or 0)
        + (artigo.get("custo_mao_obra") or 0)
        + (artigo.get("custo_overhead") or 0)
        + custo_maquinas
    )
    return round2(total)


def enrich_artigo(artigo: dict, custo_total: float) -> dict:
    artigo = {**artigo}
    artigo["custo_producao_total"] = custo_total
    return artigo


def compute_orcamento_totais(orc: dict) -> dict:
    subtotal = 0.0
    for l in orc.get("linhas", []):
        subtotal += (l.get("custo_producao_unit") or 0) * (l.get("quantidade") or 0)
    subtotal = round2(subtotal)
    margem = orc.get("margem") or 0
    total = round2(subtotal * (1 + margem / 100.0))
    orc = {**orc}
    orc["subtotal_custo"] = subtotal
    orc["total"] = total
    orc["lucro"] = round2(total - subtotal)
    return orc


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


# ----------------------- Routes: Artigos -----------------------
@api_router.get("/artigos")
async def list_artigos():
    artigos = await db.artigos.find({}, {"_id": 0}).sort("nome", 1).to_list(1000)
    result = []
    for a in artigos:
        result.append(enrich_artigo(a, await artigo_custo_total(a)))
    return result


@api_router.get("/artigos/{aid}")
async def get_artigo(aid: str):
    a = await db.artigos.find_one({"id": aid}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Artigo não encontrado")
    return enrich_artigo(a, await artigo_custo_total(a))


@api_router.post("/artigos")
async def create_artigo(data: ArtigoInput):
    a = Artigo(**data.model_dump())
    doc = a.model_dump()
    await db.artigos.insert_one(doc)
    doc.pop("_id", None)
    return enrich_artigo(doc, await artigo_custo_total(doc))


@api_router.put("/artigos/{aid}")
async def update_artigo(aid: str, data: ArtigoInput):
    existing = await db.artigos.find_one({"id": aid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Artigo não encontrado")
    update = data.model_dump()
    await db.artigos.update_one({"id": aid}, {"$set": update})
    existing.update(update)
    return enrich_artigo(existing, await artigo_custo_total(existing))


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
            l["custo_producao_unit"] = await artigo_custo_total(a)
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


@api_router.post("/orcamentos")
async def create_orcamento(data: OrcamentoInput):
    o = Orcamento(**data.model_dump())
    o.numero = await next_sequence("ORC")
    if not o.data:
        o.data = now_iso()[:10]
    doc = o.model_dump()
    doc["linhas"] = await fill_linha_custos(doc.get("linhas", []))
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
    if all_ops:
        done = sum(1 for op in all_ops if op.get("concluida"))
        if done == 0:
            of["status"] = "pendente"
        elif done == len(all_ops):
            of["status"] = "concluido"
        else:
            of["status"] = "em_producao"
        of["progresso"] = round2(done / len(all_ops) * 100)
    else:
        of["progresso"] = 0
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
                    operacoes.append(
                        OFOperacao(
                            nome=op.get("nome", ""),
                            maquina_nome=op.get("maquina_nome"),
                            tempo_min=op.get("tempo_min", 0),
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


@api_router.post("/ordens-fabrico")
async def create_of(data: OrdemFabricoInput):
    of = OrdemFabrico(**data.model_dump())
    of.numero = await next_sequence("OF")
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


@api_router.post("/ordens-fabrico/{ofid}/toggle-operacao")
async def toggle_operacao(ofid: str, body: ToggleOp):
    of = await db.ordens_fabrico.find_one({"id": ofid}, {"_id": 0})
    if not of:
        raise HTTPException(404, "OF não encontrada")
    for it in of.get("itens", []):
        if it.get("id") == body.item_id:
            for op in it.get("operacoes", []):
                if op.get("id") == body.operacao_id:
                    op["concluida"] = body.concluida
    of = recompute_of_status(of)
    to_save = {k: v for k, v in of.items() if k != "progresso"}
    await db.ordens_fabrico.update_one({"id": ofid}, {"$set": to_save})
    return of


@api_router.delete("/ordens-fabrico/{ofid}")
async def delete_of(ofid: str):
    await db.ordens_fabrico.delete_one({"id": ofid})
    return {"ok": True}


@api_router.post("/orcamentos/{oid}/converter")
async def converter_orcamento(oid: str):
    orc = await db.orcamentos.find_one({"id": oid}, {"_id": 0})
    if not orc:
        raise HTTPException(404, "Orçamento não encontrado")
    if orc.get("status") != "aceite":
        raise HTTPException(400, "Apenas orçamentos com estado 'Aceite' podem ser convertidos")
    if orc.get("of_id"):
        existing = await db.ordens_fabrico.find_one({"id": orc["of_id"]}, {"_id": 0})
        if existing:
            return recompute_of_status(existing)

    itens = []
    for l in orc.get("linhas", []):
        itens.append(
            {
                "artigo_id": l.get("artigo_id"),
                "artigo_nome": l.get("artigo_nome"),
                "quantidade": l.get("quantidade", 1),
                "tipo_personalizacao_id": l.get("tipo_personalizacao_id"),
                "tipo_personalizacao_nome": l.get("tipo_personalizacao_nome"),
            }
        )
    of = OrdemFabrico(
        cliente=orc.get("cliente", ""),
        data=now_iso()[:10],
        status="pendente",
        notas=f"Gerada a partir do orçamento {orc.get('numero')}",
    )
    of.numero = await next_sequence("OF")
    of.orcamento_id = orc["id"]
    of.orcamento_numero = orc.get("numero")
    doc = of.model_dump()
    doc["itens"] = await build_of_itens(itens)
    doc = recompute_of_status(doc)
    await db.ordens_fabrico.insert_one({k: v for k, v in doc.items() if k != "progresso"})
    await db.orcamentos.update_one(
        {"id": oid}, {"$set": {"of_id": of.id, "of_numero": of.numero}}
    )
    return doc


# ----------------------- Dashboard -----------------------
@api_router.get("/dashboard")
async def dashboard():
    artigos = await db.artigos.find({}, {"_id": 0}).to_list(1000)
    custos = [await artigo_custo_total(a) for a in artigos]
    orcs = await db.orcamentos.find({}, {"_id": 0}).to_list(1000)
    orcs_t = [compute_orcamento_totais(o) for o in orcs]
    ofs = await db.ordens_fabrico.find({}, {"_id": 0}).to_list(1000)
    ofs_t = [recompute_of_status(o) for o in ofs]
    return {
        "total_artigos": len(artigos),
        "total_maquinas": await db.maquinas.count_documents({}),
        "total_tipos": await db.tipos_personalizacao.count_documents({}),
        "custo_medio": round2(sum(custos) / len(custos)) if custos else 0,
        "total_orcamentos": len(orcs_t),
        "valor_orcamentos": round2(sum(o["total"] for o in orcs_t)),
        "orcamentos_aceites": sum(1 for o in orcs_t if o.get("status") == "aceite"),
        "total_ofs": len(ofs_t),
        "ofs_em_producao": sum(1 for o in ofs_t if o.get("status") == "em_producao"),
        "ofs_concluidas": sum(1 for o in ofs_t if o.get("status") == "concluido"),
    }


# ----------------------- Seed demo data -----------------------
@api_router.post("/seed")
async def seed():
    if await db.artigos.count_documents({}) > 0:
        return {"ok": True, "message": "Dados já existem"}

    m1 = Maquina(nome="Impressora DTF UV", custo_hora=20.0)
    m2 = Maquina(nome="Prensa Térmica", custo_hora=12.0)
    m3 = Maquina(nome="Plotter de Corte", custo_hora=15.0)
    await db.maquinas.insert_many([m1.model_dump(), m2.model_dump(), m3.model_dump()])

    tipos = [
        TipoPersonalizacao(nome="DTF UV", descricao="Transfer DTF UV para superfícies rígidas"),
        TipoPersonalizacao(nome="DTF Têxtil", descricao="Transfer DTF para tecidos"),
        TipoPersonalizacao(nome="Vinil de Corte", descricao="Aplicação de vinil recortado"),
    ]
    await db.tipos_personalizacao.insert_many([t.model_dump() for t in tipos])

    a1 = Artigo(
        nome="DTF UV",
        descricao="Etiqueta DTF UV premium",
        custo_materiais=5.0,
        custo_mao_obra=3.75,
        custo_overhead=0.91,
        roteiro=[
            Operacao(nome="Impressão", maquina_id=m1.id, maquina_nome=m1.nome, tempo_min=4),
            Operacao(nome="Prensagem", maquina_id=m2.id, maquina_nome=m2.nome, tempo_min=2),
        ],
    )
    a2 = Artigo(
        nome="DTF Têxtil",
        descricao="Transfer têxtil para t-shirts",
        custo_materiais=2.35,
        custo_mao_obra=2.5,
        custo_overhead=0.51,
        roteiro=[
            Operacao(nome="Corte", maquina_id=m3.id, maquina_nome=m3.nome, tempo_min=3),
            Operacao(nome="Prensagem", maquina_id=m2.id, maquina_nome=m2.nome, tempo_min=2),
        ],
    )
    await db.artigos.insert_many([a1.model_dump(), a2.model_dump()])
    return {"ok": True, "message": "Dados de demonstração criados"}


@api_router.get("/")
async def root():
    return {"message": "Production Costing API"}


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
