"""Financeiro: conta corrente (clientes/fornecedores), extrato em PDF, previsão de tesouraria, extrato bancário
(importação e conciliação), lembretes de cobrança e exportação para o contabilista."""
from __future__ import annotations

import hashlib
import io
import re
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException

from app.core.database import new_id, now_iso, round2
from app.repositories import (
    clientes_repo, contas_repo, documentos_financeiros_repo, encomendas_repo, extrato_bancario_repo, fornecedores_repo,
    integracoes_repo, ordens_compra_repo,
)

CFG_ID = "tesouraria"


def _hoje() -> date:
    return datetime.now(timezone.utc).date()


def _dias_condicao(txt: str) -> int:
    m = re.search(r"(\d+)", txt or "")
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------------------
# Conta corrente
# ---------------------------------------------------------------------------
async def conta_corrente_cliente(cid: str, de: str = "", ate: str = "") -> dict:
    from app.services.costing import compute_encomendas_many
    c = await clientes_repo.get(cid)
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    encs = await compute_encomendas_many(await encomendas_repo.find({"cliente_id": cid, "estado": {"$ne": "cancelada"}}, limit=5000))
    mov = []
    for e in encs:
        total = float(e.get("total_com_iva") or e.get("valor_total") or 0)
        mov.append({"data": (e.get("data") or e.get("created_at") or "")[:10], "tipo": "encomenda", "documento": e.get("numero"),
                    "descricao": e.get("descricao") or "Encomenda", "debito": round2(total), "credito": 0.0, "link": f"/encomendas/{e['id']}"})
        for p in e.get("pagamentos") or []:
            dev = p.get("tipo") == "devolucao"
            mov.append({"data": (p.get("data") or p.get("created_at") or "")[:10], "tipo": "devolucao" if dev else "pagamento",
                        "documento": p.get("recibo_numero") or "", "descricao": f"{'Devolução' if dev else 'Pagamento'} ({p.get('metodo') or ''}) — {e.get('numero')}",
                        "debito": round2(p["valor"]) if dev else 0.0, "credito": 0.0 if dev else round2(p.get("valor") or 0),
                        "link": f"/encomendas/{e['id']}"})
    return _montar(mov, de, ate, {"id": c["id"], "nome": c.get("nome"), "nif": c.get("nif"), "email": c.get("email"),
                                  "morada": c.get("morada"), "cidade": c.get("cidade")}, "cliente")


async def conta_corrente_fornecedor(fid: str, de: str = "", ate: str = "") -> dict:
    f = await fornecedores_repo.get(fid)
    if not f:
        raise HTTPException(404, "Fornecedor não encontrado")
    mov = []
    for o in await ordens_compra_repo.find({"fornecedor_id": fid, "estado": {"$ne": "cancelada"}}, limit=5000):
        ff = o.get("fatura_fornecedor") or {}
        total = float(ff.get("total") or o.get("total") or 0)
        mov.append({"data": (ff.get("data") or o.get("data") or o.get("created_at") or "")[:10], "tipo": "compra",
                    "documento": ff.get("numero") or o.get("codigo"), "descricao": o.get("assunto") or "Compra",
                    "debito": 0.0, "credito": round2(total), "link": f"/ordens-compra/{o['id']}"})
        if float(o.get("valor_pago") or 0) > 0:
            mov.append({"data": (o.get("data_pagamento") or o.get("data") or "")[:10], "tipo": "pagamento", "documento": o.get("codigo"),
                        "descricao": "Pagamento ao fornecedor", "debito": round2(float(o["valor_pago"])), "credito": 0.0,
                        "link": f"/ordens-compra/{o['id']}"})
    for ct in await contas_repo.find({"tipo": "pagar", "entidade_id": fid}, limit=5000):
        mov.append({"data": (ct.get("data") or "")[:10], "tipo": "conta", "documento": ct.get("numero") or ct.get("referencia"),
                    "descricao": ct.get("descricao") or "Conta a pagar", "debito": round2(float(ct.get("valor_pago") or 0)),
                    "credito": round2(float(ct.get("valor") or 0)), "link": f"/contas/{ct['id']}"})
    return _montar(mov, de, ate, {"id": f["id"], "nome": f.get("nome"), "nif": f.get("nif"), "email": f.get("email")}, "fornecedor")


