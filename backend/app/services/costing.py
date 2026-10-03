"""Serviço de custeio e regras de produção (Orçamentos, OFs, Encomendas)."""
from datetime import datetime, timezone
import re
from typing import List, Optional, Dict

from app.core.database import round2, new_id
from app.domain.models import OFOperacao
from app.repositories import (
    artigos_repo, consumiveis_repo, maquinas_repo, mao_obra_repo, tipos_repo,
    orcamentos_repo, ordens_repo, empresa_repo,
)


def pagamento_sinal(p: dict) -> int:
    return -1 if (p.get("tipo") or "pagamento") == "devolucao" else 1


# ----------------------- Matéria-prima: placa → €/m² -----------------------
_LINEAR_TO_M = {
    "mm": 0.001,
    "cm": 0.01,
    "m": 1.0,
    "in": 0.0254,
    "inch": 0.0254,
    '"': 0.0254,
}


def linear_to_m(val, unidade) -> float:
    """Converte dimensão linear para metros."""
    try:
        v = float(val or 0)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0:
        return 0.0
    u = (unidade or "mm").strip().lower()
    return v * _LINEAR_TO_M.get(u, 0.001)


def area_placa_m2(artigo: Optional[dict]) -> float:
    """Área da placa/folha a partir de comprimento × largura (com unidades)."""
    if not artigo:
        return 0.0
    comp = linear_to_m(artigo.get("comprimento_mm"), artigo.get("comprimento_unidade") or "mm")
    larg = linear_to_m(artigo.get("largura_mm"), artigo.get("largura_unidade") or "mm")
    if comp <= 0 or larg <= 0:
        return 0.0
    return round2(comp * larg)


def custo_m2_from_placa(artigo: Optional[dict]) -> float:
    """€/m² = preço da placa ÷ área. 0 se faltar preço ou dimensões."""
    if not artigo:
        return 0.0
    try:
        preco = float(artigo.get("preco_compra") or 0)
    except (TypeError, ValueError):
        preco = 0.0
    area = area_placa_m2(artigo)
    if preco <= 0 or area <= 0:
        return 0.0
    return round2(preco / area)


def aplicar_custo_placa_mp(artigo: dict) -> dict:
    """
    Matéria-prima / consumível: se há preço de placa + L×A, grava custo_artigo em €/m²
    e unidade m² — esse valor alimenta receitas e orçamentos.
    """
    from app.domain.models import TIPOS_MATERIA_PRIMA
    if not artigo:
        return artigo
    tipo = (artigo.get("tipo_artigo") or "").strip().lower()
    if tipo not in TIPOS_MATERIA_PRIMA:
        return artigo
    custo_m2 = custo_m2_from_placa(artigo)
    if custo_m2 <= 0:
        return artigo
    artigo = {**artigo}
    artigo["custo_artigo"] = custo_m2
    un = (artigo.get("unidade") or "").strip().lower().replace("m2", "m²")
    if un not in ("m²", "m2"):
        artigo["unidade"] = "m²"
    return artigo


def custo_unitario_compra(artigo: Optional[dict]) -> float:
    """Custo por unidade usado em BOM/orçamento (placa→€/m² se aplicável)."""
    if not artigo:
        return 0.0
    from app.domain.models import TIPOS_MATERIA_PRIMA
    tipo = (artigo.get("tipo_artigo") or "").strip().lower()
    if tipo in TIPOS_MATERIA_PRIMA:
        custo_m2 = custo_m2_from_placa(artigo)
        if custo_m2 > 0:
            return custo_m2
    return round2(artigo.get("custo_artigo") or 0)


def soma_valor_pago(pagamentos) -> float:
    """Valor líquido pago na encomenda (pagamentos − devoluções)."""
    return round2(sum((p.get("valor") or 0) * pagamento_sinal(p) for p in (pagamentos or [])))


def artigo_is_diversos(artigo: dict) -> bool:
    if not artigo:
        return False
    if artigo.get("diversos"):
        return True
    return bool(re.match(r"^DIV[-_]?", artigo.get("codigo") or "", re.I))


def soma_valor_devolvido(pagamentos) -> float:
    return round2(sum((p.get("valor") or 0) for p in (pagamentos or []) if (p.get("tipo") or "") == "devolucao"))


def iva_calc(net, settings) -> dict:
    s = settings or {}
    taxa = 0.0 if s.get("iva_isento") else float(s.get("iva_taxa") or 0)
    valor = round2((net or 0) * taxa / 100.0)
    return {"iva_taxa": taxa, "iva_valor": valor, "total_com_iva": round2((net or 0) + valor)}


# ----------------------- Tempos / custos base -----------------------
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
    """Custo/preço do artigo. Sem materiais/roteiro → cálculo síncrono (sem I/O)."""
    mats = artigo.get("materiais") or []
    roteiro = artigo.get("roteiro") or []
    if not mats and not roteiro:
        return _artigo_breakdown_from_parts(artigo, 0.0, 0.0, 0.0)
    return await _artigo_breakdown_with_lookups(artigo, mats, roteiro)


def _artigo_breakdown_from_parts(artigo: dict, custo_materiais: float, custo_maquinas: float, custo_mao_obra: float) -> dict:
    custo_materiais = round2(custo_materiais)
    custo_maquinas = round2(custo_maquinas)
    custo_mao_obra = round2(custo_mao_obra)
    # MP com placa: usa €/m² derivado; restantes: custo_artigo
    custo_artigo = custo_unitario_compra(artigo)
    custo_total = round2(custo_artigo + custo_materiais + custo_maquinas + custo_mao_obra)
    if artigo_is_diversos(artigo):
        margem = 0.0
    else:
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


