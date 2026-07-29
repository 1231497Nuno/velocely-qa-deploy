from pydantic import BaseModel, Field
from typing import List, Optional

from app.core.database import new_id, now_iso


# ----------------------- RBAC -----------------------
RBAC_MODULES = [
    "dashboard", "clientes", "encomendas", "artigos", "categorias", "materiais", "maquinas", "mao_obra",
    "personalizacao", "orcamentos", "ordens_fabrico", "analise_producao", "rentabilidade",
    "financeiro", "calendario", "historico", "definicoes", "utilizadores",
]
RBAC_ACTIONS = ["view", "create", "edit", "delete"]


def perms_all(value: bool) -> dict:
    return {m: {a: value for a in RBAC_ACTIONS} for m in RBAC_MODULES}


def perms_colaborador() -> dict:
    p = perms_all(False)
    for m in RBAC_MODULES:
        if m not in ("utilizadores", "definicoes", "historico"):
            p[m]["view"] = True
    for m in ("orcamentos", "ordens_fabrico"):
        p[m]["create"] = True
        p[m]["edit"] = True
    for m in ("clientes", "encomendas", "financeiro"):
        p[m]["create"] = True
        p[m]["edit"] = True
    return p


# ----------------------- Auth models -----------------------
class LoginInput(BaseModel):
    login: Optional[str] = None
    email: Optional[str] = None
    password: str = ""  # password normal OU código de convite (primeira ativação)


class SetPasswordInput(BaseModel):
    password: str
    password_confirm: str = ""


class ProfileUpdate(BaseModel):
    login: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    telefone: Optional[str] = None
    avatar: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    login: Optional[str] = None
    email: Optional[str] = None


class PasswordCodeVerify(BaseModel):
    code: str
    login: Optional[str] = None
    email: Optional[str] = None


class PasswordResetSet(BaseModel):
    reset_token: str
    password: str
    password_confirm: str = ""


class UserCreate(BaseModel):
    login: Optional[str] = None
    email: str = ""
    name: str = ""
    cargo: str = ""
    password: Optional[str] = None  # se omitido → gera código de convite
    perfil_id: Optional[str] = None
    role: str = "colaborador"


class UserUpdate(BaseModel):
    login: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    password: Optional[str] = None
    perfil_id: Optional[str] = None
    role: Optional[str] = None


class PerfilInput(BaseModel):
    nome: str
    admin: bool = False
    permissoes: dict = Field(default_factory=lambda: perms_all(False))


