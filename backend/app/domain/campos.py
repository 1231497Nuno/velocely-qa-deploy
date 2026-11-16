"""Configuração de campos por módulo (Definições → Campos).

Para cada módulo a empresa pode:
  · tornar obrigatórios campos que o ERP já tem;
  · criar campos personalizados (texto, número, data, lista, sim/não…),
    guardados em `campos_extra` de cada registo;
  · definir cores para as linhas das listagens, por estado ou pelas opções
    de um campo personalizado do tipo lista.
"""
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

TipoCampo = Literal["texto", "texto_longo", "numero", "data", "lista", "sim_nao"]

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

# Quando é validado: "sempre" = criar e guardar; "guardar" = só ao guardar
# (documentos que nascem como rascunho vazio); "finalizar" = só ao finalizar.
MODULOS_CAMPOS: Dict[str, Dict[str, Any]] = {
    "clientes": {
        "label": "Clientes", "validar": "sempre",
        "campos": [("email", "Email"), ("contacto", "Telefone"), ("nif", "NIF"), ("morada", "Morada"),
                   ("codigo_postal", "Código postal"), ("cidade", "Cidade"), ("responsavel", "Pessoa responsável"),
                   ("condicoes_pagamento", "Condições de pagamento"), ("notas", "Notas")],
        "estado": None,
    },
    "fornecedores": {
        "label": "Fornecedores", "validar": "sempre",
        "campos": [("email", "Email"), ("contacto", "Telefone"), ("nif", "NIF"), ("morada", "Morada"),
                   ("codigo_postal", "Código postal"), ("cidade", "Cidade"), ("website", "Website"),
                   ("categoria", "Categoria"), ("responsavel", "Pessoa responsável"), ("notas", "Notas")],
        "estado": None,
    },
    "artigos": {
        "label": "Artigos", "validar": "sempre",
        "campos": [("descricao", "Descrição"), ("categoria_id", "Categoria"), ("subcategoria_id", "Subcategoria"),
                   ("fornecedor_id", "Fornecedor"), ("cod_fornecedor", "Código do fornecedor"),
                   ("fabricante", "Fabricante"), ("codigo_produto", "Código de barras / produto"),
                   ("imagem", "Imagem"), ("responsavel", "Responsável")],
        "estado": None,
    },
    "orcamentos": {
        "label": "Orçamentos", "validar": "finalizar",
        "campos": [("cliente_id", "Cliente"), ("contacto_id", "À atenção de"), ("descricao", "Descrição"),
                   ("numero_encomenda", "Referência do cliente"), ("validade", "Validade"), ("notas", "Notas")],
        "estado": {"campo": "status", "valores": [
            ("rascunho", "Rascunho"), ("finalizado", "Criado"), ("enviado", "Enviado"),
            ("negociado", "Negociação"), ("aceite", "Ganho"), ("rejeitado", "Perdido")]},
    },
    "encomendas": {
        "label": "Encomendas", "validar": "sempre",
        "campos": [("cliente_id", "Cliente"), ("contacto_id", "À atenção de"), ("descricao", "Descrição"),
                   ("referencia_cliente", "Referência do cliente"), ("prazo_entrega", "Prazo de entrega"),
                   ("notas", "Notas")],
        "estado": {"campo": "estado", "valores": [
            ("aberta", "Aberta"), ("em_producao", "Em produção"), ("concluida", "Concluída"),
            ("entregue", "Entregue"), ("cancelada", "Cancelada")]},
    },
    "ordens_fabrico": {
        "label": "Ordens de Fabrico", "validar": "guardar",
        "campos": [("cliente_id", "Cliente"), ("descricao", "Descrição"), ("prazo_entrega", "Prazo de entrega"),
                   ("responsavel_id", "Responsável"), ("notas", "Notas")],
        "estado": {"campo": "status", "valores": [
            ("pendente", "Pendente"), ("em_producao", "Em produção"), ("concluido", "Concluído")]},
    },
    "ordens_compra": {
        "label": "Ordens de Compra", "validar": "guardar",
        "campos": [("fornecedor_id", "Fornecedor"), ("assunto", "Assunto"), ("tipo_compra", "Tipo de compra"),
                   ("vencimento", "Vencimento"), ("responsavel", "Responsável"), ("transportadora", "Transportadora"),
                   ("notas", "Notas")],
        "estado": {"campo": "estado", "valores": [
            ("criada", "Criada"), ("recebida", "Recebida"), ("cancelada", "Cancelada")]},
    },
    "pedidos_cotacao": {
        "label": "Pedidos de Cotação", "validar": "guardar",
        "campos": [("fornecedor_id", "Fornecedor"), ("assunto", "Assunto"), ("prazo_resposta", "Prazo de resposta"),
                   ("responsavel", "Responsável"), ("notas", "Notas")],
        "estado": {"campo": "estado", "valores": [
            ("rascunho", "Rascunho"), ("enviado", "Enviado"), ("respondido", "Respondido"),
            ("adjudicado", "Adjudicado"), ("cancelado", "Cancelado")]},
    },
    "contas": {
        "label": "Contas a pagar / receber", "validar": "sempre",
        "campos": [("entidade", "Entidade"), ("descricao", "Descrição"), ("referencia", "Referência"),
                   ("vencimento", "Vencimento"), ("metodo", "Método de pagamento"), ("notas", "Notas")],
        "estado": {"campo": "estado", "valores": [
            ("pendente", "Pendente"), ("parcial", "Parcial"), ("liquidada", "Liquidada"), ("anulada", "Anulada")]},
    },
    "nao_conformidades": {
        "label": "Não conformidades", "validar": "guardar",
        "campos": [("tipo", "Tipo"), ("descricao", "Descrição"), ("acao_corretiva", "Ação corretiva"), ("notas", "Notas")],
        "estado": {"campo": "estado", "valores": [
            ("aberta", "Aberta"), ("em_analise", "Em análise"), ("fechada", "Fechada")]},
    },
    "crm": {
        "label": "CRM / Leads", "validar": "sempre",
        "campos": [("empresa", "Empresa"), ("nome", "Pessoa de contacto"), ("telefone", "Telefone"),
                   ("email", "Email"), ("origem", "Origem"), ("descricao", "O que pretende"),
                   ("valor_estimado", "Valor estimado"), ("responsavel_id", "Responsável"),
                   ("proxima_acao_at", "Próxima ação")],
        # Os estados do CRM já têm cor própria (Estados do funil)
        "estado": None,
    },
}