def artigo_breakdown_with_caches(
    artigo: dict,
    cons_by_id: Optional[dict] = None,
    maq_by_id: Optional[dict] = None,
    mo_by_id: Optional[dict] = None,
) -> dict:
    """Breakdown síncrono com mapas pré-carregados (listagens em lote)."""
    cons_by_id = cons_by_id or {}
    maq_by_id = maq_by_id or {}
    mo_by_id = mo_by_id or {}
    custo_materiais = 0.0
    for mat in artigo.get("materiais") or []:
        m = {**mat}
        cid = m.get("material_id")
        if cid and cid in cons_by_id and cons_by_id[cid] is not None:
            m["custo_unitario"] = cons_by_id[cid]
        custo_materiais += material_custo(m)
    custo_maquinas = 0.0
    custo_mao_obra = 0.0
    for op in artigo.get("roteiro") or []:
        mid = op.get("maquina_id")
        if mid and mid in maq_by_id:
            custo_maquinas += (op_minutos_maquina(op) / 60.0) * maq_by_id[mid]
        moid = op.get("mao_obra_id")
        if moid and moid in mo_by_id:
            custo_mao_obra += (op_minutos_mao_obra(op) / 60.0) * mo_by_id[moid]
    return _artigo_breakdown_from_parts(artigo, custo_materiais, custo_maquinas, custo_mao_obra)


async def _artigo_breakdown_with_lookups(artigo: dict, mats: list, roteiro: list) -> dict:
    mat_ids = {m.get("material_id") for m in mats if m.get("material_id")}
    maq_ids = {op.get("maquina_id") for op in roteiro if op.get("maquina_id")}
    mo_ids = {op.get("mao_obra_id") for op in roteiro if op.get("mao_obra_id")}
    cons_by_id, maq_by_id, mo_by_id = {}, {}, {}
    if mat_ids:
        # Preferência: artigos (novo modelo). Fallback: consumíveis legados.
        for a in await artigos_repo.find({"id": {"$in": list(mat_ids)}}, limit=len(mat_ids) + 5):
            # custo de componente = valor de compra do artigo referenciado
            cons_by_id[a["id"]] = custo_unitario_compra(a)
        missing = mat_ids - set(cons_by_id.keys())
        if missing:
            for c in await consumiveis_repo.find({"id": {"$in": list(missing)}}, limit=len(missing) + 5):
                cons_by_id[c["id"]] = c.get("custo_unitario")
    if maq_ids:
        for m in await maquinas_repo.find({"id": {"$in": list(maq_ids)}}, limit=len(maq_ids) + 5):
            maq_by_id[m["id"]] = maquina_custo_hora(m)
    if mo_ids:
        for mo in await mao_obra_repo.find({"id": {"$in": list(mo_ids)}}, limit=len(mo_ids) + 5):
            mo_by_id[mo["id"]] = mo.get("custo_hora", 0.0)
    return artigo_breakdown_with_caches(artigo, cons_by_id, maq_by_id, mo_by_id)


async def enrich_artigos_list(rows: list) -> list:
    """Enriquece uma página de artigos com 0–3 queries extra (nunca N+1)."""
    if not rows:
        return []
    cons_ids, maq_ids, mo_ids = set(), set(), set()
    needs_lookup = False
    for a in rows:
        mats = a.get("materiais") or []
        roteiro = a.get("roteiro") or []
        if mats or roteiro:
            needs_lookup = True
        for mat in mats:
            if mat.get("material_id"):
                cons_ids.add(mat["material_id"])
        for op in roteiro:
            if op.get("maquina_id"):
                maq_ids.add(op["maquina_id"])
            if op.get("mao_obra_id"):
                mo_ids.add(op["mao_obra_id"])
    cons_by_id, maq_by_id, mo_by_id = {}, {}, {}
    if needs_lookup:
        if cons_ids:
            for a in await artigos_repo.find({"id": {"$in": list(cons_ids)}}, limit=len(cons_ids) + 5):
                cons_by_id[a["id"]] = custo_unitario_compra(a)
            missing = cons_ids - set(cons_by_id.keys())
            if missing:
                for c in await consumiveis_repo.find({"id": {"$in": list(missing)}}, limit=len(missing) + 5):
                    cons_by_id[c["id"]] = c.get("custo_unitario")
        if maq_ids:
            for m in await maquinas_repo.find({"id": {"$in": list(maq_ids)}}, limit=len(maq_ids) + 5):
                maq_by_id[m["id"]] = maquina_custo_hora(m)
        if mo_ids:
            for mo in await mao_obra_repo.find({"id": {"$in": list(mo_ids)}}, limit=len(mo_ids) + 5):
                mo_by_id[mo["id"]] = mo.get("custo_hora", 0.0)
    return [
        enrich_artigo(a, artigo_breakdown_with_caches(a, cons_by_id, maq_by_id, mo_by_id))
        for a in rows
    ]


def artigo_lite(artigo: dict) -> dict:
    """Payload mínimo para selectors (sem BOM/roteiro/descrição longa).

    `preco_venda` aqui é só estimativa (custo_artigo × margem), sem materiais/ops.
    Orçamentos devem usar GET /artigos/{id} (breakdown completo).
    Inclui preço/dims da placa para o frontend derivar €/m².
    """
    custo = custo_unitario_compra(artigo)
    codigo = artigo.get("codigo") or ""
    diversos = artigo_is_diversos(artigo)
    margem = 0.0 if diversos else (artigo.get("margem") if artigo.get("margem") is not None else 30.0)
    return {
        "id": artigo.get("id"),
        "codigo": codigo,
        "nome": artigo.get("nome") or "",
        "unidade": artigo.get("unidade") or "un",
        "tipo_artigo": artigo.get("tipo_artigo") or "ativo",
        "produzido": bool(artigo.get("produzido")) or (artigo.get("tipo_artigo") == "produzido"),
        "custo_artigo": custo,
        "preco_compra": round2(artigo.get("preco_compra") or 0),
        "comprimento_mm": float(artigo.get("comprimento_mm") or 0),
        "largura_mm": float(artigo.get("largura_mm") or 0),
        "comprimento_unidade": artigo.get("comprimento_unidade") or "mm",
        "largura_unidade": artigo.get("largura_unidade") or "mm",
        "margem": margem,
        "diversos": diversos,
        "categoria_id": artigo.get("categoria_id"),
        "categoria_nome": artigo.get("categoria_nome") or "",
        "subcategoria_id": artigo.get("subcategoria_id"),
        "subcategoria_nome": artigo.get("subcategoria_nome") or "",
        "preco_venda": round2(custo * (1 + float(margem) / 100.0)),
        "lite": True,
    }


