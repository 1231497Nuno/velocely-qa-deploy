"""Seed de arranque: perfis, admin e dados de demonstração."""
from datetime import date, timedelta

from app.core import config
from app.core.database import new_id, now_iso, next_sequence, round2
from app.core.security import hash_password
from app.domain.models import (
    RBAC_MODULES, RBAC_ACTIONS, perms_all, perms_colaborador,
    Maquina, MaoObra, Consumivel, TipoPersonalizacao, Artigo, ArtigoMaterial, Operacao,
    Cliente, Orcamento, Encomenda, OrdemFabrico, Categoria, Subcategoria,
)
from app.repositories import (
    perfis_repo, users_repo, maquinas_repo, mao_obra_repo, consumiveis_repo,
    tipos_repo, artigos_repo, clientes_repo, orcamentos_repo, encomendas_repo, ordens_repo,
    categorias_repo, subcategorias_repo,
)
from app.services.costing import fill_linha_custos, compute_orcamento_totais, build_of_itens, recompute_of_status
from app.services.numeracao import next_codigo


async def seed_perfis() -> None:
    admin_p = await perfis_repo.find_one({"sistema": True, "admin": True})
    if not admin_p:
        await perfis_repo.insert({
            "id": new_id(), "nome": "Administrador", "sistema": True, "admin": True,
            "permissoes": perms_all(True), "created_at": now_iso(),
        })
    colab_p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    if not colab_p:
        await perfis_repo.insert({
            "id": new_id(), "nome": "Colaborador", "sistema": True, "admin": False,
            "permissoes": perms_colaborador(), "created_at": now_iso(),
        })
    # migrar perfis existentes: garantir que todos os módulos existem nas permissões
    async for p in perfis_repo.cursor():
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
            await perfis_repo.update(p["id"], {"permissoes": perms})


async def seed_admin():
    """Cria o admin inicial se não existir. Nunca altera a password de um admin existente."""
    email = (config.ADMIN_EMAIL or "admin@velocely.local").strip().lower()
    password = config.ADMIN_PASSWORD or "Admin123!"
    admin_p = await perfis_repo.find_one({"sistema": True, "admin": True})
    colab_p = await perfis_repo.find_one({"nome": "Colaborador", "sistema": True})
    existing = await users_repo.find_one({"email": email})
    if not existing:
        await users_repo.insert({
            "id": new_id(),
            "login": email.split("@")[0],
            "email": email,
            "name": "Admin Geral",
            "cargo": "Administrador",
            "perfil_id": admin_p["id"] if admin_p else None,
            "password_hash": hash_password(password),
            "must_set_password": False,
            "status": "active",
            "created_at": now_iso(),
        })
    else:
        patch = {}
        if existing.get("name") == "Administrador":
            patch["name"] = "Admin Geral"
        if not existing.get("perfil_id") and admin_p:
            patch["perfil_id"] = admin_p["id"]
        if not existing.get("login"):
            patch["login"] = email.split("@")[0]
        if existing.get("must_set_password") is None:
            patch["must_set_password"] = False
        if not existing.get("status"):
            patch["status"] = "active"
        if patch:
            await users_repo.update_where({"email": email}, patch)
    if colab_p:
        await users_repo.update_many(
            {"perfil_id": {"$in": [None, ""]}, "role": {"$ne": "admin"}},
            {"perfil_id": colab_p["id"]},
        )


async def seed_user_logins() -> None:
    """Backfill do campo 'login' para utilizadores legado (derivado do email)."""
    usados = set()
    async for u in users_repo.cursor():
        if u.get("login"):
            usados.add((u["login"] or "").lower())
    async for u in users_repo.cursor():
        if u.get("login"):
            continue
        base = ((u.get("email") or "").split("@")[0] or f"user{u.get('id', '')[:6]}").lower()
        cand = base or "user"
        n = 1
        while cand in usados:
            n += 1
            cand = f"{base}{n}"
        usados.add(cand)
        await users_repo.update(u["id"], {"login": cand})


