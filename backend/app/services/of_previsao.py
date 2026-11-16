"""Dados de produção para a Ordem de Fabrico a partir da encomenda.

Ordem de preferência para cada linha:
  1. Operações e materiais definidos na linha do ORÇAMENTO que deu origem à encomenda
     (snapshot guardado na linha da encomenda, ou lido do orçamento nas encomendas antigas);
  2. Roteiro e receita do ARTIGO no catálogo.

As quantidades de material são proporcionais à quantidade a produzir na OF.
`previsao_of` devolve o resumo usado no ecrã de validação antes de criar a OF.
"""
from typing import Dict, List, Optional

from app.core.database import new_id, round2
from app.domain.models import OFOperacao
from app.repositories import artigos_repo, consumiveis_repo, mao_obra_repo, maquinas_repo, orcamentos_repo
from app.services.costing import (
    herdar_bom_do_pai, maquina_custo_hora, material_qtd_efetiva, op_minutos_mao_obra, op_minutos_maquina,
)


async def operacoes_de_roteiro(roteiro: List[dict]) -> List[dict]:
    """Converte um roteiro (artigo ou linha de orçamento) em operações de OF (tempos por unidade)."""
    out = []
    for op in roteiro or []:
        t_maq = op_minutos_maquina(op)
        t_mo = op_minutos_mao_obra(op)
        maq = await maquinas_repo.get(op.get("maquina_id")) if op.get("maquina_id") else None
        mo = await mao_obra_repo.get(op.get("mao_obra_id")) if op.get("mao_obra_id") else None
        mo_hora = (mo or {}).get("custo_hora") or 0
        maq_hora = maquina_custo_hora(maq)
        custo_maq = round2((t_maq / 60.0) * maq_hora)
        custo_mo = round2((t_mo / 60.0) * mo_hora)
        out.append(OFOperacao(
            nome=op.get("nome", "") or (op.get("maquina_nome") or "Operação"),
            maquina_id=op.get("maquina_id"),
            maquina_nome=op.get("maquina_nome") or (maq or {}).get("nome"),
            mao_obra_id=op.get("mao_obra_id"),
            mao_obra_nome=op.get("mao_obra_nome") or (mo or {}).get("nome"),
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
        ).model_dump())
    return out


def _material_of(nome: str, material_id: Optional[str], unidade: str, por_unidade: float,
                 quantidade_of: float, custo_unitario: float, origem: str) -> dict:
    total = round(por_unidade * quantidade_of, 4)
    return {
        "id": new_id(),
        "material_id": material_id,
        "nome": nome or "",
        "unidade": unidade or "un",
        "quantidade_unit": round(por_unidade, 6),
        "quantidade": total,
        "custo_unitario": round2(custo_unitario or 0),
        "custo": round2(total * (custo_unitario or 0)),
        "origem": origem,
        "consumido": False,
    }


def materiais_da_linha_orcamento(linha: dict, materiais_orc: List[dict], quantidade_of: float) -> List[dict]:
    """Materiais da linha do orçamento, reescalados para a quantidade da OF."""
    lid = linha.get("id")
    qtd_linha = float(linha.get("quantidade") or 1) or 1
    out = []
    for m in materiais_orc or []:
        if m.get("linha_origem_id") != lid:
            continue
        sem_medidas = not (float(m.get("comprimento_mm") or 0) and float(m.get("largura_mm") or 0))
        if m.get("quantidade_unit") is not None and sem_medidas:
            por_unidade = float(m.get("quantidade_unit") or 0)
        else:
            por_unidade = material_qtd_efetiva(m) / qtd_linha
        out.append(_material_of(
            m.get("nome") or m.get("artigo_origem_nome") or "",
            m.get("material_id") or m.get("consumivel_id"),
            m.get("unidade") or "un",
            por_unidade, quantidade_of, float(m.get("custo_unitario") or 0), "orcamento",
        ))
    return out


async def materiais_do_artigo(artigo: dict, quantidade_of: float) -> List[dict]:
    """Receita (BOM) do artigo no catálogo, para a quantidade da OF."""
    out = []
    for mat in artigo.get("materiais") or []:
        custo = float(mat.get("custo_unitario") or 0)
        mid = mat.get("material_id")
        if mid and not custo:
            comp = await artigos_repo.get(mid) or await consumiveis_repo.get(mid)
            if comp:
                custo = float(comp.get("custo_unitario") or comp.get("preco_compra") or comp.get("custo_artigo") or 0)
        out.append(_material_of(
            mat.get("material_nome") or mat.get("nome") or "", mid, mat.get("unidade") or "un",
            material_qtd_efetiva(mat), quantidade_of, custo, "catalogo",
        ))
    return out


