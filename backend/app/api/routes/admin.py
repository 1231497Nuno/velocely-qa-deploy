from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.core.database import new_id, now_iso
from app.core.security import require_admin, resolve_perfil, user_public, hash_password, get_current_user
from app.domain.models import (
    UserCreate, UserUpdate, PerfilInput, RBAC_MODULES, RBAC_ACTIONS, perms_all,
    Maquina, MaoObra, Consumivel, TipoPersonalizacao, Artigo, ArtigoMaterial, Operacao,
)
from app.repositories import (
    users_repo, perfis_repo, maquinas_repo, mao_obra_repo, consumiveis_repo, tipos_repo, artigos_repo,
)

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "Production Costing API"}


# ----------------------- Utilizadores -----------------------
@router.get("/utilizadores-lista")
async def utilizadores_lista(_u: dict = Depends(get_current_user)):
    """Lista simples de utilizadores (id/nome/login) para atribuições. Requer apenas autenticação."""
    users = await users_repo.find(sort=("name", 1), projection={"password_hash": 0})
    return [
        {
            "id": u.get("id"),
            "nome": u.get("name") or u.get("login") or (u.get("email") or "").split("@")[0],
            "login": u.get("login") or (u.get("email") or "").split("@")[0],
        }
        for u in users
    ]


@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    users = await users_repo.find(sort=("created_at", 1), projection={"password_hash": 0})
    out = []
    for u in users:
        perfil = await resolve_perfil(u)
        out.append({
            "id": u.get("id"),
            "login": u.get("login") or (u.get("email") or "").split("@")[0],
            "email": u.get("email"),
            "name": u.get("name", ""),
            "cargo": u.get("cargo", ""),
            "perfil_id": u.get("perfil_id") or perfil.get("id"),
            "perfil_nome": perfil.get("nome"),
            "role": "admin" if perfil.get("admin") else "colaborador",
            "created_at": u.get("created_at"),
        })
    return out


async def _resolve_perfil_id(perfil_id: Optional[str], role: Optional[str]) -> str:
    if perfil_id:
        p = await perfis_repo.get(perfil_id)
        if not p:
            raise HTTPException(400, "Perfil inválido")
        return perfil_id
    if role == "admin":
        p = await perfis_repo.find_one({"sistema": True, "admin": True})
    else:
        p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    return p["id"] if p else None


@router.post("/users")
async def create_user(data: UserCreate, admin: dict = Depends(require_admin)):
    email = (data.email or "").strip().lower()
    login = (data.login or "").strip().lower() or (email.split("@")[0] if email else "")
    if not login or not data.password:
        raise HTTPException(400, "Login e password obrigatórios")
    if await users_repo.find_one({"login": login}):
        raise HTTPException(400, "Já existe um utilizador com este login")
    if email and await users_repo.find_one({"email": email}):
        raise HTTPException(400, "Já existe um utilizador com este email")
    perfil_id = await _resolve_perfil_id(data.perfil_id, data.role)
    doc = {
        "id": new_id(),
        "login": login,
        "email": email,
        "name": data.name or "",
        "cargo": data.cargo or "",
        "perfil_id": perfil_id,
        "password_hash": hash_password(data.password),
        "created_at": now_iso(),
    }
    await users_repo.insert(doc)
    return await user_public(doc)


@router.put("/users/{uid}")
async def update_user(uid: str, data: UserUpdate, admin: dict = Depends(require_admin)):
    user = await users_repo.get(uid)
    if not user:
        raise HTTPException(404, "Utilizador não encontrado")
    patch = {}
    if data.login is not None:
        login = data.login.strip().lower()
        if login and login != user.get("login"):
            if await users_repo.find_one({"login": login, "id": {"$ne": uid}}):
                raise HTTPException(400, "Já existe um utilizador com este login")
            patch["login"] = login
    if data.email is not None:
        patch["email"] = data.email.strip().lower()
    if data.name is not None:
        patch["name"] = data.name
    if data.cargo is not None:
        patch["cargo"] = data.cargo
    if data.perfil_id is not None or data.role is not None:
        patch["perfil_id"] = await _resolve_perfil_id(data.perfil_id, data.role)
    if data.password:
        patch["password_hash"] = hash_password(data.password)
    if patch:
        await users_repo.update(uid, patch)
        user.update(patch)
    return await user_public(user)


@router.delete("/users/{uid}")
async def delete_user(uid: str, admin: dict = Depends(require_admin)):
    if uid == admin.get("id"):
        raise HTTPException(400, "Não pode eliminar a própria conta")
    await users_repo.delete({"id": uid})
    return {"ok": True}