async def artigo_custo_total(artigo: dict) -> float:
    return (await artigo_breakdown(artigo))["custo_producao_total"]


def enrich_artigo(artigo: dict, breakdown: dict) -> dict:
    return {**artigo, **breakdown}


# ----------------------- Personalizações -----------------------
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


# ----------------------- Materiais -----------------------
MATERIAL_MARKUP = 1.5  # margem default de 50% (usada quando a linha não define margem)


def material_margem_factor(m: dict) -> float:
    margem = m.get("margem")
    if margem is None:
        return MATERIAL_MARKUP
    return 1.0 + (float(margem) / 100.0)


def _medida_custo(unidade: str, custo: float, med: dict) -> float:
    """Custo de um consumo/medida (qtd na un. ou L×A em m²)."""
    qtd = float(med.get("quantidade") or 0)
    un = (unidade or "").lower().replace("m2", "m²")
    if un in ("m²", "m2"):
        comp = float(med.get("comprimento_mm") or 0)
        larg = float(med.get("largura_mm") or 0)
        if comp > 0 and larg > 0:
            area = (comp / 1000.0) * (larg / 1000.0)
            return round2(area * custo * (qtd if qtd > 0 else 1.0))
        return round2(qtd * custo)
    return round2(qtd * custo)


def material_qtd_efetiva(m: dict) -> float:
    """Quantidade efectiva na unidade do material (soma das medidas)."""
    unidade = (m.get("unidade") or "").lower().replace("m2", "m²")
    medidas = m.get("medidas") or []
    if not medidas:
        medidas = [m]

    def _qtd(med: dict) -> float:
        qtd = float(med.get("quantidade") or 0)
        if unidade in ("m²", "m2"):
            comp = float(med.get("comprimento_mm") or 0)
            larg = float(med.get("largura_mm") or 0)
            if comp > 0 and larg > 0:
                return (comp / 1000.0) * (larg / 1000.0) * (qtd if qtd > 0 else 1.0)
        return qtd

    return sum(_qtd(med) for med in medidas)


def material_custo(m: dict) -> float:
    """Custo de uma linha de material (orçamento solto ou BOM de artigo).

    - Unidade normal: quantidade × custo_unitario (quantidade já na un. do material).
    - m² com L×A (mm): área_m² × custo × quantidade (nº de peças); se L/A=0, quantidade é m².
    - Se `medidas` existir, soma o custo de cada consumo do mesmo material.
    """
    custo = float(m.get("custo_unitario") or 0)
    unidade = m.get("unidade") or ""
    medidas = m.get("medidas") or []
    if medidas:
        return round2(sum(_medida_custo(unidade, custo, med) for med in medidas))
    return _medida_custo(unidade, custo, m)


def fill_materiais(materiais: List[dict]) -> List[dict]:
    out = []
    for m in materiais or []:
        m = {**m}
        if m.get("margem") is None:
            m["margem"] = 0.0 if m.get("da_receita") else 50.0
        custo = material_custo(m)
        m["custo"] = custo
        # Receita do artigo: já está no preço/custo da linha — valor de venda 0
        if m.get("da_receita"):
            m["valor"] = 0.0
        else:
            m["valor"] = round2(custo * material_margem_factor(m))
        out.append(m)
    return out


# ----------------------- Descontos / totais do orçamento -----------------------
def desconto_valor(base: float, desconto, tipo) -> float:
    d = desconto or 0
    if d <= 0:
        return 0.0
    if (tipo or "pct") == "eur":
        return round2(min(d, base))
    return round2(base * d / 100.0)


def desconto_linha_item(item: dict) -> float:
    """
    Desconto de uma linha (orçamento/encomenda).
    desconto_base: 'linha' (default) | 'unit'
    - pct: sobre o bruto da linha
    - eur + linha: valor fixo na linha
    - eur + unit: valor × quantidade
    """
    qtd = float(item.get("quantidade") or 0)
    unit = (item.get("preco_unit") or 0) + pers_valor_unit(item)
    bruto = round2(unit * qtd)
    d = float(item.get("desconto") or 0)
    if d <= 0 or bruto <= 0:
        return 0.0
    tipo = (item.get("desconto_tipo") or "pct").strip().lower()
    base = (item.get("desconto_base") or "linha").strip().lower()
    if tipo == "eur" and base in ("unit", "unidade", "un"):
        return round2(min(d * qtd, bruto))
    return desconto_valor(bruto, d, tipo)


def linha_venda_bruto(l: dict) -> float:
    qtd = l.get("quantidade") or 0
    return round2(((l.get("preco_unit") or 0) + pers_valor_unit(l)) * qtd)