async def _linhas_orcamento_por_artigo_enc(enc: dict) -> Dict[str, dict]:
    """enc_artigo_id → {linha, materiais} do orçamento de origem."""
    out: Dict[str, dict] = {}
    artigos_enc = enc.get("artigos") or []
    orc = None
    precisa_ler = any(
        not a.get("roteiro_orcamento") and not a.get("materiais_orcamento") for a in artigos_enc
    )
    if enc.get("orcamento_id") and precisa_ler:
        orc = await orcamentos_repo.get(enc["orcamento_id"])
    linhas_orc = list((orc or {}).get("linhas") or [])
    mats_orc = list((orc or {}).get("materiais") or [])
    usadas = set()
    for a in artigos_enc:
        if a.get("roteiro_orcamento") is not None or a.get("materiais_orcamento") is not None:
            if a.get("roteiro_orcamento") or a.get("materiais_orcamento"):
                out[a["id"]] = {
                    "linha": {"id": a.get("orcamento_linha_id"), "quantidade": a.get("quantidade_orcamento") or a.get("quantidade") or 1,
                              "roteiro": a.get("roteiro_orcamento") or []},
                    "materiais": a.get("materiais_orcamento") or [],
                }
            continue
        if not linhas_orc:
            continue
        linha = None
        if a.get("orcamento_linha_id"):
            linha = next((l for l in linhas_orc if l.get("id") == a["orcamento_linha_id"]), None)
        if linha is None:  # encomendas antigas: mesma ordem / mesmo artigo
            linha = next((l for l in linhas_orc if l.get("artigo_id") == a.get("artigo_id") and l.get("id") not in usadas), None)
        if linha is None:
            continue
        usadas.add(linha.get("id"))
        out[a["id"]] = {"linha": linha, "materiais": mats_orc}
    return out


async def montar_itens(enc: dict, pedidos: List[dict]) -> List[dict]:
    """pedidos: [{enc_artigo_id, quantidade, ...campos do item}] → itens de OF com operações e materiais."""
    por_id = {a.get("id"): a for a in enc.get("artigos") or []}
    do_orc = await _linhas_orcamento_por_artigo_enc(enc)
    itens = []
    for p in pedidos:
        src = por_id.get(p.get("enc_artigo_id")) or next(
            (a for a in enc.get("artigos") or [] if a.get("artigo_id") == p.get("artigo_id")), None) or {}
        qtd = float(p.get("quantidade") or 0)
        if qtd <= 0:
            continue
        artigo = await artigos_repo.get(p.get("artigo_id") or src.get("artigo_id"))
        if artigo:
            artigo = await herdar_bom_do_pai(artigo)
        info = do_orc.get(src.get("id"))
        operacoes = p.get("operacoes") or []
        materiais = p.get("materiais") or []
        origem_ops = origem_mat = ""
        if not operacoes:
            if info and (info["linha"].get("roteiro") or []):
                operacoes = await operacoes_de_roteiro(info["linha"]["roteiro"])
                origem_ops = "orcamento"
            elif artigo and artigo.get("roteiro"):
                operacoes = await operacoes_de_roteiro(artigo["roteiro"])
                origem_ops = "catalogo"
        if not materiais:
            if info:
                materiais = materiais_da_linha_orcamento(info["linha"], info["materiais"], qtd)
                origem_mat = "orcamento" if materiais else ""
            if not materiais and artigo:
                materiais = await materiais_do_artigo(artigo, qtd)
                origem_mat = "catalogo" if materiais else ""
        itens.append({
            **{k: v for k, v in p.items() if k not in ("operacoes", "materiais")},
            "artigo_id": p.get("artigo_id") or src.get("artigo_id"),
            "artigo_nome": p.get("artigo_nome") or src.get("artigo_nome") or (artigo or {}).get("nome", ""),
            "enc_artigo_id": src.get("id"),
            "observacoes": p.get("observacoes") or src.get("observacoes") or "",
            "quantidade": qtd,
            "operacoes": operacoes,
            "materiais": materiais,
            "origem_operacoes": origem_ops,
            "origem_materiais": origem_mat,
        })
        from app.services.costing import tipo_item_of
        itens[-1]["tipo_item"] = tipo_item_of(itens[-1], artigo)
    return itens


def resumo(itens: List[dict], enc: dict) -> dict:
    """Totais e avisos para o ecrã de validação."""
    t_maq = t_mo = custo_ops = custo_mat = 0.0
    avisos = []
    for it in itens:
        qtd = float(it.get("quantidade") or 0)
        ops = it.get("operacoes") or []
        for op in ops:
            t_maq += (op.get("tempo_maquina_base") or op.get("tempo_maquina") or 0) * qtd
            t_mo += (op.get("tempo_mao_obra_base") or op.get("tempo_mao_obra") or 0) * qtd
            custo_ops += (op.get("custo_estimado") or 0) * qtd
        custo_mat += sum(m.get("custo") or 0 for m in it.get("materiais") or [])
        nome = it.get("artigo_nome") or "Artigo"
        if not ops:
            avisos.append(f"«{nome}» não tem operações (nem no orçamento nem no artigo).")
        if not it.get("materiais"):
            avisos.append(f"«{nome}» não tem materiais associados.")
        if it.get("origem_operacoes") == "catalogo" and enc.get("orcamento_id"):
            avisos.append(f"«{nome}»: operações vêm do catálogo (a linha do orçamento não tinha operações).")
    if not enc.get("autorizada_producao"):
        avisos.append("A produção desta encomenda ainda não está autorizada.")
    return {
        "tempo_maquina_min": round2(t_maq),
        "tempo_mao_obra_min": round2(t_mo),
        "custo_operacoes": round2(custo_ops),
        "custo_materiais": round2(custo_mat),
        "custo_total": round2(custo_ops + custo_mat),
        "avisos": avisos,
    }