MODULOS_KEYS = list(MODULOS_CAMPOS.keys())


def _slug(texto: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:40] or "campo"


def _cor(v: Optional[str]) -> str:
    v = (v or "").strip()
    return v.lower() if _HEX.match(v) else ""


class OpcaoLista(BaseModel):
    valor: str
    cor: str = ""

    @model_validator(mode="after")
    def _limpar(self):
        self.valor = (self.valor or "").strip()
        self.cor = _cor(self.cor)
        return self


class CampoExtra(BaseModel):
    key: str = ""
    label: str
    tipo: TipoCampo = "texto"
    opcoes: List[OpcaoLista] = Field(default_factory=list)
    obrigatorio: bool = False
    ajuda: str = ""
    mostrar_na_lista: bool = False
    ativo: bool = True

    @field_validator("opcoes", mode="before")
    @classmethod
    def _opcoes(cls, v):
        # aceita ["A", "B"] ou [{"valor": "A", "cor": "#..."}]
        out = []
        for o in v or []:
            out.append({"valor": o} if isinstance(o, str) else o)
        return out

    @model_validator(mode="after")
    def _limpar(self):
        self.label = (self.label or "").strip()
        if not self.label:
            raise ValueError("Cada campo personalizado precisa de um nome")
        self.key = _slug(self.key or self.label)
        self.ajuda = (self.ajuda or "").strip()
        vistos = set()
        opcoes = []
        for o in self.opcoes:
            if o.valor and o.valor.lower() not in vistos:
                vistos.add(o.valor.lower())
                opcoes.append(o)
        self.opcoes = opcoes
        if self.tipo == "lista" and not self.opcoes:
            raise ValueError(f"O campo «{self.label}» é uma lista: indique pelo menos uma opção")
        if self.tipo != "lista":
            self.opcoes = []
        return self


class CoresLinhas(BaseModel):
    """Cor das linhas nas listagens: por estado ou por um campo personalizado do tipo lista."""
    campo: str = ""                       # "" (sem cores) | "estado" | "extra:<key>"
    mapa: Dict[str, str] = Field(default_factory=dict)   # valor → cor (só para "estado")

    @model_validator(mode="after")
    def _limpar(self):
        self.campo = (self.campo or "").strip()
        self.mapa = {k: _cor(v) for k, v in (self.mapa or {}).items() if _cor(v)}
        return self


class CamposConfigInput(BaseModel):
    obrigatorios: List[str] = Field(default_factory=list)
    extras: List[CampoExtra] = Field(default_factory=list)
    cores_linhas: CoresLinhas = Field(default_factory=CoresLinhas)

    @model_validator(mode="after")
    def _unicos(self):
        keys = set()
        for c in self.extras:
            base = c.key
            i = 2
            while c.key in keys:
                c.key = f"{base}_{i}"
                i += 1
            keys.add(c.key)
        return self