def compute_orcamento_totais(orc: dict) -> dict:
    subtotal_custo = 0.0
    subtotal_venda = 0.0
    total_pers = 0.0
    desconto_linhas = 0.0
    for l in orc.get("linhas", []):
        qtd = l.get("quantidade") or 0
        subtotal_custo += (l.get("custo_producao_unit") or 0) * qtd
        subtotal_venda += (l.get("preco_unit") or 0) * qtd
        total_pers += pers_valor_unit(l) * qtd
        desconto_linhas += desconto_linha_item(l)
    custo_materiais = 0.0
    venda_materiais = 0.0
    for m in orc.get("materiais", []):
        # Materiais da receita do artigo já entram no custo/preço da linha
        if m.get("da_receita"):
            continue
        c = material_custo(m)
        custo_materiais += c
        venda_materiais += round2(c * material_margem_factor(m))
    subtotal_venda = round2(subtotal_venda)
    total_pers = round2(total_pers)
    custo_materiais = round2(custo_materiais)
    venda_materiais = round2(venda_materiais)
    desconto_linhas = round2(desconto_linhas)
    subtotal_custo = round2(subtotal_custo + custo_materiais)
    subtotal_liquido = round2(subtotal_venda + total_pers + venda_materiais - desconto_linhas)
    desc_total_val = desconto_valor(subtotal_liquido, orc.get("desconto_total"), orc.get("desconto_total_tipo"))
    total = round2(subtotal_liquido - desc_total_val)
    orc = {**orc}
    orc["subtotal_custo"] = subtotal_custo
    orc["subtotal_venda"] = subtotal_venda
    orc["total_personalizacao"] = total_pers
    orc["custo_materiais"] = custo_materiais
    orc["total_materiais"] = venda_materiais
    orc["desconto_linhas"] = desconto_linhas
    orc["subtotal_liquido"] = subtotal_liquido
    orc["desconto_total_valor"] = desc_total_val
    orc["total"] = total
    orc["lucro"] = round2(total - subtotal_custo)
    return orc


def _is_materia_prima_artigo(artigo: dict) -> bool:
    t = (artigo.get("tipo_artigo") or "").strip().lower()
    return t in ("materia_prima", "consumivel")


def _linha_custo_from_materiais(l: dict, materiais: List[dict]) -> Optional[float]:
    """Custo unitário da linha a partir dos consumos da receita (ex.: matéria-prima com medidas)."""
    linha_id = l.get("id")
    if not linha_id:
        return None
    mats = [
        m for m in (materiais or [])
        if m.get("da_receita") and m.get("linha_origem_id") == linha_id
    ]
    if not mats:
        return None
    qtd = float(l.get("quantidade") or 0) or 1.0
    total = sum(material_custo(m) for m in mats)
    return round2(total / qtd)


def _modo_calculo_linha(l: dict, artigo: dict) -> str:
    modo = (l.get("modo_calculo") or "").strip().lower()
    if modo in ("diversos", "materia_prima", "servico", "compra", "producao"):
        return modo
    if artigo_is_diversos(artigo) or l.get("descricao_livre"):
        return "diversos"
    if _is_materia_prima_artigo(artigo) or l.get("eh_materia_prima"):
        return "materia_prima"
    t = (artigo.get("tipo_artigo") or "ativo").strip().lower()
    if t == "servico":
        return "servico"
    if t == "ativo" and (
        artigo.get("produzido")
        or (artigo.get("materiais") or [])
        or (artigo.get("roteiro") or [])
    ):
        return "producao"
    return "compra"


async def fill_linha_custos(linhas: List[dict], materiais: Optional[List[dict]] = None) -> List[dict]:
    materiais = materiais or []
    out = []
    for l in linhas:
        a = await artigos_repo.get(l.get("artigo_id"))
        if a:
            if not l.get("artigo_codigo"):
                l["artigo_codigo"] = a.get("codigo") or ""
            if not l.get("descricao_livre"):
                l["artigo_nome"] = a.get("nome", l.get("artigo_nome", ""))
            elif not (l.get("artigo_nome") or "").strip():
                l["artigo_nome"] = a.get("nome", "")
            if not l.get("imagem") and a.get("imagem"):
                l["imagem"] = a.get("imagem")

            livre = bool(l.get("descricao_livre")) or artigo_is_diversos(a)
            modo = _modo_calculo_linha(l, a)
            l["modo_calculo"] = modo
            l["eh_materia_prima"] = modo == "materia_prima"
            l["eh_servico"] = modo == "servico"
            l["eh_producao"] = modo == "producao"

            if livre or modo == "diversos":
                l["margem"] = 0
                l["roteiro"] = []
                if l.get("preco_unit_manual") and l.get("preco_unit") is not None:
                    l["preco_unit"] = round2(float(l.get("preco_unit") or 0))
            elif modo == "materia_prima":
                if l.get("margem") is None:
                    l["margem"] = float(a.get("margem") if a.get("margem") is not None else 30)
                l["roteiro"] = []
                custo_unit = _linha_custo_from_materiais(l, materiais)
                if custo_unit is None:
                    custo_unit = custo_unitario_compra(a)
                l["custo_compra_unit"] = 0.0
                l["custo_materiais_unit"] = custo_unit
                l["custo_operacoes_unit"] = 0.0
                l["custo_base_unit"] = custo_unit
                l["custo_producao_unit"] = custo_unit
                margem = float(l.get("margem") or 0)
                if l.get("preco_unit_manual") and l.get("preco_unit") is not None:
                    l["preco_unit"] = round2(float(l.get("preco_unit") or 0))
                else:
                    l["preco_unit"] = round2(custo_unit * (1 + margem / 100.0))
            elif modo in ("servico", "compra"):
                custo_unit = round2(a.get("custo_artigo") or 0)
                if l.get("margem") is None:
                    l["margem"] = float(a.get("margem") or 30)
                l["roteiro"] = []
                l["custo_compra_unit"] = custo_unit
                l["custo_materiais_unit"] = 0.0
                l["custo_operacoes_unit"] = 0.0
                l["custo_base_unit"] = custo_unit
                l["custo_producao_unit"] = custo_unit
                if l.get("preco_unit_manual") and l.get("preco_unit") is not None:
                    l["preco_unit"] = round2(float(l.get("preco_unit") or 0))
                else:
                    bd_a = await artigo_breakdown(a)
                    l["preco_unit"] = bd_a["preco_venda"]
            elif modo == "producao":
                bd_a = await artigo_breakdown(a)
                if l.get("margem") is None:
                    l["margem"] = 0 if artigo_is_diversos(a) else a.get("margem", 30)
                if not l.get("roteiro"):
                    l["roteiro"] = a.get("roteiro", [])
                compra = round2(
                    l.get("custo_compra_unit")
                    if l.get("custo_compra_unit") is not None
                    else bd_a.get("custo_artigo") or 0
                )
                mats_unit = _linha_custo_from_materiais(l, materiais)
                if mats_unit is None:
                    mats_unit = round2(bd_a.get("custo_materiais") or 0)
                pseudo = {
                    "custo_artigo": compra,
                    "materiais": [],
                    "roteiro": l.get("roteiro", []),
                    "margem": 0,
                }
                bd = await artigo_breakdown(pseudo)
                ops_unit = round2((bd.get("custo_maquinas") or 0) + (bd.get("custo_mao_obra") or 0))
                custo_total = round2(compra + mats_unit + ops_unit)
                l["custo_compra_unit"] = compra
                l["custo_materiais_unit"] = mats_unit
                l["custo_operacoes_unit"] = ops_unit
                l["custo_base_unit"] = round2(compra + mats_unit)
                l["custo_producao_unit"] = custo_total
                if l.get("preco_unit_manual") and l.get("preco_unit") is not None:
                    l["preco_unit"] = round2(float(l.get("preco_unit") or 0))
                else:
                    l["preco_unit"] = bd_a["preco_venda"]
        out.append(l)
    return out