async def seed_categorias() -> bool:
    """Categorias / subcategorias de exemplo (Têxtil → T-shirt). Idempotente."""
    if await categorias_repo.count() > 0:
        return False
    cat_tex = Categoria(nome="Têxtil")
    cat_tex.codigo = await next_codigo("categoria")
    cat_rig = Categoria(nome="Rígido")
    cat_rig.codigo = await next_codigo("categoria")
    await categorias_repo.insert_many([cat_tex.model_dump(), cat_rig.model_dump()])

    subs = [
        Subcategoria(nome="T-shirt", categoria_id=cat_tex.id, categoria_nome=cat_tex.nome),
        Subcategoria(nome="Hoodie", categoria_id=cat_tex.id, categoria_nome=cat_tex.nome),
        Subcategoria(nome="Etiqueta", categoria_id=cat_rig.id, categoria_nome=cat_rig.nome),
        Subcategoria(nome="Placa", categoria_id=cat_rig.id, categoria_nome=cat_rig.nome),
    ]
    for s in subs:
        s.codigo = await next_codigo("subcategoria")
    await subcategorias_repo.insert_many([s.model_dump() for s in subs])
    return True


async def seed_catalogo() -> bool:
    """Catálogo base (máquinas, mão de obra, materiais, artigos). Idempotente."""
    await seed_categorias()
    if await artigos_repo.count() > 0:
        return False

    m1 = Maquina(nome="Impressora DTF UV", custo_amortizacao_hora=14.0, custo_energia_hora=6.0)
    m2 = Maquina(nome="Prensa Térmica", custo_amortizacao_hora=8.0, custo_energia_hora=4.0)
    m3 = Maquina(nome="Plotter de Corte", custo_amortizacao_hora=12.0, custo_energia_hora=3.0)
    for m in (m1, m2, m3):
        m.codigo = await next_codigo("maquina")
    await maquinas_repo.insert_many([m1.model_dump(), m2.model_dump(), m3.model_dump()])

    mo1 = MaoObra(nome="Operador de Produção", custo_hora=12.0)
    mo2 = MaoObra(nome="Designer", custo_hora=18.0)
    for m in (mo1, mo2):
        m.codigo = await next_codigo("mao_obra")
    await mao_obra_repo.insert_many([mo1.model_dump(), mo2.model_dump()])

    c1 = Consumivel(nome="Filme DTF UV (A4)", unidade="folha", custo_unitario=1.20)
    c2 = Consumivel(nome="Tinta UV", unidade="ml", custo_unitario=0.08)
    c3 = Consumivel(nome="Filme DTF Têxtil (A4)", unidade="folha", custo_unitario=0.45)
    c4 = Consumivel(nome="Pó Hot-Melt", unidade="g", custo_unitario=0.02)
    for c in (c1, c2, c3, c4):
        c.codigo = await next_codigo("material")
    await consumiveis_repo.insert_many([c1.model_dump(), c2.model_dump(), c3.model_dump(), c4.model_dump()])

    tipos = [
        TipoPersonalizacao(nome="DTF UV", descricao="Transfer DTF UV para superfícies rígidas"),
        TipoPersonalizacao(nome="DTF Têxtil", descricao="Transfer DTF para tecidos"),
        TipoPersonalizacao(nome="Vinil de Corte", descricao="Aplicação de vinil recortado"),
    ]
    for t in tipos:
        t.codigo = await next_codigo("tipo_personalizacao")
    await tipos_repo.insert_many([t.model_dump() for t in tipos])

    cat_tex = await categorias_repo.find_one({"nome": "Têxtil"}) or {}
    cat_rig = await categorias_repo.find_one({"nome": "Rígido"}) or {}
    sub_eti = await subcategorias_repo.find_one({"nome": "Etiqueta"}) or {}
    sub_tshirt = await subcategorias_repo.find_one({"nome": "T-shirt"}) or {}

    a1 = Artigo(
        nome="DTF UV",
        descricao="Etiqueta DTF UV premium",
        margem=40.0,
        categoria_id=cat_rig.get("id"),
        categoria_nome=cat_rig.get("nome") or "",
        subcategoria_id=sub_eti.get("id"),
        subcategoria_nome=sub_eti.get("nome") or "",
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
        categoria_id=cat_tex.get("id"),
        categoria_nome=cat_tex.get("nome") or "",
        subcategoria_id=sub_tshirt.get("id"),
        subcategoria_nome=sub_tshirt.get("nome") or "",
        materiais=[
            ArtigoMaterial(material_id=c3.id, material_nome=c3.nome, unidade=c3.unidade, quantidade=1, custo_unitario=c3.custo_unitario),
            ArtigoMaterial(material_id=c4.id, material_nome=c4.nome, unidade=c4.unidade, quantidade=10, custo_unitario=c4.custo_unitario),
        ],
        roteiro=[
            Operacao(nome="Corte", maquina_id=m3.id, maquina_nome=m3.nome, tempo_maquina=3, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=3, tempo_mao_obra_unidade="min"),
            Operacao(nome="Prensagem", maquina_id=m2.id, maquina_nome=m2.nome, tempo_maquina=2, tempo_maquina_unidade="min", mao_obra_id=mo1.id, mao_obra_nome=mo1.nome, tempo_mao_obra=2, tempo_mao_obra_unidade="min"),
        ],
    )
    a1.codigo = await next_codigo("artigo")
    a2.codigo = await next_codigo("artigo")
    await artigos_repo.insert_many([a1.model_dump(), a2.model_dump()])
    return True