# ----------------------- Perfis (RBAC) -----------------------
@router.get("/perfis")
async def list_perfis(admin: dict = Depends(require_admin)):
    return await perfis_repo.find(sort=("created_at", 1))


@router.get("/rbac/modulos")
async def rbac_modulos(admin: dict = Depends(require_admin)):
    labels = {
        "dashboard": "Dashboard", "clientes": "Clientes", "encomendas": "Encomendas",
        "artigos": "Artigos", "materiais": "Materiais",
        "maquinas": "Máquinas", "mao_obra": "Mão de Obra", "personalizacao": "Tipos de Personalização",
        "orcamentos": "Orçamentos", "ordens_fabrico": "Ordens de Fabrico",
        "analise_producao": "Análise da Produção", "rentabilidade": "Rentabilidade por Cliente",
        "calendario": "Calendário", "historico": "Histórico", "definicoes": "Definições",
        "utilizadores": "Gestão de Utilizadores",
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


@router.post("/perfis")
async def create_perfil(data: PerfilInput, admin: dict = Depends(require_admin)):
    nome = (data.nome or "").strip()
    if not nome:
        raise HTTPException(400, "Nome obrigatório")
    if await perfis_repo.find_one({"nome": nome}):
        raise HTTPException(400, "Já existe um perfil com este nome")
    doc = {
        "id": new_id(),
        "nome": nome,
        "sistema": False,
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
        "created_at": now_iso(),
    }
    await perfis_repo.insert(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/perfis/{pid}")
async def update_perfil(pid: str, data: PerfilInput, admin: dict = Depends(require_admin)):
    perfil = await perfis_repo.get(pid)
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema") and perfil.get("admin"):
        raise HTTPException(400, "O perfil de Administrador não pode ser alterado")
    patch = {
        "nome": (data.nome or perfil["nome"]).strip(),
        "admin": bool(data.admin),
        "permissoes": _normalize_perms(data.permissoes, data.admin),
    }
    await perfis_repo.update(pid, patch)
    perfil.update(patch)
    return perfil


@router.delete("/perfis/{pid}")
async def delete_perfil(pid: str, admin: dict = Depends(require_admin)):
    perfil = await perfis_repo.get(pid)
    if not perfil:
        raise HTTPException(404, "Perfil não encontrado")
    if perfil.get("sistema"):
        raise HTTPException(400, "Perfis de sistema não podem ser eliminados")
    in_use = await users_repo.find_one({"perfil_id": pid})
    if in_use:
        raise HTTPException(400, "Perfil em uso por utilizadores")
    await perfis_repo.delete({"id": pid})
    return {"ok": True}


# ----------------------- Seed demo data -----------------------
@router.post("/seed")
async def seed():
    if await artigos_repo.count() > 0:
        return {"ok": True, "message": "Dados já existem"}

    m1 = Maquina(nome="Impressora DTF UV", custo_amortizacao_hora=14.0, custo_energia_hora=6.0)
    m2 = Maquina(nome="Prensa Térmica", custo_amortizacao_hora=8.0, custo_energia_hora=4.0)
    m3 = Maquina(nome="Plotter de Corte", custo_amortizacao_hora=12.0, custo_energia_hora=3.0)
    await maquinas_repo.insert_many([m1.model_dump(), m2.model_dump(), m3.model_dump()])

    mo1 = MaoObra(nome="Operador de Produção", custo_hora=12.0)
    mo2 = MaoObra(nome="Designer", custo_hora=18.0)
    await mao_obra_repo.insert_many([mo1.model_dump(), mo2.model_dump()])

    c1 = Consumivel(nome="Filme DTF UV (A4)", unidade="folha", custo_unitario=1.20)
    c2 = Consumivel(nome="Tinta UV", unidade="ml", custo_unitario=0.08)
    c3 = Consumivel(nome="Filme DTF Têxtil (A4)", unidade="folha", custo_unitario=0.45)
    c4 = Consumivel(nome="Pó Hot-Melt", unidade="g", custo_unitario=0.02)
    await consumiveis_repo.insert_many(
        [c1.model_dump(), c2.model_dump(), c3.model_dump(), c4.model_dump()]
    )

    tipos = [
        TipoPersonalizacao(nome="DTF UV", descricao="Transfer DTF UV para superfícies rígidas"),
        TipoPersonalizacao(nome="DTF Têxtil", descricao="Transfer DTF para tecidos"),
        TipoPersonalizacao(nome="Vinil de Corte", descricao="Aplicação de vinil recortado"),
    ]
    await tipos_repo.insert_many([t.model_dump() for t in tipos])

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
    await artigos_repo.insert_many([a1.model_dump(), a2.model_dump()])
    return {"ok": True, "message": "Dados de demonstração criados"}