# ----------------------- Custos reais das OFs -----------------------
def op_machine_cost_est(op: dict) -> float:
    cm = op.get("custo_maquina_estimado")
    if cm is not None:
        return cm
    t_maq = op.get("tempo_maquina") or 0
    t_mo = op.get("tempo_mao_obra") or 0
    ttot = t_maq + t_mo
    ce = op.get("custo_estimado") or 0
    return round2(ce * (t_maq / ttot)) if ttot > 0 else 0.0


def op_labor_rate(op: dict) -> float:
    r = op.get("mao_obra_custo_hora")
    if r is not None:
        return r
    t_mo = op.get("tempo_mao_obra") or 0
    if t_mo <= 0:
        return 0.0
    cmo_est = (op.get("custo_estimado") or 0) - op_machine_cost_est(op)
    return round2(cmo_est / (t_mo / 60.0))


def op_custo_real(op: dict) -> float:
    horas_real = (op.get("tempo_real_seg") or 0) / 3600.0
    return round2(op_machine_cost_est(op) + horas_real * op_labor_rate(op))


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
        a = await artigos_repo.get(it.get("artigo_id"))
        operacoes = it.get("operacoes")
        if a:
            it["artigo_nome"] = a.get("nome", it.get("artigo_nome", ""))
            it["unidade"] = a.get("unidade") or it.get("unidade") or "un"
            if not it.get("imagem") and a.get("imagem"):
                it["imagem"] = a.get("imagem")
            if not it.get("preco_unit"):
                it["preco_unit"] = (await artigo_breakdown(a)).get("preco_venda") or 0
            if not operacoes:
                operacoes = []
                for op in a.get("roteiro", []):
                    t_maq = op_minutos_maquina(op)
                    t_mo = op_minutos_mao_obra(op)
                    maq = await maquinas_repo.get(op.get("maquina_id")) if op.get("maquina_id") else None
                    mo = await mao_obra_repo.get(op.get("mao_obra_id")) if op.get("mao_obra_id") else None
                    mo_hora = (mo or {}).get("custo_hora") or 0
                    maq_hora = maquina_custo_hora(maq)
                    custo_maq = round2((t_maq / 60.0) * maq_hora)
                    custo_mo = round2((t_mo / 60.0) * mo_hora)
                    operacoes.append(
                        OFOperacao(
                            nome=op.get("nome", ""),
                            maquina_id=op.get("maquina_id"),
                            maquina_nome=op.get("maquina_nome") or ((maq or {}).get("nome")),
                            mao_obra_id=op.get("mao_obra_id"),
                            mao_obra_nome=op.get("mao_obra_nome"),
                            tempo_maquina=t_maq,
                            tempo_maquina_base=t_maq,
                            tempo_mao_obra=t_mo,
                            tempo_mao_obra_base=t_mo,
                            tempo_min=t_maq + t_mo,
                            custo_estimado=round2(custo_maq + custo_mo),
                            custo_maquina_estimado=custo_maq,
                            custo_mao_obra_estimado=custo_mo,
                            maquina_custo_hora=maq_hora,
                            mao_obra_custo_hora=mo_hora,
                        ).model_dump()
                    )
        it["operacoes"] = operacoes or []
        out.append(it)
    await _apply_pers_tempo(out)
    return out