async def seed_demo_negocio() -> bool:
    """Clientes, orçamentos (vários estados), encomendas e OFs para desenvolvimento. Idempotente."""
    # Só considera “já seedado” se existir o pacote demo (clientes + orçamentos).
    if await clientes_repo.count() > 0 and await orcamentos_repo.count() > 0:
        return False
    if await artigos_repo.count() == 0:
        await seed_catalogo()

    artigos = await artigos_repo.find(limit=10)
    a1 = artigos[0]
    a2 = artigos[1] if len(artigos) > 1 else artigos[0]
    hoje = date.today()

    clientes_specs = [
        {"nome": "PrintShop Lisboa", "tipo": "empresa", "cidade": "Lisboa", "email": "encomendas@printshop.pt", "nif": "501234567", "contacto": "912 345 678"},
        {"nome": "Merchandising Norte", "tipo": "empresa", "cidade": "Porto", "email": "compras@merchnorte.pt", "nif": "508765432", "contacto": "913 222 111"},
        {"nome": "Eventos & Brindes Lda", "tipo": "empresa", "cidade": "Braga", "email": "geral@eventosbrindes.pt", "nif": "509998877", "contacto": "914 555 000"},
        {"nome": "Café Central", "tipo": "empresa", "cidade": "Coimbra", "email": "cafe@central.pt", "nif": "510112233", "contacto": "239 111 222"},
    ]
    clientes = []
    for spec in clientes_specs:
        c = Cliente(**spec, pais="Portugal", morada="Rua Demo, 1", codigo_postal="1000-001")
        c.codigo = await next_codigo("cliente")
        await clientes_repo.insert(c.model_dump())
        clientes.append(c)

    async def _orc(cliente, artigo, qtd, status, dias_atras=0, descricao="", validade_dias=30):
        linhas = await fill_linha_custos([{
            "id": new_id(),
            "artigo_id": artigo["id"],
            "artigo_nome": artigo.get("nome", ""),
            "quantidade": qtd,
        }])
        o = Orcamento(
            cliente=cliente.nome,
            cliente_id=cliente.id,
            descricao=descricao or f"Proposta {artigo.get('nome')}",
            data=(hoje - timedelta(days=dias_atras)).isoformat(),
            validade=(hoje - timedelta(days=dias_atras) + timedelta(days=validade_dias)).isoformat(),
            status=status,
            linhas=linhas,
        )
        o.numero = await next_sequence("ORC")
        doc = o.model_dump()
        tot = compute_orcamento_totais(doc)
        await orcamentos_repo.insert(doc)
        return tot

    # Abertos
    await _orc(clientes[0], a1, 50, "rascunho", 1, "Etiquetas garrafa — rascunho")
    await _orc(clientes[1], a2, 100, "rascunho", 0, "Transfers t-shirt staff")
    await _orc(clientes[0], a1, 200, "enviado", 5, "Campanha verão UV")
    await _orc(clientes[2], a2, 75, "enviado", 3, "Kits evento corporativo")
    # Aceites (alguns convertidos)
    orc_aceite1 = await _orc(clientes[1], a1, 150, "aceite", 10, "Etiquetas pack retalho")
    orc_aceite2 = await _orc(clientes[3], a2, 40, "aceite", 8, "Uniformes café")
    # Rejeitados
    await _orc(clientes[2], a1, 500, "rejeitado", 20, "Orçamento alto — rejeitado")
    await _orc(clientes[0], a2, 30, "rejeitado", 12, "Alternativa cancelada")

    admin = await users_repo.find_one({"email": (config.ADMIN_EMAIL or "admin@velocely.local").strip().lower()})
    admin_id = admin["id"] if admin else None
    admin_nome = (admin or {}).get("name") or "Admin Geral"

    async def _converter_e_of(orc_doc, of_status="pendente", prioritaria=False, prazo_dias=14):
        orc_t = compute_orcamento_totais(orc_doc)
        enc_artigos = [
            {
                "id": new_id(),
                "artigo_id": l.get("artigo_id"),
                "artigo_nome": l.get("artigo_nome", ""),
                "quantidade": l.get("quantidade", 1),
                "preco_unit": l.get("preco_unit") or 0,
                "personalizacoes": l.get("personalizacoes") or [],
            }
            for l in orc_doc.get("linhas", [])
        ]
        enc = Encomenda(
            cliente=orc_doc.get("cliente", ""),
            cliente_id=orc_doc.get("cliente_id"),
            descricao=orc_doc.get("descricao", ""),
            data=hoje.isoformat(),
            prazo_entrega=(hoje + timedelta(days=prazo_dias)).isoformat(),
            estado="aberta",
            notas=f"Demo a partir de {orc_doc.get('numero')}",
            artigos=enc_artigos,
            valor_total=orc_t.get("total"),
            orcamento_id=orc_doc["id"],
            orcamento_numero=orc_doc.get("numero"),
        )
        enc.numero = await next_sequence("ENC")
        await encomendas_repo.insert(enc.model_dump())
        await orcamentos_repo.update(orc_doc["id"], {
            "encomenda_id": enc.id,
            "encomenda_numero": enc.numero,
            "status": "aceite",
        })

        itens = await build_of_itens([
            {
                "id": new_id(),
                "artigo_id": a["artigo_id"],
                "artigo_nome": a.get("artigo_nome", ""),
                "quantidade": a.get("quantidade", 1),
                "preco_unit": a.get("preco_unit") or 0,
            }
            for a in enc_artigos
        ])
        of = OrdemFabrico(
            cliente=enc.cliente,
            cliente_id=enc.cliente_id,
            encomenda_id=enc.id,
            descricao=enc.descricao,
            data=hoje.isoformat(),
            status=of_status,
            prioritaria=prioritaria,
            responsavel_id=admin_id,
            responsavel_nome=admin_nome,
            itens=itens,
            orcamento_id=orc_doc["id"],
            orcamento_numero=orc_doc.get("numero"),
            encomenda_numero=enc.numero,
        )
        of.numero = await next_sequence("OF")
        doc = of.model_dump()
        doc = recompute_of_status(doc)
        # Forçar estado de demo após recompute (recompute pode recalcular a partir de ops)
        doc["status"] = of_status
        if of_status == "concluido":
            for it in doc.get("itens", []):
                for op in it.get("operacoes", []):
                    op["concluida"] = True
            doc = recompute_of_status(doc)
            doc["status"] = "concluido"
        elif of_status == "em_producao":
            # marcar primeira operação em curso
            for it in doc.get("itens", []):
                ops = it.get("operacoes") or []
                if ops:
                    ops[0]["timer_inicio"] = now_iso()
                    break
            doc = recompute_of_status(doc)
            doc["status"] = "em_producao"
        await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})
        return enc, doc

    await _converter_e_of(orc_aceite1, of_status="em_producao", prioritaria=True, prazo_dias=7)
    await _converter_e_of(orc_aceite2, of_status="pendente", prioritaria=False, prazo_dias=21)

    # OF concluída sem orçamento ligado (encomenda direta)
    c = clientes[3]
    itens = await build_of_itens([{
        "id": new_id(),
        "artigo_id": a1["id"],
        "artigo_nome": a1.get("nome", ""),
        "quantidade": 25,
    }])
    enc = Encomenda(
        cliente=c.nome, cliente_id=c.id, descricao="Reposição stock",
        data=(hoje - timedelta(days=30)).isoformat(),
        prazo_entrega=(hoje - timedelta(days=5)).isoformat(),
        estado="concluida", artigos=[{
            "id": new_id(), "artigo_id": a1["id"], "artigo_nome": a1.get("nome", ""),
            "quantidade": 25, "preco_unit": round2((itens[0].get("preco_unit") or 0)),
        }],
    )
    enc.numero = await next_sequence("ENC")
    await encomendas_repo.insert(enc.model_dump())
    of = OrdemFabrico(
        cliente=c.nome, cliente_id=c.id, encomenda_id=enc.id,
        descricao="Reposição stock", data=(hoje - timedelta(days=28)).isoformat(),
        status="concluido", itens=itens, encomenda_numero=enc.numero,
        responsavel_id=admin_id, responsavel_nome=admin_nome,
    )
    of.numero = await next_sequence("OF")
    doc = of.model_dump()
    for it in doc.get("itens", []):
        for op in it.get("operacoes", []):
            op["concluida"] = True
            op["tempo_real_seg"] = 600
    doc = recompute_of_status(doc)
    doc["status"] = "concluido"
    await ordens_repo.insert({k: v for k, v in doc.items() if k != "progresso"})

    return True