def _montar(mov: List[dict], de: str, ate: str, entidade: dict, tipo: str) -> dict:
    mov.sort(key=lambda m: (m["data"] or "", 0 if m["debito"] else 1))
    sinal = 1 if tipo == "cliente" else -1  # cliente: saldo a receber; fornecedor: saldo a pagar
    saldo_ant = round2(sum((m["debito"] - m["credito"]) * sinal for m in mov if de and m["data"] < de))
    saldo = saldo_ant
    linhas = []
    for m in mov:
        if (de and m["data"] < de) or (ate and m["data"] > ate):
            continue
        saldo = round2(saldo + (m["debito"] - m["credito"]) * sinal)
        linhas.append({**m, "saldo": saldo})
    return {"entidade": entidade, "tipo": tipo, "de": de, "ate": ate, "saldo_anterior": saldo_ant, "linhas": linhas,
            "saldo": saldo, "total_debito": round2(sum(l["debito"] for l in linhas)),
            "total_credito": round2(sum(l["credito"] for l in linhas))}


def extrato_pdf(cc: dict, empresa: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    eur = lambda v: f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")  # noqa: E731
    fdata = lambda d: f"{d[8:10]}/{d[5:7]}/{d[:4]}" if d and len(d) >= 10 else (d or "")  # noqa: E731
    el = [Paragraph(f"<b>{empresa.get('nome') or ''}</b>", st["Normal"]),
          Paragraph(f"Extrato de conta corrente — {cc['entidade'].get('nome')}" + (f" (NIF {cc['entidade']['nif']})" if cc["entidade"].get("nif") else ""), st["Heading2"]),
          Paragraph(f"Período: {fdata(cc['de']) or 'início'} a {fdata(cc['ate']) or fdata(_hoje().isoformat())}", st["Normal"]), Spacer(1, 6)]
    dados = [["Data", "Documento", "Descrição", "Débito", "Crédito", "Saldo"]]
    if cc["de"]:
        dados.append(["", "", "Saldo anterior", "", "", eur(cc["saldo_anterior"])])
    for l in cc["linhas"]:
        dados.append([fdata(l["data"]), l["documento"] or "", Paragraph(l["descricao"][:80], st["BodyText"]),
                      eur(l["debito"]) if l["debito"] else "", eur(l["credito"]) if l["credito"] else "", eur(l["saldo"])])
    dados.append(["", "", "Totais", eur(cc["total_debito"]), eur(cc["total_credito"]), eur(cc["saldo"])])
    t = Table(dados, colWidths=[20 * mm, 28 * mm, 66 * mm, 22 * mm, 22 * mm, 22 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 8), ("ALIGN", (3, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                           ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]))
    el.append(t)
    rotulo = "a receber" if cc["tipo"] == "cliente" else "a pagar"
    el += [Spacer(1, 8), Paragraph(f"<b>Saldo {rotulo}: {eur(cc['saldo'])}</b>", st["Normal"])]
    doc.build(el)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Previsão de tesouraria
# ---------------------------------------------------------------------------
async def get_config() -> dict:
    g = await integracoes_repo.get(CFG_ID) or {}
    return {"saldo_banco": float(g.get("saldo_banco") or 0), "saldo_data": g.get("saldo_data"),
            "cobranca_dias": int(g.get("cobranca_dias") or 15)}


async def guardar_config(dados: dict) -> dict:
    patch = {"id": CFG_ID}
    if "saldo_banco" in dados:
        patch.update({"saldo_banco": round2(float(dados.get("saldo_banco") or 0)), "saldo_data": now_iso()[:10]})
    if "cobranca_dias" in dados:
        patch["cobranca_dias"] = max(1, int(dados.get("cobranca_dias") or 15))
    await integracoes_repo.update_where({"id": CFG_ID}, patch, upsert=True)
    return await get_config()


async def previsao(semanas: int = 12) -> dict:
    from app.services.costing import compute_encomendas_many
    hoje = _hoje()
    s0 = hoje - timedelta(days=hoje.weekday())
    cols = [s0 + timedelta(weeks=i) for i in range(semanas)]

    def idx(d: Optional[str]) -> int:
        try:
            dd = date.fromisoformat((d or "")[:10])
        except ValueError:
            return 0
        return max(0, min(semanas - 1, (dd - s0).days // 7)) if dd >= s0 else -1  # -1 = em atraso

    entradas = [0.0] * semanas
    saidas = [0.0] * semanas
    atraso_in, atraso_out = 0.0, 0.0
    det: List[dict] = []
    cond = {c["id"]: _dias_condicao(c.get("condicoes_pagamento") or "") for c in await clientes_repo.find({}, limit=20000)}
    encs = await compute_encomendas_many(await encomendas_repo.find({"estado": {"$ne": "cancelada"}}, limit=10000))
    for e in encs:
        pend = float(e.get("valor_pendente") or 0)
        if pend <= 0.009:
            continue
        base = e.get("data_entrega") or e.get("prazo_entrega") or e.get("data") or hoje.isoformat()
        try:
            prev = (date.fromisoformat(base[:10]) + timedelta(days=cond.get(e.get("cliente_id"), 0))).isoformat()
        except ValueError:
            prev = hoje.isoformat()
        i = idx(prev)
        if i < 0:
            atraso_in += pend
        else:
            entradas[i] += pend
        det.append({"tipo": "entrada", "data": prev, "valor": round2(pend), "descricao": f"{e.get('numero')} · {e.get('cliente')}",
                    "link": f"/encomendas/{e['id']}", "atraso": i < 0})
    for ct in await contas_repo.find({"estado": {"$ne": "paga"}}, limit=10000):
        falta = float(ct.get("valor") or 0) - float(ct.get("valor_pago") or 0)
        if falta <= 0.009:
            continue
        i = idx(ct.get("vencimento") or ct.get("data"))
        alvo_in = ct.get("tipo") == "receber"
        if i < 0:
            if alvo_in:
                atraso_in += falta
            else:
                atraso_out += falta
        else:
            (entradas if alvo_in else saidas)[i] += falta
        det.append({"tipo": "entrada" if alvo_in else "saida", "data": (ct.get("vencimento") or ct.get("data") or "")[:10],
                    "valor": round2(falta), "descricao": f"{ct.get('numero') or ''} · {ct.get('entidade') or ct.get('descricao')}",
                    "link": f"/contas/{ct['id']}", "atraso": i < 0})
    for o in await ordens_compra_repo.find({"estado": {"$ne": "cancelada"}}, limit=10000):
        falta = float((o.get("fatura_fornecedor") or {}).get("total") or o.get("total") or 0) - float(o.get("valor_pago") or 0)
        if falta <= 0.009:
            continue
        i = idx(o.get("vencimento") or o.get("data"))
        if i < 0:
            atraso_out += falta
        else:
            saidas[i] += falta
        det.append({"tipo": "saida", "data": (o.get("vencimento") or o.get("data") or "")[:10], "valor": round2(falta),
                    "descricao": f"{o.get('codigo')} · {o.get('fornecedor_nome')}", "link": f"/ordens-compra/{o['id']}", "atraso": i < 0})
    cfg = await get_config()
    saldo = cfg["saldo_banco"]
    linhas = []
    for k, c in enumerate(cols):
        saldo = round2(saldo + entradas[k] - saidas[k] + (atraso_in - atraso_out if k == 0 else 0))
        linhas.append({"semana": c.isoformat(), "entradas": round2(entradas[k]), "saidas": round2(saidas[k]), "saldo": saldo})
    det.sort(key=lambda x: x["data"])
    return {"saldo_inicial": cfg["saldo_banco"], "saldo_data": cfg["saldo_data"], "atraso_entradas": round2(atraso_in),
            "atraso_saidas": round2(atraso_out), "semanas": linhas, "detalhe": det}


# ---------------------------------------------------------------------------
# Extrato bancário: importação e conciliação
# ---------------------------------------------------------------------------
def _num(v) -> Optional[float]:
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v or ""))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _data(v) -> Optional[str]:
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    s = str(v or "").strip()
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


async def importar_extrato(nome: str, dados: bytes) -> dict:
    """Lê CSV/Excel do banco: deteta colunas de data, descrição e valor (ou débito/crédito)."""
    from app.services.precos_fornecedor import ler_ficheiro
    linhas = [r for r in ler_ficheiro(nome, dados) if any(c not in (None, "") for c in r)]
    hi, cab = None, []
    for i, r in enumerate(linhas[:30]):
        low = [str(c or "").lower() for c in r]
        if any("data" in c or "date" in c for c in low) and any(k in c for c in low for k in ("montante", "valor", "débito", "debito", "crédito", "credito", "amount")):
            hi, cab = i, low
            break
    if hi is None:
        raise HTTPException(400, "Não encontrei as colunas de data e valor. Exporte o extrato em CSV/Excel com cabeçalho.")

    def col(*ps, evitar=()):
        return next((j for j, c in enumerate(cab) if any(p in c for p in ps) and not any(e in c for e in evitar)), None)
    c_data = col("data mov", "data lan", "data", "date", evitar=("valor",))
    c_desc = col("descri", "movimento", "histórico", "historico", "concept", "description")
    c_val = col("montante", "valor", "amount", evitar=("data", "saldo"))
    c_deb, c_cred = col("débito", "debito", "debit"), col("crédito", "credito", "credit")
    novos, repetidos = 0, 0
    for r in linhas[hi + 1:]:
        d = _data(r[c_data]) if c_data is not None and c_data < len(r) else None
        if not d:
            continue
        if c_deb is not None or c_cred is not None:
            deb = _num(r[c_deb]) if c_deb is not None and c_deb < len(r) else None
            cred = _num(r[c_cred]) if c_cred is not None and c_cred < len(r) else None
            v = (cred or 0) - abs(deb or 0)
        else:
            v = _num(r[c_val]) if c_val is not None and c_val < len(r) else None
        if not v:
            continue
        desc = str(r[c_desc] if c_desc is not None and c_desc < len(r) else "").strip()
        h = hashlib.sha1(f"{d}|{v:.2f}|{desc}".encode()).hexdigest()
        if await extrato_bancario_repo.find_one({"hash": h}):
            repetidos += 1
            continue
        await extrato_bancario_repo.insert({"id": new_id(), "hash": h, "data": d, "descricao": desc, "valor": round2(v),
                                            "estado": "por_conciliar", "created_at": now_iso()})
        novos += 1
    return {"novos": novos, "repetidos": repetidos}


async def sugestoes_conciliacao() -> List[dict]:
    from app.services.costing import compute_encomendas_many
    movs = await extrato_bancario_repo.find({"estado": "por_conciliar"}, sort=("data", -1), limit=1000)
    encs = [e for e in await compute_encomendas_many(await encomendas_repo.find({"estado": {"$ne": "cancelada"}}, limit=10000))
            if float(e.get("valor_pendente") or 0) > 0.009]
    ocs = [o for o in await ordens_compra_repo.find({"estado": {"$ne": "cancelada"}}, limit=10000)
           if float((o.get("fatura_fornecedor") or {}).get("total") or o.get("total") or 0) - float(o.get("valor_pago") or 0) > 0.009]
    out = []
    for m in movs:
        cands = []
        desc = (m.get("descricao") or "").upper()
        if m["valor"] > 0:
            for e in encs:
                pend = round2(float(e["valor_pendente"]))
                nome = (e.get("cliente") or "").upper().split()
                pontos = (3 if (e.get("numero") or "#").upper() in desc else 0) + (2 if abs(pend - m["valor"]) < 0.01 else 0) + \
                    (1 if nome and nome[0] in desc else 0)
                if pontos >= 2:
                    cands.append({"tipo": "encomenda", "id": e["id"], "numero": e.get("numero"), "nome": e.get("cliente"),
                                  "pendente": pend, "pontos": pontos})
        else:
            for o in ocs:
                falta = round2(float((o.get("fatura_fornecedor") or {}).get("total") or o.get("total") or 0) - float(o.get("valor_pago") or 0))
                nome = (o.get("fornecedor_nome") or "").upper().replace("[SIM] ", "").split()
                pontos = (2 if abs(falta + m["valor"]) < 0.01 else 0) + (1 if nome and nome[0] in desc else 0) + \
                    (3 if ((o.get("fatura_fornecedor") or {}).get("numero") or "#").upper() in desc else 0)
                if pontos >= 2:
                    cands.append({"tipo": "ordem_compra", "id": o["id"], "numero": o.get("codigo"), "nome": o.get("fornecedor_nome"),
                                  "pendente": falta, "pontos": pontos})
        cands.sort(key=lambda c: -c["pontos"])
        out.append({**m, "candidatos": cands[:5]})
    return out


async def conciliar(mid: str, tipo: str, alvo_id: str, user: dict) -> dict:
    from app.domain.models import Pagamento
    from app.core.database import next_sequence
    from app.services import audit, workflow
    from app.services.costing import compute_encomenda, soma_valor_pago
    m = await extrato_bancario_repo.get(mid)
    if not m or m.get("estado") != "por_conciliar":
        raise HTTPException(404, "Movimento não encontrado ou já conciliado")
    if tipo == "ignorar":
        await extrato_bancario_repo.update(mid, {"estado": "ignorado", "conciliado_por": user.get("name") or ""})
        return {"ok": True}
    if tipo == "encomenda":
        e = await encomendas_repo.get(alvo_id)
        if not e or m["valor"] <= 0:
            raise HTTPException(400, "Encomenda inválida para este movimento")
        antes = (await compute_encomenda(dict(e))).get("status_pagamento")
        pag = Pagamento(valor=m["valor"], metodo="transferencia", data=m["data"], nota=f"Extrato: {m.get('descricao')[:80]}")
        pag.recibo_numero = await next_sequence("REC")
        pags = (e.get("pagamentos") or []) + [pag.model_dump()]
        await encomendas_repo.update(e["id"], {"pagamentos": pags, "valor_pago": soma_valor_pago(pags)})
        await audit.registar("encomenda", e["id"], "pagamento", user,
                             f"Pagamento de {m['valor']:.2f}€ (transferência, extrato bancário) · recibo {pag.recibo_numero}", e.get("numero"))
        await workflow.apos_pagamento(e["id"], antes, m["valor"], origem=f"Transferência · {pag.recibo_numero}")
        ref = {"tipo": "encomenda", "id": e["id"], "numero": e.get("numero")}
    elif tipo == "ordem_compra":
        o = await ordens_compra_repo.get(alvo_id)
        if not o or m["valor"] >= 0:
            raise HTTPException(400, "Ordem de compra inválida para este movimento")
        await ordens_compra_repo.update(o["id"], {"valor_pago": round2(float(o.get("valor_pago") or 0) + abs(m["valor"])),
                                                  "data_pagamento": m["data"]})
        await audit.registar("ordem_compra", o["id"], "editado", user, f"Pagamento de {abs(m['valor']):.2f}€ (extrato bancário)", o.get("codigo"))
        ref = {"tipo": "ordem_compra", "id": o["id"], "numero": o.get("codigo")}
    else:
        raise HTTPException(400, "Tipo inválido")
    await extrato_bancario_repo.update(mid, {"estado": "conciliado", "conciliado_com": ref, "conciliado_por": user.get("name") or "",
                                             "conciliado_at": now_iso()})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Lembretes de cobrança
# ---------------------------------------------------------------------------
async def verificar_cobrancas() -> int:
    from app.services import workflow
    from app.services.costing import compute_encomendas_many
    cfg = await get_config()
    limite = (_hoje() - timedelta(days=cfg["cobranca_dias"])).isoformat()
    n = 0
    for e in await compute_encomendas_many(await encomendas_repo.find({"estado": {"$ne": "cancelada"}, "entregue": True}, limit=10000)):
        pend = float(e.get("valor_pendente") or 0)
        if pend <= 0.009 or (e.get("data_entrega") or "9")[:10] > limite:
            continue
        r = await workflow.evento("cobranca", f"Por cobrar: {e.get('numero')} ({e.get('cliente')}) — {pend:.2f} €",
                                  f"Entregue em {e.get('data_entrega')} e ainda com {pend:.2f} € por pagar.",
                                  link=f"/encomendas/{e['id']}", entidade="encomenda", entidade_id=e["id"],
                                  chave=f"cobranca:{e['id']}:{round(pend, 2)}")
        n += 1 if r else 0
    return n


# ---------------------------------------------------------------------------
# Exportação para o contabilista
# ---------------------------------------------------------------------------
async def exportar_contabilista(de: str, ate: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook()

    def folha(titulo, cab, linhas, primeira=False):
        ws = wb.active if primeira else wb.create_sheet()
        ws.title = titulo[:31]
        ws.append(cab)
        for c in ws[1]:
            c.font = Font(bold=True)
        for l in linhas:
            ws.append(l)
        for i, _ in enumerate(cab, 1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = 18
    no = lambda d: bool(d) and de <= d[:10] <= ate  # noqa: E731
    docs = [d for d in await documentos_financeiros_repo.find({}, sort=("data", 1), limit=50000) if no(d.get("data") or d.get("created_at"))]
    folha("Documentos de venda", ["Data", "Tipo", "Número", "Nº oficial", "ATCUD", "Cliente", "NIF", "Base", "IVA", "Total", "Estado", "Encomenda"],
          [[(d.get("data") or "")[:10], d.get("tipo"), d.get("numero"), (d.get("faturacao") or {}).get("numero") or "",
            (d.get("faturacao") or {}).get("atcud") or "", d.get("cliente"), d.get("cliente_nif") or "",
            round2(float(d.get("total") or 0) - float(d.get("iva_valor") or 0)), d.get("iva_valor") or 0, d.get("total") or 0,
            d.get("estado"), d.get("encomenda_numero") or ""] for d in docs], primeira=True)
    recebs = []
    for e in await encomendas_repo.find({}, limit=50000):
        for p in e.get("pagamentos") or []:
            if no(p.get("data") or p.get("created_at")):
                recebs.append([(p.get("data") or "")[:10], p.get("recibo_numero"), e.get("numero"), e.get("cliente"), p.get("metodo"),
                               -p["valor"] if p.get("tipo") == "devolucao" else p.get("valor"), p.get("documento_numero") or ""])
    folha("Recebimentos", ["Data", "Recibo", "Encomenda", "Cliente", "Método", "Valor", "Documento"], sorted(recebs, key=lambda x: x[0]))
    compras = []
    for o in await ordens_compra_repo.find({"estado": {"$ne": "cancelada"}}, limit=50000):
        ff = o.get("fatura_fornecedor") or {}
        d = ff.get("data") or o.get("data")
        if no(d):
            compras.append([(d or "")[:10], o.get("codigo"), ff.get("numero") or "", o.get("fornecedor_nome"), o.get("tipo_despesa"),
                            ff.get("total") or o.get("total") or 0, ff.get("portes") or 0, o.get("valor_pago") or 0,
                            (o.get("data_pagamento") or "")[:10]])
    folha("Compras e despesas", ["Data", "OC", "Fatura fornecedor", "Fornecedor", "Tipo", "Total", "Portes", "Pago", "Data pagamento"],
          sorted(compras, key=lambda x: x[0]))
    contas = [c for c in await contas_repo.find({}, limit=50000) if no(c.get("data"))]
    folha("Contas a pagar e receber", ["Data", "Tipo", "Número", "Entidade", "Descrição", "Valor", "Pago", "Vencimento", "Estado"],
          [[(c.get("data") or "")[:10], c.get("tipo"), c.get("numero"), c.get("entidade"), c.get("descricao"), c.get("valor"),
            c.get("valor_pago"), (c.get("vencimento") or "")[:10], c.get("estado")] for c in contas])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
