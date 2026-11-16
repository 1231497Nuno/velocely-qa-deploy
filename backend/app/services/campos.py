"""Campos obrigatórios e personalizados por módulo — leitura, gravação e validação."""
import time
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.domain.campos import MODULOS_CAMPOS, CamposConfigInput
from app.repositories import campos_config_repo

_cache: Dict[str, Any] = {"at": 0.0, "dados": None}
_TTL = 15


def _vazio(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip()
    if isinstance(v, (list, dict)):
        return len(v) == 0
    return False


def _normalizar(modulo: str, doc: Optional[dict]) -> dict:
    meta = MODULOS_CAMPOS[modulo]
    validos = {k for k, _ in meta["campos"]}
    doc = doc or {}
    try:
        cfg = CamposConfigInput(**{k: doc.get(k) for k in ("obrigatorios", "extras", "cores_linhas") if doc.get(k) is not None})
    except Exception:
        cfg = CamposConfigInput()
    out = cfg.model_dump()
    out["obrigatorios"] = [k for k in out["obrigatorios"] if k in validos]
    out["modulo"] = modulo
    return out


async def _todos() -> Dict[str, dict]:
    agora = time.time()
    if _cache["dados"] is not None and agora - _cache["at"] < _TTL:
        return _cache["dados"]
    docs = {d.get("modulo"): d for d in await campos_config_repo.find(limit=100)}
    dados = {m: _normalizar(m, docs.get(m)) for m in MODULOS_CAMPOS}
    _cache.update(at=agora, dados=dados)
    return dados


def invalidar_cache() -> None:
    _cache["dados"] = None


async def get_config(modulo: str) -> dict:
    return (await _todos())[modulo]


async def catalogo_completo() -> dict:
    """Tudo o que o frontend precisa: campos do sistema, estados e configuração guardada."""
    dados = await _todos()
    out = {}
    for m, meta in MODULOS_CAMPOS.items():
        out[m] = {
            "label": meta["label"],
            "validar": meta["validar"],
            "campos": [{"key": k, "label": label} for k, label in meta["campos"]],
            "estado": (
                {"campo": meta["estado"]["campo"],
                 "valores": [{"valor": v, "label": label} for v, label in meta["estado"]["valores"]]}
                if meta.get("estado") else None
            ),
            "config": dados[m],
        }
    return out


async def guardar_config(modulo: str, data: CamposConfigInput) -> dict:
    meta = MODULOS_CAMPOS[modulo]
    validos = {k for k, _ in meta["campos"]}
    invalidos = [k for k in data.obrigatorios if k not in validos]
    if invalidos:
        raise HTTPException(400, f"Campos desconhecidos: {', '.join(invalidos)}")
    campo_cor = data.cores_linhas.campo
    if campo_cor == "estado" and not meta.get("estado"):
        raise HTTPException(400, "Este módulo não tem estados para colorir")
    if campo_cor.startswith("extra:"):
        key = campo_cor.split(":", 1)[1]
        alvo = next((c for c in data.extras if c.key == key), None)
        if not alvo or alvo.tipo != "lista":
            raise HTTPException(400, "As cores das linhas só podem vir de um campo personalizado do tipo lista")
    elif campo_cor not in ("", "estado"):
        raise HTTPException(400, "Origem das cores inválida")
    doc = {"id": f"campos_{modulo}", "modulo": modulo, **data.model_dump()}
    await campos_config_repo.update_where({"modulo": modulo}, doc, upsert=True)
    invalidar_cache()
    return _normalizar(modulo, doc)


def _converter(campo: dict, valor: Any) -> Any:
    tipo = campo.get("tipo")
    if _vazio(valor):
        return False if tipo == "sim_nao" else None
    if tipo == "numero":
        try:
            return float(str(valor).replace(",", "."))
        except (TypeError, ValueError):
            raise HTTPException(400, f"«{campo['label']}» tem de ser um número")
    if tipo == "sim_nao":
        return bool(valor) and str(valor).lower() not in ("false", "0", "nao", "não")
    if tipo == "lista":
        opcoes = [o["valor"] for o in campo.get("opcoes") or []]
        if str(valor) not in opcoes:
            raise HTTPException(400, f"«{campo['label']}»: opção inválida")
        return str(valor)
    return str(valor).strip()


def _condicao(dep: dict, pai: dict, valor: Any) -> bool:
    valores = dep.get("valores") or []
    if pai.get("tipo") == "sim_nao":
        return bool(valor) == ((valores or ["sim"])[0] == "sim")
    if _vazio(valor) or valor is False:
        return False
    if pai.get("tipo") == "lista" and valores:
        return str(valor) in valores
    return True


def campos_visiveis(defs: list, valores: dict) -> Dict[str, bool]:
    """Que campos personalizados estão visíveis, dados os valores (campos dependentes)."""
    por_key = {c["key"]: c for c in defs}
    memo: Dict[str, bool] = {}

    def vis(c: dict, pilha: frozenset) -> bool:
        k = c["key"]
        if k in memo:
            return memo[k]
        if not c.get("ativo", True):
            memo[k] = False
            return False
        dep = c.get("depende_de") or {}
        if not dep.get("campo"):
            memo[k] = True
            return True
        pai = por_key.get(dep["campo"])
        if pai is None or pai["key"] in pilha:
            memo[k] = False
            return False
        memo[k] = vis(pai, pilha | {k}) and _condicao(dep, pai, valores.get(pai["key"]))
        return memo[k]

    return {c["key"]: vis(c, frozenset()) for c in defs}


def opcao_disponivel(campo: dict, opcao: str, defs: list, valores: dict) -> bool:
    o = next((x for x in campo.get("opcoes") or [] if x.get("valor") == opcao), None)
    if o is None:
        return False
    pais = o.get("pais") or []
    dep = campo.get("depende_de") or {}
    if not pais or not dep.get("campo"):
        return True
    return str(valores.get(dep["campo"]) or "") in pais


async def aplicar(modulo: str, doc: dict, momento: str, existente: Optional[dict] = None) -> dict:
    """Limpa `campos_extra` e valida os obrigatórios quando o momento o exige.

    momento: "criar" | "guardar" | "finalizar".
    existente: documento atual (para validar campos que o pedido não traz).
    """
    if modulo not in MODULOS_CAMPOS:
        return doc
    cfg = await get_config(modulo)
    extras_def = [c for c in cfg["extras"] if c.get("ativo", True)]
    recebidos = doc.get("campos_extra")
    # {} vazio = o formulário não trouxe os campos (ex.: diálogo rápido) → manter os atuais.
    # Limpar um campo envia a chave com valor vazio, nunca um objeto vazio.
    if not recebidos and existente is not None:
        recebidos = existente.get("campos_extra") or {}
    recebidos = recebidos or {}
    limpos = {}
    for c in extras_def:
        limpos[c["key"]] = _converter(c, recebidos.get(c["key"]))
    # Campos dependentes: o que fica escondido pela resposta a outro campo é limpo;
    # numa lista dependente, a opção tem de pertencer à opção escolhida no campo "pai".
    visiveis = campos_visiveis(cfg["extras"], limpos)
    for c in extras_def:
        k = c["key"]
        if not visiveis.get(k, True):
            limpos[k] = False if c.get("tipo") == "sim_nao" else None
        elif c.get("tipo") == "lista" and not _vazio(limpos.get(k)) and not opcao_disponivel(c, limpos[k], cfg["extras"], limpos):
            pai = next((x for x in cfg["extras"] if x["key"] == (c.get("depende_de") or {}).get("campo")), {})
            raise HTTPException(400, f"«{c['label']}»: a opção «{limpos[k]}» não existe para "
                                     f"«{pai.get('label', '')}» = «{limpos.get(pai.get('key'), '') or '—'}»")
    # mantém valores de campos desativados (não se perdem dados)
    for k, v in recebidos.items():
        if k not in limpos and any(c["key"] == k for c in cfg["extras"]):
            limpos[k] = v
    doc["campos_extra"] = limpos

    modo = MODULOS_CAMPOS[modulo]["validar"]
    validar = (
        (modo == "sempre" and momento in ("criar", "guardar"))
        or (modo == "guardar" and momento == "guardar")
        or (modo == "finalizar" and momento == "finalizar")
        or momento == "finalizar"
    )
    if not validar:
        return doc

    base = {**(existente or {}), **doc}
    labels = dict(MODULOS_CAMPOS[modulo]["campos"])
    faltam = [labels[k] for k in cfg["obrigatorios"] if _vazio(base.get(k))]
    faltam += [c["label"] for c in extras_def
               if c.get("obrigatorio") and c.get("tipo") != "sim_nao" and visiveis.get(c["key"], True)
               and _vazio(limpos.get(c["key"]))]
    if faltam:
        raise HTTPException(400, "Campos obrigatórios em falta: " + ", ".join(faltam))
    return doc
