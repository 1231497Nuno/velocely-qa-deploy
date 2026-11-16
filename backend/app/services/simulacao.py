"""Dados de simulação para testes: catálogo, clientes, CRM, orçamentos, encomendas, pagamentos, OF, compras e stock.

Tudo o que é criado leva `simulacao: True` (e «[SIM]» nos nomes) para se distinguir dos dados reais e poder ser
apagado de uma vez. Não emite documentos fiscais nem envia emails.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, next_sequence, now_iso, round2
from app.domain.models import (
    Artigo, ArtigoMaterial, Categoria, Cliente, Encomenda, EncomendaArtigo, Fornecedor, MaoObra, Maquina,
    NaoConformidade, Operacao, Orcamento, OrdemCompra, OrdemCompraLinha, OrdemFabrico, Pagamento, Subcategoria,
)
from app.repositories import (
    artigos_repo, categorias_repo, clientes_repo, crm_estados_repo, encomendas_repo, fornecedores_repo,
    historico_repo, inventarios_repo, leads_repo, mao_obra_repo, maquinas_repo, movimentos_stock_repo,
    nao_conformidades_repo, orcamentos_repo, ordens_compra_repo, ordens_repo, relatorios_guardados_repo,
    subcategorias_repo,
)
from app.services.numeracao import next_codigo

SIM = "[SIM]"
TAG = {"simulacao": True}

# Coleções com dados de simulação (ordem de remoção)
COLECOES = [
    ("relatorios_guardados", relatorios_guardados_repo), ("nao_conformidades", nao_conformidades_repo),
    ("ordens_fabrico", ordens_repo), ("encomendas", encomendas_repo), ("orcamentos", orcamentos_repo),
    ("leads", leads_repo), ("ordens_compra", ordens_compra_repo), ("artigos", artigos_repo),
    ("clientes", clientes_repo), ("fornecedores", fornecedores_repo), ("maquinas", maquinas_repo),
    ("mao_obra", mao_obra_repo), ("subcategorias", subcategorias_repo), ("categorias", categorias_repo),
]


def _d(dias_atras: int) -> str:
    return (date.today() - timedelta(days=dias_atras)).isoformat()


def _ts(dias_atras: int, hora: int = 10) -> str:
    d = date.today() - timedelta(days=dias_atras)
    return datetime(d.year, d.month, d.day, hora, 0, tzinfo=timezone.utc).isoformat()


async def estado() -> dict:
    out = {}
    for nome, repo in COLECOES:
        out[nome] = await repo.count({"simulacao": True})
    return {"existe": any(out.values()), "contagens": out}


async def apagar(user: dict) -> dict:
    artigo_ids = [a["id"] for a in await artigos_repo.find({"simulacao": True}, limit=5000)]
    ids_todos: List[str] = []
    contagens = {}
    for nome, repo in COLECOES:
        docs = await repo.find({"simulacao": True}, limit=20000)
        ids_todos += [d["id"] for d in docs]
        contagens[nome] = len(docs)
        await repo.col.delete_many({"simulacao": True})
    if artigo_ids:
        await movimentos_stock_repo.col.delete_many({"artigo_id": {"$in": artigo_ids}})
        # Inventários: retirar as linhas dos artigos de simulação
        for inv in await inventarios_repo.find({}, limit=500):
            linhas = [l for l in inv.get("linhas") or [] if l.get("artigo_id") not in artigo_ids]
            if len(linhas) != len(inv.get("linhas") or []):
                await inventarios_repo.update(inv["id"], {"linhas": linhas})
    if ids_todos:
        await historico_repo.col.delete_many({"entidade_id": {"$in": ids_todos}})
    return {"ok": True, "apagados": contagens}


async def criar(user: dict) -> dict:
    if (await estado())["existe"]:
        raise HTTPException(409, "Já existem dados de simulação — apague-os primeiro para criar de novo")
    from app.services.costing import artigo_breakdown, build_of_itens, fill_linha_custos, recompute_of_status
    from app.services import of_previsao, producao
    from app.services import stock as stock_svc
    rnd = random.Random(2026)
    quem = {"id": user.get("id"), "nome": user.get("name") or user.get("nome") or ""}

    # ---------------- Catálogo base ----------------
    async def categoria(nome, subs):
        c = Categoria(nome=f"{SIM} {nome}")
        c.codigo = await next_codigo("categoria")
        await categorias_repo.insert({**c.model_dump(), **TAG})
        out = {}
        for s in subs:
            sc = Subcategoria(nome=s, categoria_id=c.id, categoria_nome=c.nome)
            sc.codigo = await next_codigo("subcategoria")
            await subcategorias_repo.insert({**sc.model_dump(), **TAG})
            out[s] = (c, sc)
        return out

    cats = {}
    cats.update(await categoria("Matérias-primas", ["Placas", "Têxtil base", "Consumíveis"]))
    cats.update(await categoria("Personalizados", ["Placas e sinalética", "Vestuário", "Brindes", "Decoração"]))

    maqs = {}
    for nome, amort, ener, horas in [("Laser CO2", 9, 3, 35), ("Impressora UV plana", 12, 4, 30),
                                     ("Impressora DTF têxtil", 7, 3, 25), ("Prensa térmica", 2, 2, 30)]:
        m = Maquina(nome=f"{SIM} {nome}", custo_amortizacao_hora=amort, custo_energia_hora=ener, horas_semana=horas)
        m.codigo = await next_codigo("maquina")
        await maquinas_repo.insert({**m.model_dump(), **TAG})
        maqs[nome] = m
    mos = {}
    for nome, h in [("Operador", 11.5), ("Designer", 16)]:
        mo = MaoObra(nome=f"{SIM} {nome}", custo_hora=h)
        mo.codigo = await next_codigo("mao_obra")
        await mao_obra_repo.insert({**mo.model_dump(), **TAG})
        mos[nome] = mo

    forns = {}
    for nome, cidade, nif in [("Acrílicos do Norte", "Maia", "509000001"), ("THC Clothes", "Guimarães", "509000002"),
                              ("Makito", "Barcelos", "509000003"), ("Embalagens Minho", "Braga", "509000004")]:
        f = Fornecedor(nome=f"{SIM} {nome}", tipo="empresa", morada="Rua de Teste, 10", codigo_postal="4700-000",
                       cidade=cidade, contacto="253000000", email=f"geral@{nome.split()[0].lower()}.sim", nif=nif)
        f.codigo = await next_codigo("fornecedor")
        await fornecedores_repo.insert({**f.model_dump(), **TAG})
        forns[nome] = f

    async def artigo(nome, sub, **kw):
        c, sc = cats[sub]
        a = Artigo(nome=f"{SIM} {nome}", categoria_id=c.id, categoria_nome=c.nome, subcategoria_id=sc.id,
                   subcategoria_nome=sc.nome, **kw)
        a.codigo = await next_codigo("artigo")
        doc = {**a.model_dump(), **TAG}
        if doc.get("gere_stock"):
            doc["custo_medio"] = float(kw.get("custo_artigo") or 0)
        await artigos_repo.insert(doc)
        return doc

    def fsel(n):
        f = forns[n]
        return {"fornecedor_id": f.id, "fornecedor_nome": f.nome}

    mp = {
        "acr": await artigo("Acrílico 3 mm transparente", "Placas", tipo_artigo="materia_prima", unidade="m²", custo_artigo=38,
                            preco_compra=38, margem=60, gere_stock=True, qtd_stock=7.5, nivel_reabastecimento=5,
                            unidade_compra="placa", fator_compra=3.125, **fsel("Acrílicos do Norte")),
        "mdf": await artigo("MDF 3 mm", "Placas", tipo_artigo="materia_prima", unidade="m²", custo_artigo=9, preco_compra=9,
                            margem=60, gere_stock=True, qtd_stock=1.8, nivel_reabastecimento=4, unidade_compra="placa",
                            fator_compra=3.66, **fsel("Acrílicos do Norte")),
        "esp": await artigo("Acrílico espelhado dourado 3 mm", "Placas", tipo_artigo="materia_prima", unidade="m²",
                            custo_artigo=62, preco_compra=62, margem=60, gere_stock=True, qtd_stock=2.2,
                            nivel_reabastecimento=1.5, unidade_compra="placa", fator_compra=3.125, **fsel("Acrílicos do Norte")),
        "dtf": await artigo("Filme DTF têxtil 60 cm", "Consumíveis", tipo_artigo="consumivel", unidade="m", custo_artigo=9,
                            preco_compra=9, margem=75, gere_stock=True, qtd_stock=42, nivel_reabastecimento=30,
                            unidade_compra="rolo", fator_compra=100, **fsel("Embalagens Minho")),
        "tsh": await artigo("T-shirt Luanda branca", "Têxtil base", tipo_artigo="materia_prima", unidade="un", custo_artigo=2.6,
                            preco_compra=2.6, margem=100, gere_stock=True, qtd_stock=55, nivel_reabastecimento=40,
                            unidade_compra="caixa", fator_compra=50, cod_fornecedor="LUANDA-WH", **fsel("THC Clothes")),
        "pol": await artigo("Polo Bucharest preto", "Têxtil base", tipo_artigo="materia_prima", unidade="un", custo_artigo=6.9,
                            preco_compra=6.9, margem=100, gere_stock=True, qtd_stock=45, nivel_reabastecimento=20,
                            **fsel("THC Clothes")),
        "cx": await artigo("Caixa de cartão pequena", "Consumíveis", tipo_artigo="consumivel", unidade="un", custo_artigo=0.35,
                           preco_compra=0.35, margem=0, gere_stock=True, qtd_stock=480, nivel_reabastecimento=60,
                           unidade_compra="pack", fator_compra=25, **fsel("Embalagens Minho")),
        "esf": await artigo("Esferográfica metálica (brinde)", "Consumíveis", tipo_artigo="materia_prima", unidade="un",
                            custo_artigo=0.42, preco_compra=0.42, margem=100, gere_stock=False, **fsel("Makito")),
    }

    def mat(a, qtd):
        return ArtigoMaterial(material_id=a["id"], material_nome=a["nome"], unidade=a["unidade"], quantidade=qtd,
                              custo_unitario=float(a.get("custo_artigo") or 0))

    def op(nome, maq, t_maq, t_mo, mo="Operador"):
        m = maqs.get(maq) if maq else None
        return Operacao(nome=nome, maquina_id=m.id if m else None, maquina_nome=m.nome if m else None, tempo_maquina=t_maq,
                        tempo_maquina_unidade="min", mao_obra_id=mos[mo].id, mao_obra_nome=mos[mo].nome,
                        tempo_mao_obra=t_mo, tempo_mao_obra_unidade="min")

    pa = {
        "placa": await artigo("Placa informativa acrílico 30×20", "Placas e sinalética", tipo_artigo="ativo", produzido=True,
                              margem=120, materiais=[mat(mp["acr"], 0.06)],
                              roteiro=[op("Impressão UV", "Impressora UV plana", 4, 3), op("Corte laser", "Laser CO2", 3, 2)]),
        "porta": await artigo("Porta-chaves MDF gravado", "Brindes", tipo_artigo="ativo", produzido=True, margem=150,
                              materiais=[mat(mp["mdf"], 0.0025), mat(mp["cx"], 1)],
                              roteiro=[op("Gravação e corte laser", "Laser CO2", 1.5, 0.5)]),
        "tshirt": await artigo("T-shirt personalizada DTF", "Vestuário", tipo_artigo="ativo", produzido=True, margem=90,
                               materiais=[mat(mp["tsh"], 1), mat(mp["dtf"], 0.25)],
                               roteiro=[op("Impressão DTF", "Impressora DTF têxtil", 1.5, 1), op("Prensagem", "Prensa térmica", 0.5, 1)]),
        "polo": await artigo("Polo bordado de farda", "Vestuário", tipo_artigo="ativo", produzido=True, margem=80,
                             materiais=[mat(mp["pol"], 1), mat(mp["dtf"], 0.12)],
                             roteiro=[op("Impressão DTF", "Impressora DTF têxtil", 1, 1), op("Prensagem", "Prensa térmica", 0.5, 1)]),
        "espelho": await artigo("Espelho acrílico à medida", "Decoração", tipo_artigo="ativo", produzido=True, margem=110,
                                materiais=[mat(mp["esp"], 0.25)], roteiro=[op("Corte laser", "Laser CO2", 8, 5)]),
        "neon": await artigo("Néon LED personalizado", "Decoração", tipo_artigo="ativo", custo_artigo=85, margem=90,
                             gere_stock=False, **fsel("Makito")),
        "design": await artigo("Serviço de design", "Brindes", tipo_artigo="servico", custo_artigo=0, margem=0),
        "kit": await artigo("Kit brinde esferográfica gravada", "Brindes", tipo_artigo="ativo", produzido=True, margem=120,
                            materiais=[mat(mp["esf"], 1), mat(mp["cx"], 1)], roteiro=[op("Gravação laser", "Laser CO2", 0.8, 0.4)]),
    }
    preco = {}
    for k, a in pa.items():
        bd = await artigo_breakdown(a)
        preco[k] = round2(bd.get("preco_venda") or float(a.get("custo_artigo") or 0) * 2 or 25)
    preco["design"] = 35.0

    # ---------------- Clientes e CRM ----------------
    clientes_specs = [
        ("Ronfa Lavandarias", "empresa", "Ronfe", "509100001"), ("Café Central Famalicão", "empresa", "Vila Nova de Famalicão", "509100002"),
        ("Metalúrgica do Ave", "empresa", "Santo Tirso", "509100003"), ("Clube Desportivo Pedome", "empresa", "Pedome", "509100004"),
        ("Hotel Vale do Este", "empresa", "Braga", "509100005"), ("Ana Ribeiro", "particular", "Guimarães", ""),
        ("João Ferreira", "particular", "Famalicão", ""), ("Construções Lima & Filhos", "empresa", "Barcelos", "509100008"),
    ]
    clientes = []
    for i, (nome, tipo, cidade, nif) in enumerate(clientes_specs):
        c = Cliente(nome=f"{SIM} {nome}", tipo=tipo, morada=f"Rua da Simulação, {i + 1}", codigo_postal="4760-000",
                    cidade=cidade, contacto=f"91200000{i}", email=f"cliente{i + 1}@exemplo.sim", nif=nif,
                    condicoes_pagamento="30 dias" if tipo == "empresa" and i % 2 else "")
        c.codigo = await next_codigo("cliente")
        doc = {**c.model_dump(), **TAG, "created_at": _ts(200 - i * 20)}
        await clientes_repo.insert(doc)
        clientes.append(doc)

    estados_crm = await crm_estados_repo.find(sort=("ordem", 1), limit=50)
    abertos = [e for e in estados_crm if e.get("tipo") == "aberto"] or estados_crm
    ganho = next((e for e in estados_crm if e.get("tipo") == "ganho"), None)
    perdido = next((e for e in estados_crm if e.get("tipo") == "perdido"), None)
    leads_specs = [
        ("Rui Matos", "Padaria Matos", "Instagram", "Placas para a montra e menu", 450, abertos[0], 3, ""),
        ("Sofia Lopes", "", "Site", "50 t-shirts para despedida de solteira", 380, abertos[min(1, len(abertos) - 1)], 6, ""),
        ("Carla Dias", "Ginásio Fit Ave", "Recomendação", "Fardamento para 12 funcionários", 900, abertos[-1], 10, ""),
        ("Pedro Antunes", "Escola de Condução Norte", "Facebook", "Decoração de 3 viaturas", 1500, abertos[0], 1, ""),
        ("Marta Sousa", "Hotel Vale do Este", "Telefone", "Sinalética de quartos", 1200, ganho or abertos[-1], 30, ""),
        ("Tiago Costa", "Bar Ribeira", "Instagram", "Néon LED com o logótipo", 600, perdido or abertos[-1], 40, "Preço"),
    ]
    for nome, empresa, origem, desc, valor, est, dias, motivo in leads_specs:
        if not est:
            continue
        lead = {"id": new_id(), "nome": nome, "empresa": f"{SIM} {empresa}" if empresa else "", "telefone": "912345678",
                "email": f"{nome.split()[0].lower()}@exemplo.sim", "origem": origem, "descricao": desc, "valor_estimado": valor,
                "estado_id": est["id"], "ordem": rnd.randint(1, 1000), "responsavel_id": user.get("id"),
                "responsavel_nome": quem["nome"], "proxima_acao_at": _ts(-2) if est.get("tipo") == "aberto" else None,
                "proxima_acao_nota": "Ligar para fechar proposta" if est.get("tipo") == "aberto" else "",
                "motivo_perda": motivo, "campos_extra": {}, "cliente_id": None, "cliente_nome": "", "orcamento_ids": [],
                "interacoes": [{"id": new_id(), "tipo": "sistema", "texto": "Lead de simulação", "at": _ts(dias),
                                "por_id": quem["id"], "por_nome": quem["nome"]}],
                "criado_por_id": quem["id"], "criado_por_nome": quem["nome"], "created_at": _ts(dias), "updated_at": _ts(dias),
                "estado_desde": _ts(dias), "fechado_at": _ts(dias) if est.get("tipo") in ("ganho", "perdido") else None, **TAG}
        await leads_repo.insert(lead)

    # ---------------- Orçamentos e encomendas ----------------
    async def orcamento(cli, linhas, status, dias, desc):
        ls = await fill_linha_custos([{"id": new_id(), "artigo_id": pa[k]["id"], "artigo_nome": pa[k]["nome"], "quantidade": q,
                                       "preco_unit": preco[k]} for k, q in linhas])
        o = Orcamento(cliente=cli["nome"], cliente_id=cli["id"], descricao=desc, data=_d(dias), validade=_d(dias - 30),
                      status=status, linhas=ls)
        o.numero = await next_sequence("ORC")
        doc = {**o.model_dump(), **TAG, "created_at": _ts(dias), "updated_at": _ts(dias), "created_by": quem["id"]}
        await orcamentos_repo.insert(doc)
        return doc

    orc_specs = [
        (0, [("placa", 12)], "rascunho", 2, "Sinalética interior"),
        (4, [("espelho", 3)], "enviado", 6, "Espelhos para receção"),
        (7, [("placa", 30), ("porta", 200)], "enviado", 12, "Obra nova — placas e brindes"),
        (2, [("tshirt", 80)], "rejeitado", 50, "T-shirts torneio (alternativa)"),
        (6, [("tshirt", 15)], "rejeitado", 25, "T-shirts família"),
    ]
    for ci, linhas, st, dias, desc in orc_specs:
        await orcamento(clientes[ci], linhas, st, dias, desc)

    hoje = date.today()
    # (cliente, linhas, dias_atras, prazo_dias_desde_data, estado, pago_frac, entregue, of: None|"aberta"|"curso"|"fechada")
    enc_specs = [
        (0, [("placa", 6), ("porta", 100)], 170, 14, "concluida", 1.0, True, "fechada"),
        (1, [("tshirt", 25)], 150, 10, "concluida", 1.0, True, "fechada"),
        (2, [("polo", 40)], 125, 15, "concluida", 1.0, True, "fechada"),
        (3, [("tshirt", 60), ("kit", 50)], 100, 12, "concluida", 1.0, True, "fechada"),
        (4, [("espelho", 4), ("placa", 20)], 80, 20, "concluida", 1.0, True, "fechada"),
        (7, [("neon", 1), ("design", 2)], 60, 25, "concluida", 1.0, True, None),
        (5, [("tshirt", 6)], 45, 7, "concluida", 1.0, True, "fechada"),
        (0, [("porta", 150)], 30, 14, "concluida", 0.5, True, "fechada"),
        (2, [("polo", 25), ("tshirt", 25)], 18, 20, "em_producao", 1.0, False, "curso"),
        (3, [("kit", 120)], 12, 8, "em_producao", 0.5, False, "curso"),     # prazo já passou → atrasada
        (4, [("placa", 15)], 6, 14, "em_producao", 1.0, False, "aberta"),
        (6, [("espelho", 1)], 3, 10, "aberta", 0.0, False, None),          # por pagar → não entra em produção
        (1, [("tshirt", 40), ("design", 1)], 2, 12, "aberta", 0.3, False, None),
        (7, [("placa", 8)], 1, 5, "aberta", 1.0, False, "aberta"),
    ]
    metodos = ["transferencia", "mbway", "multibanco", "numerario", "cartao"]
    encs = []
    for ci, linhas, dias, prazo, est, frac, entregue, of_modo in enc_specs:
        cli = clientes[ci]
        orc = await orcamento(cli, linhas, "aceite", dias + 4, f"Pedido de {cli['nome'].replace(SIM, '').strip()}")
        artigos_enc = [EncomendaArtigo(artigo_id=pa[k]["id"], artigo_nome=pa[k]["nome"], artigo_codigo=pa[k]["codigo"], quantidade=q,
                                       preco_unit=preco[k], preco_unit_orcamento=preco[k],
                                       orcamento_linha_id=orc["linhas"][i]["id"], quantidade_orcamento=q).model_dump()
                       for i, (k, q) in enumerate(linhas)]
        total = round2(sum(a["quantidade"] * a["preco_unit"] for a in artigos_enc))
        pags = []
        if frac > 0:
            partes = [frac] if frac < 1 or rnd.random() < 0.6 else [0.5, 0.5]
            for j, p in enumerate(partes):
                pg = Pagamento(data=_d(max(dias - j * 10, 0)), valor=round2(total * p), metodo=rnd.choice(metodos),
                               nota="Sinal" if j == 0 and len(partes) > 1 else "")
                pg.recibo_numero = await next_sequence("REC")
                pags.append({**pg.model_dump(), "created_at": _ts(max(dias - j * 10, 0))})
        enc = Encomenda(cliente=cli["nome"], cliente_id=cli["id"], descricao=orc["descricao"], data=_d(dias),
                        prazo_entrega=(hoje - timedelta(days=dias) + timedelta(days=prazo)).isoformat(), estado=est,
                        artigos=artigos_enc, pagamentos=pags, valor_pago=round2(sum(p["valor"] for p in pags)),
                        autorizada_producao=frac >= 1 or of_modo is not None, entregue=entregue,
                        data_entrega=(hoje - timedelta(days=dias) + timedelta(days=prazo - 1)).isoformat() if entregue else None,
                        orcamento_id=orc["id"], orcamento_numero=orc["numero"])
        enc.numero = await next_sequence("ENC")
        doc = {**enc.model_dump(), **TAG, "created_at": _ts(dias), "created_by": quem["id"]}
        await encomendas_repo.insert(doc)
        await orcamentos_repo.update(orc["id"], {"encomenda_id": enc.id, "encomenda_numero": enc.numero})
        encs.append((doc, of_modo, dias))

    # ---------------- Ordens de fabrico ----------------
    n_of = 0
    for enc, of_modo, dias in encs:
        if not of_modo:
            continue
        pedidos = [{"enc_artigo_id": a["id"], "artigo_id": a["artigo_id"], "quantidade": a["quantidade"]}
                   for a in enc["artigos"] if pa_tipo(pa, a["artigo_id"]) != "servico"]
        itens = await of_previsao.montar_itens(enc, pedidos)
        of = OrdemFabrico(cliente=enc["cliente"], cliente_id=enc["cliente_id"], encomenda_id=enc["id"], descricao=enc["descricao"],
                          numero_encomenda=enc["numero"], data=_d(dias), prazo_entrega=enc["prazo_entrega"],
                          responsavel_id=quem["id"], responsavel_nome=quem["nome"], itens=itens)
        of.numero = await next_sequence("OF")
        of.orcamento_id = enc.get("orcamento_id")
        of.orcamento_numero = enc.get("orcamento_numero")
        doc = of.model_dump()
        doc["encomenda_numero"] = enc["numero"]
        doc["itens"] = await build_of_itens(doc["itens"])
        # Tempos reais simulados (±25% do estimado)
        if of_modo in ("curso", "fechada"):
            for it in doc["itens"]:
                for k, o in enumerate(it.get("operacoes") or []):
                    if of_modo == "curso" and k > 0:
                        continue
                    o["tempo_real_seg"] = round(float(o.get("tempo_mao_obra") or 0) * 60 * rnd.uniform(0.8, 1.3), 1)
                    o["tempo_maquina_real"] = round2(float(o.get("tempo_maquina") or 0) * rnd.uniform(0.85, 1.25))
                    o["concluida"] = True
        doc = recompute_of_status(doc)
        doc.pop("progresso", None)
        await ordens_repo.insert({**doc, **TAG, "created_at": _ts(dias)})
        n_of += 1
        if of_modo == "fechada":
            itens_fecho = []
            for it in doc["itens"]:
                refugo = rnd.choice([0, 0, 0, 1, 2]) if it["quantidade"] >= 10 else 0
                itens_fecho.append({"item_id": it["id"], "qtd_produzida": it["quantidade"], "qtd_refugo": refugo,
                                    "motivo_refugo": "Defeito de impressão" if refugo else "",
                                    "materiais": [{"id": m["id"], "qtd_consumida": round(float(m.get("quantidade") or 0)
                                                                                         * rnd.uniform(1.0, 1.12), 4)}
                                                  for m in it.get("materiais") or []]})
            await producao.fechar_of(doc["id"], {"itens": itens_fecho, "abater_stock": True, "entrada_stock": True,
                                                 "notas": "Fecho simulado"}, user)

    # ---------------- Não conformidade ----------------
    enc_nc = encs[3][0]
    linha = enc_nc["artigos"][0]
    nc = NaoConformidade(encomenda_id=enc_nc["id"], encomenda_artigo_id=linha["id"], artigo_id=linha["artigo_id"],
                         artigo_nome=linha["artigo_nome"], quantidade=3, tipo="defeito",
                         descricao="Estampa descentrada em 3 peças", acao_corretiva="Rever gabarito da prensa",
                         estado="fechada", custo_unitario=round2(preco["tshirt"] / 2), custo_desperdicio=round2(preco["tshirt"] * 1.5),
                         encomenda_numero=enc_nc["numero"], cliente=enc_nc["cliente"], cliente_id=enc_nc["cliente_id"],
                         created_by=quem["id"], created_by_nome=quem["nome"])
    nc.numero = await next_codigo("nao_conformidade")
    await nao_conformidades_repo.insert({**nc.model_dump(), **TAG, "created_at": _ts(95)})

    # ---------------- Compras ----------------
    async def oc(forn, linhas, dias, estado="criada"):
        ls = [OrdemCompraLinha(nome=a["nome"], artigo_id=a["id"], artigo_nome=a["nome"], quantidade=q,
                               preco_unit=round2(float(a.get("custo_artigo") or 0) * float(a.get("fator_compra") or 1))).model_dump()
              for a, q in linhas]
        tot = round2(sum(l["quantidade"] * l["preco_unit"] for l in ls))
        o = OrdemCompra(assunto=f"Compra {forn.replace(SIM, '').strip()}", fornecedor_id=forns[forn].id, fornecedor_nome=forns[forn].nome,
                        tipo_despesa="compra", tipo_compra="Produtos", estado=estado, data=_d(dias), vencimento=_d(dias - 30),
                        linhas=ls, subtotal=tot, total=tot)
        o.codigo = await next_codigo("ordem_compra")
        doc = {**o.model_dump(), **TAG, "created_at": _ts(dias)}
        await ordens_compra_repo.insert(doc)
        return doc

    async def receber(o, frac, dias, guia):
        linhas = [dict(l) for l in o["linhas"]]
        itens = []
        for l in linhas:
            q = round2(l["quantidade"] * frac)
            if q <= 0:
                continue
            a = await artigos_repo.get(l["artigo_id"]) or {}
            fator = float(a.get("fator_compra") or 1) or 1
            await stock_svc.movimentar(l["artigo_id"], q * fator, "entrada",
                                       origem={"tipo": "oc", "id": o["id"], "numero": o["codigo"]},
                                       custo_unit=round(l["preco_unit"] / fator, 4), user=user, data=_d(dias))
            l["qtd_recebida"] = q
            itens.append({"linha_id": l["id"], "descricao": l["artigo_nome"], "quantidade": q})
        rec = {"id": new_id(), "data": _d(dias), "guia_fornecedor": guia, "notas": "", "linhas": itens, "por": quem,
               "created_at": _ts(dias)}
        await ordens_compra_repo.update(o["id"], {"linhas": linhas, "rececoes": [rec],
                                                  "estado": "recebida" if frac >= 1 else "criada"})

    o1 = await oc("Acrílicos do Norte", [(mp["acr"], 2), (mp["mdf"], 1)], 90)
    await receber(o1, 1, 85, "GR 2026/118")
    await stock_svc.fatura_fornecedor(o1["id"], {"numero": "FT A/2231", "data": _d(84),
                                                 "total": round2(o1["total"] + 18), "portes": 18}, user)
    o2 = await oc("THC Clothes", [(mp["tsh"], 2), (mp["pol"], 30)], 20)
    await receber(o2, 0.5, 14, "GT 7781")
    await oc("Embalagens Minho", [(mp["dtf"], 1)], 4)
    o4 = await oc("Acrílicos do Norte", [(mp["esp"], 1)], 40)
    await receber(o4, 1, 36, "GR 2026/131")
    await stock_svc.fatura_fornecedor(o4["id"], {"numero": "FT A/2290", "data": _d(35), "total": round2(o4["total"] + 12.5),
                                                 "portes": 0}, user)  # fatura com diferença

    # ---------------- Relatório guardado ----------------
    from app.services import relatorios_guardados as gsvc
    g = gsvc.normalizar({"relatorio_id": "vendas_cliente" if "vendas_cliente" in gsvc.rel_svc.RELATORIOS else next(iter(gsvc.rel_svc.RELATORIOS)),
                         "nome": f"{SIM} Vendas do ano por cliente", "periodo": "ultimos_12m", "partilhado": True}, user)
    await relatorios_guardados_repo.insert({**g, **TAG})

    return {"ok": True, **(await estado()), "ofs": n_of}


def pa_tipo(pa: Dict[str, dict], artigo_id: Optional[str]) -> str:
    for a in pa.values():
        if a["id"] == artigo_id:
            return a.get("tipo_artigo") or ""
    return ""
