"""Modelos do CRM — estados configuráveis do funil e leads (oportunidades).

Os estados (colunas do kanban) são definidos por cada empresa: nome, cor,
ordem e tipo (aberto / ganho / perdido). Os leads guardam o contacto, a
origem, o valor estimado, as interações e a ligação a cliente e orçamentos.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.database import new_id, now_iso

EstadoTipo = Literal["aberto", "ganho", "perdido"]

# Paleta disponível para os estados (hex). O frontend mostra as mesmas cores.
CORES_ESTADO = [
    "#64748b",  # cinza
    "#2563eb",  # azul
    "#0891b2",  # ciano
    "#7c3aed",  # violeta
    "#d97706",  # âmbar
    "#ea580c",  # laranja
    "#16a34a",  # verde
    "#dc2626",  # vermelho
    "#0f172a",  # preto
]

ESTADOS_DEFAULT = [
    {"nome": "Novo", "cor": "#2563eb", "tipo": "aberto"},
    {"nome": "Em contacto", "cor": "#d97706", "tipo": "aberto"},
    {"nome": "Orçamento enviado", "cor": "#7c3aed", "tipo": "aberto"},
    {"nome": "Ganho", "cor": "#16a34a", "tipo": "ganho"},
    {"nome": "Perdido", "cor": "#dc2626", "tipo": "perdido"},
]

ORIGENS_SUGERIDAS = [
    "Instagram", "Facebook", "WhatsApp", "Email", "Site", "Loja",
    "Telefone", "Recomendação", "Feira / Evento", "Outro",
]

TipoInteracao = Literal["nota", "chamada", "email", "mensagem", "reuniao", "visita", "sistema"]


def _hex(cor: str) -> str:
    cor = (cor or "").strip()
    if len(cor) == 7 and cor.startswith("#"):
        try:
            int(cor[1:], 16)
            return cor.lower()
        except ValueError:
            pass
    return CORES_ESTADO[0]


class EstadoInput(BaseModel):
    nome: str
    cor: str = CORES_ESTADO[0]
    tipo: EstadoTipo = "aberto"

    @model_validator(mode="after")
    def _limpar(self):
        self.nome = (self.nome or "").strip()
        if not self.nome:
            raise ValueError("Nome do estado obrigatório")
        if len(self.nome) > 60:
            raise ValueError("Nome do estado demasiado longo (máx. 60)")
        self.cor = _hex(self.cor)
        return self


class Estado(EstadoInput):
    id: str = Field(default_factory=new_id)
    ordem: int = 0
    created_at: str = Field(default_factory=now_iso)


class OrdemEstadosInput(BaseModel):
    ids: List[str]


class LeadInput(BaseModel):
    nome: str = ""            # pessoa de contacto
    empresa: str = ""         # empresa (vazio = particular)
    telefone: str = ""
    email: str = ""
    origem: str = ""
    descricao: str = ""       # o que pretende
    valor_estimado: Optional[float] = None
    estado_id: Optional[str] = None
    responsavel_id: Optional[str] = None
    proxima_acao_at: Optional[str] = None
    proxima_acao_nota: str = ""
    motivo_perda: str = ""

    @field_validator("valor_estimado", mode="before")
    @classmethod
    def _valor(cls, v):
        if v in (None, ""):
            return None
        try:
            return max(0.0, float(v))
        except (TypeError, ValueError):
            return None

    @model_validator(mode="after")
    def _limpar(self):
        for campo in ("nome", "empresa", "telefone", "email", "origem",
                      "descricao", "proxima_acao_nota", "motivo_perda"):
            setattr(self, campo, (getattr(self, campo) or "").strip())
        if not self.nome and not self.empresa:
            raise ValueError("Indique o nome do contacto ou da empresa")
        self.proxima_acao_at = (self.proxima_acao_at or "").strip() or None
        self.responsavel_id = (self.responsavel_id or "").strip() or None
        self.estado_id = (self.estado_id or "").strip() or None
        return self


class MoverLeadInput(BaseModel):
    estado_id: str
    antes_de_id: Optional[str] = None  # colocar antes deste lead (None = no fim)


class InteracaoInput(BaseModel):
    tipo: TipoInteracao = "nota"
    texto: str
    at: Optional[str] = None

    @model_validator(mode="after")
    def _limpar(self):
        self.texto = (self.texto or "").strip()
        if not self.texto:
            raise ValueError("Escreva o conteúdo da interação")
        if self.tipo == "sistema":
            self.tipo = "nota"
        return self


class ConverterLeadInput(BaseModel):
    """Associar a cliente existente (cliente_id) OU criar um novo (cliente)."""
    cliente_id: Optional[str] = None
    cliente: Optional[dict] = None  # payload ClienteInput


class LigarOrcamentoInput(BaseModel):
    orcamento_id: str