# ----------------------- Domain models -----------------------
class Maquina(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class MaquinaInput(BaseModel):
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0


class Consumivel(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    unidade: str = "un"
    custo_unitario: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class ConsumivelInput(BaseModel):
    nome: str
    unidade: str = "un"
    custo_unitario: float = 0.0


class MaoObra(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    custo_hora: float = 0.0
    responsavel_personalizacoes: bool = False
    created_at: str = Field(default_factory=now_iso)


class MaoObraInput(BaseModel):
    nome: str
    custo_hora: float = 0.0
    responsavel_personalizacoes: bool = False


class ArtigoMaterial(BaseModel):
    id: str = Field(default_factory=new_id)
    material_id: str
    material_nome: str = ""
    unidade: str = ""
    quantidade: float = 0.0
    custo_unitario: float = 0.0


class Operacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = ""
    maquina_id: Optional[str] = None
    maquina_nome: Optional[str] = None
    tempo_maquina: float = 0.0
    tempo_maquina_unidade: str = "min"
    mao_obra_id: Optional[str] = None
    mao_obra_nome: Optional[str] = None
    tempo_mao_obra: float = 0.0
    tempo_mao_obra_unidade: str = "min"


class Artigo(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    descricao: str = ""
    unidade: str = "un"
    imagem: str = ""
    categoria_id: Optional[str] = None
    categoria_nome: str = ""
    subcategoria_id: Optional[str] = None
    subcategoria_nome: str = ""
    custo_artigo: float = 0.0
    margem: float = 30.0
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class ArtigoInput(BaseModel):
    nome: str
    descricao: str = ""
    unidade: str = "un"
    imagem: str = ""
    categoria_id: Optional[str] = None
    categoria_nome: str = ""
    subcategoria_id: Optional[str] = None
    subcategoria_nome: str = ""
    custo_artigo: float = 0.0
    margem: float = 30.0
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)


class CategoriaInput(BaseModel):
    nome: str


class Categoria(CategoriaInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    created_at: str = Field(default_factory=now_iso)


class SubcategoriaInput(BaseModel):
    nome: str
    categoria_id: str


class Subcategoria(SubcategoriaInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    categoria_nome: str = ""
    created_at: str = Field(default_factory=now_iso)


class TipoPersonalizacao(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    descricao: str = ""
    valor: float = 0.0
    tempo: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class TipoPersonalizacaoInput(BaseModel):
    nome: str
    descricao: str = ""
    valor: float = 0.0
    tempo: float = 0.0


class PersonalizacaoSel(BaseModel):
    id: Optional[str] = None
    nome: str = ""
    valor: float = 0.0
    tempo: float = 0.0


class OrcamentoLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    imagem: str = ""
    quantidade: float = 1
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    valor_personalizacao: float = 0.0
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    custo_base_unit: Optional[float] = None
    margem: Optional[float] = None
    roteiro: List[Operacao] = Field(default_factory=list)
    custo_producao_unit: float = 0.0
    preco_unit: float = 0.0
    preco_unit_manual: bool = False
    desconto: float = 0.0
    desconto_tipo: str = "pct"  # pct | eur


class MaterialLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    consumivel_id: Optional[str] = None
    nome: str = ""
    unidade: str = "un"
    custo_unitario: float = 0.0
    quantidade: float = 1
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    margem: float = 50.0
    custo: float = 0.0
    valor: float = 0.0


class ClienteInput(BaseModel):
    nome: str
    morada: str = ""
    codigo_postal: str = ""
    cidade: str = ""
    pais: str = "Portugal"
    contacto: str = ""
    email: str = ""
    nif: str = ""
    notas: str = ""


class Cliente(ClienteInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    created_at: str = Field(default_factory=now_iso)


class OrcamentoInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    validade: Optional[str] = None
    status: str = "rascunho"
    margem: float = 0.0
    notas: str = ""
    desconto_total: float = 0.0
    desconto_total_tipo: str = "pct"  # pct | eur
    linhas: List[OrcamentoLinha] = Field(default_factory=list)
    materiais: List[MaterialLinha] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)


class Orcamento(OrcamentoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    of_id: Optional[str] = None
    of_numero: Optional[str] = None
    encomenda_id: Optional[str] = None
    encomenda_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class OFOperacao(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str
    maquina_id: Optional[str] = None
    maquina_nome: Optional[str] = None
    mao_obra_id: Optional[str] = None
    mao_obra_nome: Optional[str] = None
    tempo_maquina: float = 0.0
    tempo_maquina_base: Optional[float] = None  # tempo de máquina por unidade
    tempo_mao_obra: float = 0.0
    tempo_mao_obra_base: Optional[float] = None  # mão de obra do roteiro (por unidade), sem personalizações
    tempo_min: float = 0.0
    custo_estimado: float = 0.0
    custo_maquina_estimado: float = 0.0
    custo_mao_obra_estimado: float = 0.0
    maquina_custo_hora: float = 0.0
    mao_obra_custo_hora: float = 0.0
    timer_inicio: Optional[str] = None
    tempo_real_seg: float = 0.0
    concluida: bool = False
    manual: bool = False
    nota: str = ""


class OFItem(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    imagem: str = ""
    quantidade: float = 1
    unidade: str = "un"
    preco_unit: float = 0.0
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    operacoes: List[OFOperacao] = Field(default_factory=list)


class OrdemFabricoInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    encomenda_id: Optional[str] = None
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    status: str = "pendente"
    notas: str = ""
    prioritaria: bool = False
    responsavel_id: Optional[str] = None
    responsavel_nome: str = ""
    itens: List[OFItem] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)


class OrdemFabrico(OrdemFabricoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    encomenda_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class EncomendaArtigo(BaseModel):
    id: str = Field(default_factory=new_id)
    artigo_id: Optional[str] = None
    artigo_nome: str = ""
    imagem: str = ""
    quantidade: float = 1
    preco_unit: float = 0.0
    desconto: float = 0.0
    desconto_tipo: str = "pct"  # pct | eur
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)


class Pagamento(BaseModel):
    id: str = Field(default_factory=new_id)
    recibo_numero: str = ""
    data: Optional[str] = None
    valor: float = 0.0
    metodo: str = "transferencia"  # transferencia | numerario | mbway | cheque | cartao | outro
    nota: str = ""
    created_at: str = Field(default_factory=now_iso)


class EncomendaInput(BaseModel):
    cliente: str
    cliente_id: Optional[str] = None
    descricao: str = ""
    data: Optional[str] = None
    prazo_entrega: Optional[str] = None
    estado: str = "aberta"
    notas: str = ""
    desconto_total: float = 0.0
    desconto_total_tipo: str = "pct"  # pct | eur
    artigos: List[EncomendaArtigo] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)
    pagamentos: List[Pagamento] = Field(default_factory=list)
    valor_total: Optional[float] = None
    valor_total_manual: bool = False
    valor_pago: float = 0.0
    autorizada_producao: bool = False


class Encomenda(EncomendaInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


DOC_TIPOS = ("fatura", "proforma", "recibo", "fatura_recibo")
DOC_TIPOS_PRINCIPAIS = ("fatura", "proforma", "fatura_recibo")  # listáveis no financeiro (recibos vivem na fatura)
DOC_TIPOS_COM_RECIBOS = ("fatura", "fatura_recibo")  # podem ter recibos associados


class DocumentoLinha(BaseModel):
    artigo_id: Optional[str] = None
    encomenda_artigo_id: Optional[str] = None  # linha da encomenda de origem (faturação parcial)
    descricao: str = ""
    quantidade: float = 1
    preco_unit: float = 0.0
    desconto: float = 0.0
    desconto_tipo: str = "pct"
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    subtotal: float = 0.0


class DocumentoFinanceiroInput(BaseModel):
    tipo: str  # fatura | proforma | recibo | fatura_recibo
    cliente: str = ""
    cliente_id: Optional[str] = None
    encomenda_id: Optional[str] = None
    encomenda_numero: Optional[str] = None
    fatura_id: Optional[str] = None  # recibo → fatura mãe
    fatura_numero: Optional[str] = None
    data: Optional[str] = None
    linhas: List[DocumentoLinha] = Field(default_factory=list)
    subtotal: float = 0.0
    desconto_total: float = 0.0
    iva_taxa: float = 0.0
    iva_valor: float = 0.0
    total: float = 0.0
    valor_pago: float = 0.0
    metodo_pagamento: str = ""
    notas: str = ""
    estado: str = "emitida"  # emitida | anulada


class DocumentoFinanceiro(DocumentoFinanceiroInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    created_at: str = Field(default_factory=now_iso)


class EmpresaSettings(BaseModel):
    nome: str = "Gestão Produção"
    morada: str = ""
    codigo_postal: str = ""
    cidade: str = ""
    pais: str = ""
    nif: str = ""
    telefone: str = ""
    email: str = ""
    website: str = ""
    logo_base64: str = ""
    login_bg_base64: str = ""
    rodape: str = ""
    moeda_simbolo: str = "€"
    iva_taxa: float = 23.0
    iva_isento: bool = False
    condicoes_pagamento: str = ""


class PdfTemplateInput(BaseModel):
    nome: str
    modulo: str
    finalidade: str = "ambos"
    mostrar_branding: bool = True
    campos: dict = Field(default_factory=dict)


class PdfTemplate(PdfTemplateInput):
    id: str = Field(default_factory=new_id)
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Constantes de apresentação -----------------------
STATUS_PT = {
    "rascunho": "Rascunho", "enviado": "Enviado", "aceite": "Aceite", "rejeitado": "Rejeitado",
    "pendente": "Pendente", "em_producao": "Em Produção", "concluido": "Concluído",
}
PAY_PT = {"pendente": "Pendente", "parcial": "Pago parcial", "pago": "Pago total"}
ENC_ESTADO_PT = {"aberta": "Aberta", "em_producao": "Em Produção", "concluida": "Concluída", "cancelada": "Cancelada"}
DOC_TIPO_PT = {
    "fatura": "Fatura",
    "proforma": "Fatura Pro Forma",
    "recibo": "Recibo",
    "fatura_recibo": "Fatura-Recibo",
}
DOC_ESTADO_PT = {"emitida": "Emitida", "anulada": "Anulada"}

_CLIENTE_CAMPOS = [
    {"key": "cliente_nome", "label": "Nome"},
    {"key": "cliente_nif", "label": "NIF"},
    {"key": "cliente_morada", "label": "Morada"},
    {"key": "cliente_codigo_postal", "label": "Código postal"},
    {"key": "cliente_cidade", "label": "Cidade"},
    {"key": "cliente_pais", "label": "País"},
    {"key": "cliente_telefone", "label": "Telefone"},
    {"key": "cliente_email", "label": "Email"},
]
PDF_SECOES = {
    "orcamento": [
        {"key": "dados_cliente", "label": "Dados do cliente", "campos": _CLIENTE_CAMPOS},
        {"key": "datas_estado", "label": "Datas e estado"},
        {"key": "linhas_artigos", "label": "Linhas de artigos"},
        {"key": "personalizacoes", "label": "Personalizações"},
        {"key": "materiais", "label": "Materiais / consumíveis"},
        {"key": "totais", "label": "Totais e preço final"},
        {"key": "notas", "label": "Notas"},
    ],
    "of": [
        {"key": "dados_cliente", "label": "Dados do cliente", "campos": _CLIENTE_CAMPOS},
        {"key": "datas_estado", "label": "Datas, estado e progresso"},
        {"key": "orcamento_origem", "label": "Dados do orçamento de origem"},
        {"key": "roteiro_operacoes", "label": "Roteiro de operações"},
        {"key": "tempos", "label": "Tempos (máquina/mão de obra)"},
        {"key": "notas", "label": "Notas"},
    ],
    "encomenda": [
        {"key": "dados_cliente", "label": "Dados do cliente", "campos": _CLIENTE_CAMPOS},
        {"key": "orcamento_origem", "label": "Dados do orçamento de origem"},
        {"key": "artigos", "label": "Lista de artigos"},
        {"key": "valor_total", "label": "Valor total"},
        {"key": "pagamento", "label": "Estado de pagamento"},
        {"key": "ofs_associadas", "label": "OFs associadas e estado"},
        {"key": "notas", "label": "Notas / descrição"},
    ],
}
