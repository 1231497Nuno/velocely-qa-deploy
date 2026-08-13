from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Literal

from app.core.database import new_id, now_iso


# ----------------------- RBAC -----------------------
RBAC_MODULES = [
    "dashboard", "clientes", "fornecedores", "encomendas", "ordens_compra", "pedidos_cotacao", "artigos", "categorias", "materiais", "maquinas", "mao_obra",
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
    for m in ("clientes", "fornecedores", "encomendas", "ordens_compra", "pedidos_cotacao", "financeiro"):
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
    codigo_origem: str = ""
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
    ativo: bool = True
    # Artigo genérico para linhas com descrição livre (código DIV-…)
    diversos: bool = False
    fabricante: str = ""
    cod_fabricante: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    cod_fornecedor: str = ""
    website: str = ""
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    espessura_mm: float = 0.0
    responsavel: str = ""
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
    ativo: bool = True
    diversos: bool = False
    fabricante: str = ""
    cod_fabricante: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    cod_fornecedor: str = ""
    website: str = ""
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    espessura_mm: float = 0.0
    responsavel: str = ""
    codigo_origem: str = ""
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
    artigo_id: str = ""
    artigo_nome: str = ""
    artigo_codigo: str = ""
    # produto | servico | descritor — só UI; PDF usa artigo_nome
    tipo_linha: Optional[str] = None
    descricao_livre: bool = False
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
    tipo: Literal["empresa", "particular"] = "empresa"
    morada: str = ""
    codigo_postal: str = ""
    cidade: str = ""
    pais: str = "Portugal"
    contacto: str = ""
    email: str = ""
    nif: str = ""
    notas: str = ""
    responsavel: str = ""

    @model_validator(mode="after")
    def _validar_nome_e_nif(self):
        nome = (self.nome or "").strip()
        if not nome:
            raise ValueError("Nome obrigatório")
        self.nome = nome
        self.morada = (self.morada or "").strip()
        self.codigo_postal = (self.codigo_postal or "").strip()
        self.cidade = (self.cidade or "").strip()
        self.pais = (self.pais or "").strip() or "Portugal"
        self.contacto = (self.contacto or "").strip()
        self.email = (self.email or "").strip()
        self.nif = "".join((self.nif or "").split())
        self.notas = (self.notas or "").strip()
        self.responsavel = (self.responsavel or "").strip()

        if self.tipo == "empresa":
            faltam = []
            if not self.nif:
                faltam.append("NIF")
            if not self.morada:
                faltam.append("morada")
            if not self.codigo_postal:
                faltam.append("código postal")
            if not self.cidade:
                faltam.append("cidade")
            if not self.contacto:
                faltam.append("contacto")
            if not self.email:
                faltam.append("email")
            if faltam:
                raise ValueError(
                    "Para empresas são obrigatórios: " + ", ".join(faltam)
                )
        return self


class Cliente(ClienteInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    codigo_origem: str = ""
    created_at: str = Field(default_factory=now_iso)


class FornecedorInput(BaseModel):
    nome: str
    tipo: Literal["empresa", "particular"] = "empresa"
    morada: str = ""
    codigo_postal: str = ""
    cidade: str = ""
    pais: str = "Portugal"
    contacto: str = ""
    email: str = ""
    nif: str = ""
    website: str = ""
    categoria: str = ""
    notas: str = ""
    responsavel: str = ""

    @model_validator(mode="after")
    def _validar_fornecedor(self):
        nome = (self.nome or "").strip()
        if not nome:
            raise ValueError("Nome obrigatório")
        self.nome = nome
        self.morada = (self.morada or "").strip()
        self.codigo_postal = (self.codigo_postal or "").strip()
        self.cidade = (self.cidade or "").strip()
        self.pais = (self.pais or "").strip() or "Portugal"
        self.contacto = (self.contacto or "").strip()
        self.email = (self.email or "").strip()
        self.nif = "".join((self.nif or "").split())
        self.website = (self.website or "").strip()
        self.categoria = (self.categoria or "").strip()
        self.notas = (self.notas or "").strip()
        self.responsavel = (self.responsavel or "").strip()

        if self.tipo == "empresa":
            faltam = []
            if not self.nif:
                faltam.append("NIF")
            if not self.morada:
                faltam.append("morada")
            if not self.codigo_postal:
                faltam.append("código postal")
            if not self.cidade:
                faltam.append("cidade")
            if not self.contacto:
                faltam.append("contacto")
            if not self.email:
                faltam.append("email")
            if faltam:
                raise ValueError(
                    "Para empresas são obrigatórios: " + ", ".join(faltam)
                )
        return self


class Fornecedor(FornecedorInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    codigo_origem: str = ""
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Ordens de compra / despesas -----------------------
# compra = matéria-prima/stock para vender; despesa_normal = operacional;
# despesa_diversa = extraordinário (hotéis, anúncios, portes…)
TIPO_DESPESA_PT = {
    "compra": "Compra",
    "despesa_normal": "Despesa",
    "despesa_diversa": "Despesa diversa",
}
TIPO_DESPESA_DESC = {
    "compra": "Matéria-prima e stock para vender ou transformar",
    "despesa_normal": "Custos operacionais (água, luz, telecom, gasóleo, renda…)",
    "despesa_diversa": "Extras pontuais (hotéis, anúncios, rifas, portes…)",
}
OC_ESTADO_PT = {
    "criada": "Criada",
    "recebida": "Recebida",
    "cancelada": "Cancelada",
}


class OrdemCompraLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = ""
    quantidade: float = 1.0
    preco_unit: float = 0.0
    desconto: float = 0.0
    comentario: str = ""
    artigo_id: Optional[str] = None
    artigo_nome: str = ""


class OrdemCompraInput(BaseModel):
    assunto: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    tipo_compra: str = ""  # Consumiveis | Produtos | Outros | Manutenção | Portes (CRM)
    tipo_despesa: Literal["compra", "despesa_normal", "despesa_diversa"] = "despesa_diversa"
    estado: Literal["criada", "recebida", "cancelada"] = "criada"
    data: str = ""
    vencimento: str = ""
    data_pagamento: str = ""
    subtotal: float = 0.0
    total: float = 0.0
    valor_pago: float = 0.0
    desconto_percentual: float = 0.0
    valor_desconto: float = 0.0
    valor_taxa: float = 0.0
    moeda: str = "EUR"
    responsavel: str = ""
    tipologia: str = ""
    transportadora: str = ""
    notas: str = ""
    linhas: List[OrdemCompraLinha] = Field(default_factory=list)


class OrdemCompra(OrdemCompraInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    codigo_origem: str = ""
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Pedidos de cotação (RFQ) -----------------------
PC_ESTADO_PT = {
    "rascunho": "Rascunho",
    "enviado": "Enviado",
    "respondido": "Respondido",
    "cancelado": "Cancelado",
    "adjudicado": "Adjudicado",
}


class PedidoCotacaoLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = ""
    quantidade: float = 1.0
    unidade: str = "un"
    notas: str = ""
    artigo_id: Optional[str] = None
    artigo_nome: str = ""
    preco_unit_cotado: Optional[float] = None


class PedidoCotacaoInput(BaseModel):
    assunto: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    estado: Literal["rascunho", "enviado", "respondido", "cancelado", "adjudicado"] = "rascunho"
    data: str = ""
    prazo_resposta: str = ""
    valor_cotado: Optional[float] = None
    moeda: str = "EUR"
    responsavel: str = ""
    notas: str = ""
    linhas: List[PedidoCotacaoLinha] = Field(default_factory=list)
    ordem_compra_id: Optional[str] = None
    ordem_compra_codigo: str = ""


class PedidoCotacao(PedidoCotacaoInput):
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
