"""Manutenção das máquinas: planos por horas de uso ou por dias, com registo e alertas."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import manutencoes_repo, maquinas_repo, ordens_repo


async def horas_uso() -> Dict[str, float]:
    """Horas de máquina já feitas (tempo real acertado ou estimado das operações concluídas)."""
    out: Dict[str, float] = {}
    for of in await ordens_repo.find({}, limit=50000):
        for it in of.get("itens") or []:
            for op in it.get("operacoes") or []:
                mid = op.get("maquina_id")
                if not mid:
                    continue
                if op.get("tempo_maquina_real") is not None:
                    m = float(op["tempo_maquina_real"])
                elif op.get("concluida"):
                    m = float(op.get("tempo_maquina") or 0)
                else:
                    continue
                out[mid] = out.get(mid, 0.0) + m / 60
    return {k: round2(v) for k, v in out.items()}


def estado_plano(p: dict, horas: float, hoje: Optional[date] = None) -> dict:
    hoje = hoje or date.today()
    ult = p.get("ultima") or {}
    if p["tipo"] == "horas":
        base = float(ult.get("horas") if ult.get("horas") is not None else p.get("horas_inicio") or 0)
        feito = round2(horas - base)
        falta = round2(float(p["intervalo"]) - feito)
        pct = feito / float(p["intervalo"]) * 100 if p["intervalo"] else 0
        txt = f"{falta:g} h" if falta > 0 else f"passou {abs(falta):g} h"
    else:
        d0 = date.fromisoformat((ult.get("data") or p.get("created_at") or hoje.isoformat())[:10])
        prox = d0 + timedelta(days=int(p["intervalo"]))
        falta = (prox - hoje).days
        pct = (hoje - d0).days / float(p["intervalo"]) * 100 if p["intervalo"] else 0
        txt = f"{falta} dias ({prox.strftime('%d/%m/%Y')})" if falta >= 0 else f"atrasada {abs(falta)} dias"
    situacao = "atrasada" if falta < 0 else ("proxima" if pct >= 85 else "ok")
    return {"falta": falta, "pct": round2(min(pct, 999)), "texto": txt, "situacao": situacao}


async def listar() -> dict:
    horas = await horas_uso()
    maqs = {m["id"]: m for m in await maquinas_repo.find({}, sort=("nome", 1), limit=500)}
    planos = []
    for p in await manutencoes_repo.find({}, sort=("nome", 1), limit=2000):
        h = horas.get(p["maquina_id"], 0.0)
        planos.append({**p, "maquina_nome": (maqs.get(p["maquina_id"]) or {}).get("nome") or "Máquina removida",
                       "horas_uso": h, **estado_plano(p, h)})
    planos.sort(key=lambda x: ({"atrasada": 0, "proxima": 1, "ok": 2}[x["situacao"]], x["maquina_nome"]))
    return {"planos": planos, "maquinas": [{"id": m["id"], "nome": m["nome"], "horas_uso": horas.get(m["id"], 0.0)}
                                           for m in maqs.values()]}


async def guardar(dados: dict, pid: Optional[str] = None) -> dict:
    if not await maquinas_repo.get(dados.get("maquina_id") or ""):
        raise HTTPException(400, "Escolha a máquina")
    nome = (dados.get("nome") or "").strip()
    intervalo = float(dados.get("intervalo") or 0)
    if not nome or intervalo <= 0:
        raise HTTPException(400, "Indique o nome e o intervalo")
    doc = {"maquina_id": dados["maquina_id"], "nome": nome, "tipo": "horas" if dados.get("tipo") == "horas" else "dias",
           "intervalo": intervalo, "instrucoes": (dados.get("instrucoes") or "").strip(), "updated_at": now_iso()}
    if pid:
        if not await manutencoes_repo.get(pid):
            raise HTTPException(404, "Plano não encontrado")
        await manutencoes_repo.update(pid, doc)
        return {**(await manutencoes_repo.get(pid))}
    horas = (await horas_uso()).get(doc["maquina_id"], 0.0)
    doc.update({"id": new_id(), "created_at": now_iso(), "horas_inicio": horas, "ultima": None, "registos": []})
    await manutencoes_repo.insert(doc)
    return doc


async def registar(pid: str, dados: dict, user: dict) -> dict:
    p = await manutencoes_repo.get(pid)
    if not p:
        raise HTTPException(404, "Plano não encontrado")
    horas = (await horas_uso()).get(p["maquina_id"], 0.0)
    reg = {"id": new_id(), "data": (dados.get("data") or now_iso())[:10], "horas": horas, "notas": (dados.get("notas") or "").strip(),
           "custo": round2(float(dados.get("custo") or 0)), "por": user.get("name") or user.get("nome") or "", "at": now_iso()}
    await manutencoes_repo.update(pid, {"ultima": {"data": reg["data"], "horas": horas}, "registos": (p.get("registos") or []) + [reg]})
    return reg


async def verificar() -> int:
    from app.services import workflow
    n = 0
    for p in (await listar())["planos"]:
        if p["situacao"] == "ok":
            continue
        chave = f"manut:{p['id']}:{(p.get('ultima') or {}).get('data') or 'inicio'}:{p['situacao']}"
        r = await workflow.evento("manutencao", f"Manutenção {'atrasada' if p['situacao'] == 'atrasada' else 'a chegar'}: {p['nome']}",
                                  f"{p['maquina_nome']} · {p['texto']}", link="/manutencao", entidade="maquina",
                                  entidade_id=p["maquina_id"], chave=chave)
        n += 1 if r else 0
    return n