async def _apply_pers_tempo(itens: List[dict]) -> None:
    """Calcula os tempos/custos estimados das operações da OF:
    tempo = tempo_base (por unidade) × quantidade; a mão de obra da operação
    responsável pelas personalizações soma ainda (tempo personalização × qtd).
    Idempotente: recalcula sempre a partir das bases por unidade."""
    resp_mo = await mao_obra_repo.find_one({"responsavel_personalizacoes": True})
    resp_id = resp_mo.get("id") if resp_mo else None
    resp_rate = (resp_mo or {}).get("custo_hora") or 0
    tipos = await tipos_repo.find(limit=1000)
    tempo_map = {t["id"]: (t.get("tempo") or 0) for t in tipos}

    for it in itens:
        ops = it.get("operacoes") or []
        if not ops:
            continue
        qtd = it.get("quantidade") or 1
        pers_min_unit = 0.0
        for p in (it.get("personalizacoes") or []):
            t = p.get("tempo")
            if not t:
                t = tempo_map.get(p.get("id"), 0)
            pers_min_unit += (t or 0)
        pers_min = round2(pers_min_unit * qtd)

        for op in ops:
            if op.get("tempo_mao_obra_base") is None:
                op["tempo_mao_obra_base"] = op.get("tempo_mao_obra") or 0
            if op.get("tempo_maquina_base") is None:
                op["tempo_maquina_base"] = op.get("tempo_maquina") or 0
            if not op.get("maquina_custo_hora"):
                if op.get("maquina_id"):
                    m = await maquinas_repo.get(op["maquina_id"])
                    if m:
                        op["maquina_custo_hora"] = maquina_custo_hora(m)
                        if not op.get("maquina_nome"):
                            op["maquina_nome"] = m.get("nome")
                if not op.get("maquina_custo_hora"):
                    mb = op.get("tempo_maquina_base") or 0
                    oldc = op.get("custo_maquina_estimado") or 0
                    op["maquina_custo_hora"] = round2(oldc / (mb / 60.0)) if mb > 0 else 0
            if not op.get("mao_obra_custo_hora"):
                if op.get("mao_obra_id"):
                    mo = await mao_obra_repo.get(op["mao_obra_id"])
                    if mo:
                        op["mao_obra_custo_hora"] = mo.get("custo_hora") or 0
                        if not op.get("mao_obra_nome"):
                            op["mao_obra_nome"] = mo.get("nome")
                if not op.get("mao_obra_custo_hora"):
                    ob = op.get("tempo_mao_obra_base") or 0
                    oldc = op.get("custo_mao_obra_estimado") or 0
                    op["mao_obra_custo_hora"] = round2(oldc / (ob / 60.0)) if ob > 0 else 0

        target = None
        if resp_id:
            target = next((op for op in ops if op.get("mao_obra_id") == resp_id), None)
        if target is None and pers_min > 0:
            target = ops[0]

        for op in ops:
            maq_total = round2((op.get("tempo_maquina_base") or 0) * qtd)
            mo_total = round2((op.get("tempo_mao_obra_base") or 0) * qtd)
            if op is target and pers_min > 0:
                if not op.get("mao_obra_custo_hora") and (resp_id is None or op.get("mao_obra_id") == resp_id):
                    op["mao_obra_custo_hora"] = resp_rate
                    if not op.get("mao_obra_nome") and resp_mo:
                        op["mao_obra_nome"] = resp_mo.get("nome")
                        op["mao_obra_id"] = resp_id
                mo_total = round2(mo_total + pers_min)
            maq_rate = op.get("maquina_custo_hora") or 0
            mo_rate = op.get("mao_obra_custo_hora") or 0
            op["tempo_maquina"] = maq_total
            op["tempo_mao_obra"] = mo_total
            op["custo_maquina_estimado"] = round2((maq_total / 60.0) * maq_rate)
            op["custo_mao_obra_estimado"] = round2((mo_total / 60.0) * mo_rate)
            op["tempo_min"] = round2(maq_total + mo_total)
            op["custo_estimado"] = round2(op["custo_maquina_estimado"] + op["custo_mao_obra_estimado"])


# ----------------------- Encomendas -----------------------
def encomenda_artigos_breakdown(enc: dict) -> dict:
    subtotal_venda = 0.0
    total_pers = 0.0
    desc_linhas = 0.0
    for a in enc.get("artigos", []):
        qtd = a.get("quantidade") or 0
        subtotal_venda += (a.get("preco_unit") or 0) * qtd
        total_pers += pers_valor_unit(a) * qtd
        desc_linhas += desconto_linha_item(a)
    subtotal_venda = round2(subtotal_venda)
    total_pers = round2(total_pers)
    bruto = round2(subtotal_venda + total_pers)
    desc_linhas = round2(desc_linhas)
    envio = round2(enc.get("envio") or 0)
    subtotal_liquido = round2(bruto - desc_linhas + envio)
    desc_total = desconto_valor(subtotal_liquido, enc.get("desconto_total"), enc.get("desconto_total_tipo"))
    return {
        "bruto": bruto,
        "subtotal_venda": subtotal_venda,
        "total_personalizacao": total_pers,
        "envio": envio,
        "desconto_linhas": desc_linhas,
        "subtotal_liquido": subtotal_liquido,
        "desconto_total_valor": desc_total,
        "total": round2(subtotal_liquido - desc_total),
    }


def encomenda_artigos_total(enc: dict) -> float:
    return encomenda_artigos_breakdown(enc)["total"]


def _piso_preco_orcamento(a: dict) -> Optional[float]:
    v = a.get("preco_unit_orcamento")
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def encomenda_acrescimo_preco_orcamento(enc: dict) -> float:
    """Soma dos aumentos de preço unitário vs. orçamento + linhas novas (sem piso)."""
    extra = 0.0
    novos = 0.0
    for a in enc.get("artigos") or []:
        piso = _piso_preco_orcamento(a)
        qtd = a.get("quantidade") or 0
        pu = a.get("preco_unit") or 0
        if piso is None:
            novos += linha_venda_bruto(a) - desconto_linha_item(a)
        else:
            extra += max(0.0, float(pu) - piso) * qtd
    return round2(extra + novos)


