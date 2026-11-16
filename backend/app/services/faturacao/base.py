"""Peças comuns aos programas de faturação certificados (FIZ, TOConline, Moloni).

Cada programa tem um "adaptador" com a mesma forma:
    testar(cfg)                      -> {"ok", "empresa", ...}
    dados(cfg)                       -> séries, métodos de pagamento, impostos (para escolher nas Definições)
    emitir(cfg, doc, cliente, ctx)   -> ResultadoEmissao
    pdf_url(cfg, externo)            -> URL do PDF oficial
    registar_recebimento(cfg, externo, valor, metodo, data) -> ResultadoEmissao (recibo)
    anular(cfg, externo, motivo)     -> None  (FaturacaoNaoSuportado se o programa não deixa)

O ERP guarda o resultado em `documento.faturacao` e usa o número oficial (com ATCUD) do programa.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException

TIMEOUT = 30


class FaturacaoErro(HTTPException):
    """Erro devolvido pelo programa de faturação (mensagem já em português para o utilizador)."""

    def __init__(self, mensagem: str, status: int = 502):
        super().__init__(status, mensagem)


class FaturacaoNaoSuportado(FaturacaoErro):
    def __init__(self, mensagem: str):
        super().__init__(mensagem, 409)


@dataclass
class ResultadoEmissao:
    externo_id: str
    numero: str = ""
    atcud: str = ""
    hash_curto: str = ""
    pdf_url: str = ""
    estado_at: str = ""          # comunicado | pendente | erro | "" (desconhecido)
    mensagem_at: str = ""
    total: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# Métodos de pagamento do ERP → códigos SAF-T (PaymentMechanism)
SAFT_METODO = {
    "numerario": "NU",
    "transferencia": "TB",
    "multibanco": "MB",
    "mbway": "MB",
    "cartao": "CC",
    "cheque": "CH",
    "outro": "OU",
}

# Motivos de isenção de IVA mais comuns (códigos da AT)
MOTIVOS_ISENCAO = [
    {"codigo": "M10", "label": "M10 — Regime de isenção (art. 53.º do CIVA)"},
    {"codigo": "M07", "label": "M07 — Isento (art. 9.º do CIVA)"},
    {"codigo": "M05", "label": "M05 — Isento (art. 14.º do CIVA)"},
    {"codigo": "M16", "label": "M16 — Isento (art. 14.º do RITI)"},
    {"codigo": "M40", "label": "M40 — Autoliquidação (art. 6.º n.º 6 a) do CIVA)"},
    {"codigo": "M99", "label": "M99 — Não sujeito ou não tributado"},
]
MOTIVOS_ISENCAO_TEXTO = {
    "M10": "IVA - regime de isenção [art. 53.º]",
    "M07": "Isento artigo 9.º do CIVA",
    "M05": "Isento artigo 14.º do CIVA",
    "M16": "Isento artigo 14.º do RITI",
    "M40": "IVA - autoliquidação [art. 6.º n.º 6 alínea a) do CIVA]",
    "M99": "Não sujeito ou não tributado",
}

NIF_CONSUMIDOR_FINAL = "999999990"


def so_digitos(v: Any) -> str:
    return "".join(ch for ch in str(v or "") if ch.isdigit())


def nif_cliente(cliente: Optional[dict]) -> str:
    """NIF português/estrangeiro limpo; vazio = consumidor final."""
    nif = "".join(str((cliente or {}).get("nif") or "").split()).upper()
    if nif.startswith("PT"):
        nif = nif[2:]
    return "" if nif in ("", NIF_CONSUMIDOR_FINAL) else nif


def pais_iso(nome: str) -> str:
    n = (nome or "").strip().lower()
    if not n or n in ("portugal", "pt", "prt"):
        return "PT"
    tabela = {"espanha": "ES", "españa": "ES", "spain": "ES", "frança": "FR", "franca": "FR", "france": "FR",
              "alemanha": "DE", "germany": "DE", "itália": "IT", "italia": "IT", "reino unido": "GB",
              "luxemburgo": "LU", "suíça": "CH", "suica": "CH", "bélgica": "BE", "belgica": "BE",
              "países baixos": "NL", "holanda": "NL", "brasil": "BR", "angola": "AO", "moçambique": "MZ"}
    if n in tabela:
        return tabela[n]
    return n.upper() if len(n) == 2 else "PT"


def linhas_para_emitir(doc: dict) -> List[dict]:
    """Linhas com preço unitário final (sem IVA), já com descontos de linha e desconto global repartido.

    O programa de faturação recalcula os totais; aqui garantimos que a soma bate com o documento do ERP.
    """
    linhas = [l for l in (doc.get("linhas") or []) if float(l.get("quantidade") or 0) > 0]
    soma = sum(float(l.get("subtotal") or 0) for l in linhas)
    desconto = float(doc.get("desconto_total") or 0)
    fator = (soma - desconto) / soma if soma > 0 and desconto else 1.0
    out = []
    for i, l in enumerate(linhas):
        qtd = float(l.get("quantidade") or 0)
        sub = float(l.get("subtotal") or 0) * fator
        pu = round(sub / qtd, 4) if qtd else 0.0
        desc = (l.get("descricao") or "").strip() or f"Linha {i + 1}"
        out.append({"descricao": desc[:200], "quantidade": qtd, "preco_unit": pu, "subtotal": round(sub, 2)})
    return out


def isento(ctx: dict) -> bool:
    return bool(ctx.get("iva_isento"))


async def http(metodo: str, url: str, **kw) -> Any:
    """Pedido HTTP numa thread (para não bloquear o servidor). Devolve o objeto `requests.Response`."""
    import requests

    def _f():
        return requests.request(metodo, url, timeout=TIMEOUT, **kw)

    try:
        return await asyncio.to_thread(_f)
    except requests.RequestException as ex:
        raise FaturacaoErro(f"Não foi possível ligar ao programa de faturação ({ex.__class__.__name__})")


def mensagem_erro(r, prefixo: str) -> str:
    try:
        j = r.json()
    except ValueError:
        j = None
    detalhe = ""
    if isinstance(j, dict):
        for k in ("message", "error_description", "error", "detail", "errors", "msg"):
            if j.get(k):
                v = j[k]
                if isinstance(v, list):
                    v = "; ".join(
                        (x.get("detail") or x.get("message") or x.get("title") or str(x)) if isinstance(x, dict) else str(x)
                        for x in v[:3]
                    )
                elif isinstance(v, dict):
                    v = v.get("message") or v.get("description") or str(v)
                detalhe = str(v)
                break
    elif isinstance(j, list) and j:
        detalhe = "; ".join(str(x.get("description") or x.get("message") or x) if isinstance(x, dict) else str(x) for x in j[:3])
    if not detalhe:
        detalhe = (getattr(r, "text", "") or "")[:200]
    return f"{prefixo} (erro {r.status_code}){': ' + detalhe if detalhe else ''}"


GuardarParcial = Callable[[dict], Any]