def backfill_pisos_preco_orcamento(enc: dict, orc: Optional[dict]) -> None:
    """Preenche preco_unit_orcamento em linhas antigas a partir do orçamento de origem."""
    if not orc:
        return
    unused = list(orc.get("linhas") or [])
    for a in enc.get("artigos") or []:
        if _piso_preco_orcamento(a) is not None:
            continue
        aid = a.get("artigo_id")
        match_i = next((i for i, l in enumerate(unused) if aid and l.get("artigo_id") == aid), None)
        if match_i is None:
            nome = (a.get("artigo_nome") or "").strip()
            match_i = next(
                (i for i, l in enumerate(unused) if nome and (l.get("artigo_nome") or "").strip() == nome),
                None,
            )
        if match_i is None:
            continue
        l = unused.pop(match_i)
        a["preco_unit_orcamento"] = round2(float(l.get("preco_unit") or 0))


def aplicar_pisos_preco_orcamento(existing: dict, novo: dict) -> list[str]:
    """Copia o piso do orçamento e devolve erros se algum preço desceu."""
    old_by_id = {a.get("id"): a for a in (existing.get("artigos") or []) if a.get("id")}
    erros = []
    for a in novo.get("artigos") or []:
        old = old_by_id.get(a.get("id")) or {}
        piso = _piso_preco_orcamento(old)
        if piso is None:
            piso = _piso_preco_orcamento(a)
        if piso is None:
            a.pop("preco_unit_orcamento", None)
            continue
        piso = round2(piso)
        a["preco_unit_orcamento"] = piso
        pu = round2(float(a.get("preco_unit") or 0))
        if pu + 0.001 < piso:
            nome = (a.get("artigo_nome") or "artigo").strip() or "artigo"
            erros.append(
                f"O preço de «{nome}» não pode ser inferior ao do orçamento ({piso:.2f} €)"
            )
    return erros


async def compute_encomenda(enc: dict) -> dict:
    ofs = await ordens_repo.find({"encomenda_id": enc["id"]})
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    orc = None
    if enc.get("orcamento_id"):
        orc = await orcamentos_repo.get(enc["orcamento_id"])
    return _compute_encomenda_core(enc, ofs, settings, orc)


async def compute_encomendas_many(
    encs: list,
    ofs_all: Optional[list] = None,
    *,
    include_orcamento: bool = True,
) -> list:
    """Enriquece várias encomendas com lookups em lote (OFs, orçamentos, empresa)."""
    if not encs:
        return []
    ids = [e["id"] for e in encs if e.get("id")]
    idset = set(ids)
    if ofs_all is None:
        ofs_all = (
            await ordens_repo.find({"encomenda_id": {"$in": ids}}, limit=max(5000, len(ids) * 20))
            if ids
            else []
        )
    ofs_by: dict = {}
    for o in ofs_all:
        eid = o.get("encomenda_id")
        if eid and (not idset or eid in idset):
            ofs_by.setdefault(eid, []).append(o)
    orc_by = {}
    if include_orcamento:
        orc_ids = list({e["orcamento_id"] for e in encs if e.get("orcamento_id")})
        if orc_ids:
            for o in await orcamentos_repo.find({"id": {"$in": orc_ids}}, limit=len(orc_ids) + 10):
                orc_by[o["id"]] = o
    settings = await empresa_repo.find_one({"id": "empresa"}) or {}
    return [
        _compute_encomenda_core(
            e,
            ofs_by.get(e.get("id"), []),
            settings,
            orc_by.get(e.get("orcamento_id")) if include_orcamento else None,
        )
        for e in encs
    ]


async def compute_encomendas_alertas(encs: list, ofs_all: Optional[list] = None) -> list:
    """Versão leve para badges/alertas: sem orçamentos nem custos de OF.

    Calcula estado, valor_pendente, tem_artigos_sem_of e mantém prazo_entrega.
    """
    if not encs:
        return []
    ids = [e["id"] for e in encs if e.get("id")]
    if ofs_all is None:
        ofs_all = (
            await ordens_repo.find(
                {"encomenda_id": {"$in": ids}},
                limit=max(5000, len(ids) * 20),
                projection={
                    "id": 1,
                    "numero": 1,
                    "encomenda_id": 1,
                    "status": 1,
                    "cliente": 1,
                    "progresso": 1,
                    "itens.artigo_id": 1,
                    "itens.quantidade": 1,
                    "itens.operacoes.concluida": 1,
                    "itens.operacoes.timer_inicio": 1,
                    "itens.operacoes.tempo_real_seg": 1,
                },
            )
            if ids
            else []
        )
    ofs_by: dict = {}
    idset = set(ids)
    for o in ofs_all:
        eid = o.get("encomenda_id")
        if eid and (not idset or eid in idset):
            ofs_by.setdefault(eid, []).append(o)
    settings = await empresa_repo.find_one(
        {"id": "empresa"}, projection={"iva_taxa": 1, "iva_isento": 1}
    ) or {}

    out = []
    for enc in encs:
        row = {**enc}
        ofs = [recompute_of_status(o) for o in ofs_by.get(enc.get("id"), [])]

        enc_tot_by_art: dict = {}
        for a in enc.get("artigos") or []:
            aid = a.get("artigo_id")
            if aid:
                enc_tot_by_art[aid] = enc_tot_by_art.get(aid, 0) + (a.get("quantidade") or 0)
        of_qty_by_art: dict = {}
        for o in ofs:
            for it in o.get("itens") or []:
                aid = it.get("artigo_id")
                if aid:
                    of_qty_by_art[aid] = of_qty_by_art.get(aid, 0) + (it.get("quantidade") or 0)

        if enc.get("estado") != "cancelada":
            if ofs and all(o.get("status") == "concluido" for o in ofs):
                row["estado"] = "concluida"
            elif any(o.get("status") in ("em_producao", "concluido") for o in ofs):
                row["estado"] = "em_producao"
            else:
                row["estado"] = enc.get("estado") or "aberta"

        ativo = row.get("estado") not in ("concluida", "cancelada")
        sem_of = any(
            tot > 0 and of_qty_by_art.get(aid, 0) <= 0 for aid, tot in enc_tot_by_art.items()
        )
        row["tem_artigos_sem_of"] = bool(sem_of) and ativo

        if enc.get("valor_total") is not None and (
            enc.get("valor_total_manual") or enc.get("total_com_iva") is not None
        ):
            valor = float(enc.get("valor_total") or 0)
        else:
            valor = encomenda_artigos_breakdown(enc)["total"]
        row["valor_total"] = round2(valor)
        if enc.get("total_com_iva") is not None:
            base = float(enc.get("total_com_iva") or 0)
        else:
            base = iva_calc(valor, settings)["total_com_iva"]
        pags = enc.get("pagamentos") or []
        pago = soma_valor_pago(pags) if pags else float(enc.get("valor_pago") or 0)
        row["valor_pago"] = pago
        row["valor_pendente"] = round2(max(0.0, base - pago))
        row["autorizada_producao"] = bool(enc.get("autorizada_producao"))
        out.append(row)
    return out


def _compute_encomenda_core(enc: dict, ofs: list, settings: dict, orc: Optional[dict] = None) -> dict:
    enc = {**enc}
    ofs = [recompute_of_status(o) for o in ofs]
    enc["num_ofs"] = len(ofs)

    # Progresso de produção: quantidade já lançada em OFs vs total da encomenda
    enc_tot_by_art: dict = {}
    for a in (enc.get("artigos") or []):
        aid = a.get("artigo_id")
        if aid:
            enc_tot_by_art[aid] = enc_tot_by_art.get(aid, 0) + (a.get("quantidade") or 0)
    of_qty_by_art: dict = {}
    for o in ofs:
        for it in o.get("itens", []):
            aid = it.get("artigo_id")
            if aid:
                of_qty_by_art[aid] = of_qty_by_art.get(aid, 0) + (it.get("quantidade") or 0)
    total_qtd = sum(enc_tot_by_art.values())
    em_ofs = sum(min(of_qty_by_art.get(aid, 0), tot) for aid, tot in enc_tot_by_art.items())
    enc["qtd_total"] = round2(total_qtd)
    enc["qtd_em_ofs"] = round2(em_ofs)
    enc["progresso_producao"] = round(em_ofs / total_qtd * 100) if total_qtd > 0 else 0

    # Alertas: artigos sem OF e sobreprodução (só relevante enquanto a encomenda está ativa)
    nome_por_art = {}
    for a in (enc.get("artigos") or []):
        if a.get("artigo_id"):
            nome_por_art[a["artigo_id"]] = a.get("artigo_nome") or nome_por_art.get(a["artigo_id"], "")
    ativo = enc.get("estado") not in ("concluida", "cancelada")
    sem_of = [nome_por_art.get(aid, "") for aid, tot in enc_tot_by_art.items() if tot > 0 and of_qty_by_art.get(aid, 0) <= 0]
    sobre = [nome_por_art.get(aid, "") for aid, tot in enc_tot_by_art.items() if of_qty_by_art.get(aid, 0) > tot]
    enc["artigos_sem_of"] = sem_of if ativo else []
    enc["tem_artigos_sem_of"] = bool(sem_of) and ativo
    enc["artigos_sobreproducao"] = sobre
    enc["sobreproducao"] = bool(sobre)

    custo_est = custo_real = 0.0
    for o in ofs:
        for it in o.get("itens", []):
            for op in it.get("operacoes", []):
                custo_est += op.get("custo_estimado") or 0
                custo_real += op_custo_real(op)
    enc["custo_producao_estimado"] = round2(custo_est)
    enc["custo_producao_real"] = round2(custo_real)

    valor_orcamento = None
    if enc.get("orcamento_id") and orc:
        backfill_pisos_preco_orcamento(enc, orc)
        valor_orcamento = compute_orcamento_totais(orc)["total"]
    enc["valor_orcamento"] = round2(valor_orcamento) if valor_orcamento is not None else None

    bd = encomenda_artigos_breakdown(enc)
    if enc.get("valor_total_manual") and enc.get("valor_total") is not None:
        valor = enc.get("valor_total") or 0
    else:
        valor = bd["total"]
    enc["valor_total"] = round2(valor)
    enc["valor_artigos_bruto"] = bd["bruto"]
    enc["subtotal_venda"] = bd["subtotal_venda"]
    enc["total_personalizacao"] = bd["total_personalizacao"]
    enc["envio"] = bd["envio"]
    enc["desconto_linhas"] = bd["desconto_linhas"]
    enc["desconto_total_valor"] = bd["desconto_total_valor"]

    enc.update(iva_calc(enc["valor_total"], settings or {}))
    base_pagamento = enc["total_com_iva"]

    pags = enc.get("pagamentos") or []
    if pags:
        pago = soma_valor_pago(pags)
        enc["valor_pago"] = pago
    else:
        pago = enc.get("valor_pago") or 0
    enc["valor_devolvido"] = soma_valor_devolvido(pags)
    if base_pagamento > 0.009:
        enc["percentual_pago"] = round2(min(100.0, max(0.0, (pago / base_pagamento) * 100.0)))
    else:
        enc["percentual_pago"] = 0.0 if pago <= 0 else 100.0
    if pago <= 0:
        enc["status_pagamento"] = "pendente"
    elif pago < base_pagamento:
        enc["status_pagamento"] = "parcial"
    else:
        enc["status_pagamento"] = "pago"
    enc["valor_pendente"] = round2(max(0.0, base_pagamento - pago))
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


def _prazo_meta(prazo: str):
    """Devolve (dias_restantes, estado_prazo) para um prazo ISO YYYY-MM-DD."""
    try:
        d = (datetime.fromisoformat(prazo[:10]).date() - datetime.now(timezone.utc).date()).days
    except Exception:
        return None, "futura"
    if d < 0:
        return d, "atrasada"
    if d <= 7:
        return d, "proxima"
    return d, "futura"
