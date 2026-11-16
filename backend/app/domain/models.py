from pydantic import BaseModel, Field, model_validator, field_validator
from typing import Any, List, Optional, Literal

from app.core.database import new_id, now_iso
from app.domain.modules import MODULE_KEYS


# ----------------------- RBAC -----------------------
RBAC_MODULES = list(MODULE_KEYS)
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
    for m in ("clientes", "fornecedores", "encomendas", "ordens_compra", "pedidos_cotacao", "financeiro", "nao_conformidades", "contas", "crm"):
        p[m]["create"] = True
        p[m]["edit"] = True
    return p


# ----------------------- Auth models -----------------------
class LoginInput(BaseModel):
    login: Optional[str] = None
    email: Optional[str] = None
    password: str = ""  # password normal OU código de convite (primeira ativação)
    codigo_2fa: Optional[str] = None  # código da app autenticadora (se a verificação em dois passos estiver ativa)


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


MODULOS_SO_PROPRIOS = ("crm", "orcamentos", "encomendas")


class PerfilInput(BaseModel):
    nome: str
    admin: bool = False
    permissoes: dict = Field(default_factory=lambda: perms_all(False))
    # Restrições (Definições → Utilizadores → Perfis), como no Sage X3:
    ver_custos: bool = True              # custos, margens e lucros (fichas e relatórios)
    so_proprios: List[str] = Field(default_factory=list)  # módulos onde só vê o que criou / é responsável
    pagina_inicial: str = ""             # ex.: /ordens-fabrico para a produção
    # App móvel: operações permitidas (None = segue as permissões dos módulos)
    app_movel: Optional[List[str]] = None
    # Menu lateral e painel predefinidos do perfil (o utilizador pode personalizar por cima)
    menu: Optional[dict] = None
    painel_ocultos: Optional[List[str]] = None
    painel_ordem: Optional[List[str]] = None


# Operações da app móvel (Definições → Utilizadores → Perfis → App móvel)
APP_MOVEL_OPS = {
    "rececoes": "Receções",
    "inventario": "Inventário",
    "localizacoes": "Localizações",
    "transferir": "Transferir",
    "movimento": "Entrada / saída",
    "acertar": "Acertar stock",
    "stock_baixo": "Stock baixo",
    "movimentos": "Movimentos",
    "consultar": "Consultar stock",
    "oficina": "Oficina",
    "picking": "Separar material (OF)",
}


# ----------------------- Domain models -----------------------
class Maquina(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0
    # Capacidade (horas disponíveis por semana) — carga vs capacidade
    horas_semana: float = 40.0
    created_at: str = Field(default_factory=now_iso)


class MaquinaInput(BaseModel):
    nome: str
    custo_amortizacao_hora: float = 0.0
    custo_energia_hora: float = 0.0
    horas_semana: float = 40.0


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


class Anexo(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = ""
    path: str = ""
    content_type: str = ""
    size: int = 0
    created_at: str = Field(default_factory=now_iso)


class ArtigoMaterialMedida(BaseModel):
    """Um consumo/medida dentro da mesma matéria-prima na receita (ex.: vários cortes)."""
    id: str = Field(default_factory=new_id)
    quantidade: float = 0.0  # na un. do material, ou nº de peças se L×A preenchidos
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0


class ArtigoMaterial(BaseModel):
    id: str = Field(default_factory=new_id)
    material_id: str  # artigo (consumível/matéria-prima) — legado: pode ser consumivel_id
    material_nome: str = ""
    unidade: str = ""  # herdada do artigo componente (não editar livremente na receita)
    # Legado (linha única): usados se `medidas` estiver vazio
    quantidade: float = 0.0  # na unidade do material (ex.: m², kg, un)
    custo_unitario: float = 0.0  # € por unidade do material
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    # Vários consumos do mesmo material (cortes/áreas diferentes)
    medidas: List[ArtigoMaterialMedida] = Field(default_factory=list)


# Tipo de artigo — define campos e regras de utilização.
# «Produzido» não é tipo: é o flag `produzido` no Ativo (receita + operações).
TIPO_ARTIGO_ATIVO = "ativo"
TIPO_ARTIGO_MATERIA_PRIMA = "materia_prima"
TIPO_ARTIGO_CONSUMIVEL = "consumivel"
TIPO_ARTIGO_SERVICO = "servico"
TIPO_ARTIGO_NAO_UTILIZADO = "nao_utilizado"
TIPO_ARTIGO_INATIVO = "inativo"
# Legado (aceite no input e normalizado para ativo + produzido=True)
TIPO_ARTIGO_PRODUZIDO_LEGADO = "produzido"
TIPOS_ARTIGO = (
    TIPO_ARTIGO_ATIVO,
    TIPO_ARTIGO_MATERIA_PRIMA,
    TIPO_ARTIGO_CONSUMIVEL,
    TIPO_ARTIGO_SERVICO,
    TIPO_ARTIGO_NAO_UTILIZADO,
    TIPO_ARTIGO_INATIVO,
)
TIPOS_ARTIGO_INPUT = TIPOS_ARTIGO + (TIPO_ARTIGO_PRODUZIDO_LEGADO,)
# Componentes usáveis nas receitas (ex-separador Materiais)
TIPOS_MATERIA_PRIMA = (TIPO_ARTIGO_MATERIA_PRIMA, TIPO_ARTIGO_CONSUMIVEL)
TIPO_ARTIGO_PT = {
    TIPO_ARTIGO_ATIVO: "Ativo",
    TIPO_ARTIGO_MATERIA_PRIMA: "Matéria Prima",
    TIPO_ARTIGO_CONSUMIVEL: "Consumível",
    TIPO_ARTIGO_SERVICO: "Serviço",
    TIPO_ARTIGO_NAO_UTILIZADO: "Não utilizado",
    TIPO_ARTIGO_INATIVO: "Inativo",
}
TIPO_ARTIGO_DESC = {
    TIPO_ARTIGO_ATIVO: "Artigo de venda — opcionalmente produzido (receita e operações)",
    TIPO_ARTIGO_MATERIA_PRIMA: "Componente / matéria-prima usado nas receitas dos artigos produzidos",
    TIPO_ARTIGO_CONSUMIVEL: "Artigo consumido na produção / operações",
    TIPO_ARTIGO_SERVICO: "Sem stock nem produção",
    TIPO_ARTIGO_NAO_UTILIZADO: "Pode usar em operações futuras, com confirmação",
    TIPO_ARTIGO_INATIVO: "Não pode voltar a ser utilizado em operações futuras",
}


class Artigo(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    codigo_origem: str = ""
    nome: str
    descricao: str = ""
    unidade: str = "un"
    imagem: str = ""
    anexos: List[Anexo] = Field(default_factory=list)
    categoria_id: Optional[str] = None
    categoria_nome: str = ""
    subcategoria_id: Optional[str] = None
    subcategoria_nome: str = ""
    tipo_artigo: str = TIPO_ARTIGO_ATIVO
    # Ativo com produção: receita (materiais) + operações
    produzido: bool = False
    custo_artigo: float = 0.0
    # Preço pago pela placa/folha (MP). Com L×A → deriva custo_artigo em €/m².
    preco_compra: float = 0.0
    margem: float = 30.0
    comissao_pct: float = 0.0
    ativo: bool = True
    # Artigo genérico para linhas com descrição livre (código DIV-…)
    diversos: bool = False
    fabricante: str = ""
    cod_fabricante: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    cod_fornecedor: str = ""
    website: str = ""
    ficha_produto: str = ""
    plano_contas: str = ""
    # Conta de proveitos (ex.: 711 Mercadorias, 712 Produtos acabados) — exportação SAF-T / faturação
    conta_proveitos: str = ""
    # Taxa IVA do artigo (ex.: 23). None = herdar da empresa.
    iva_taxa: Optional[float] = None
    codigo_produto: str = ""
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    espessura_mm: float = 0.0
    peso_kg: float = 0.0
    comprimento_unidade: str = "mm"
    largura_unidade: str = "mm"
    espessura_unidade: str = "mm"
    peso_unidade: str = "kg"
    responsavel: str = ""
    qtd_uni: float = 1.0
    qtd_stock: float = 0.0
    nivel_reabastecimento: float = 0.0
    qtd_ultima_compra: float = 0.0
    # Stock: unidade de compra e conversão (ex.: compra «rolo», stock «m», fator 50)
    gere_stock: bool = False
    unidade_compra: str = ""
    fator_compra: float = 1.0
    # Variantes livres: artigo pai + filhos com etiqueta/atributos definidos pelo utilizador
    pai_id: Optional[str] = None
    pai_codigo: str = ""
    variante_label: str = ""
    # Atributos livres, ex.: {"Tamanho": "M", "Cor": "Preto"} ou {"Pack": "50"}
    variante_atributos: dict = Field(default_factory=dict)
    # Legado (mantido para dados antigos)
    variante_tamanho: str = ""
    variante_cor: str = ""
    tem_variantes: bool = False
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    created_by: Optional[str] = None
    created_by_nome: str = ""
    updated_by: Optional[str] = None
    updated_by_nome: str = ""


class ArtigoInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    nome: str
    descricao: str = ""
    unidade: str = "un"
    imagem: str = ""
    anexos: List[Anexo] = Field(default_factory=list)
    categoria_id: Optional[str] = None
    categoria_nome: str = ""
    subcategoria_id: Optional[str] = None
    subcategoria_nome: str = ""
    tipo_artigo: str = TIPO_ARTIGO_ATIVO
    produzido: bool = False
    custo_artigo: float = 0.0
    # Preço pago pela placa/folha (MP). Com L×A → deriva custo_artigo em €/m².
    preco_compra: float = 0.0
    margem: float = 30.0
    comissao_pct: float = 0.0
    ativo: bool = True
    diversos: bool = False
    fabricante: str = ""
    cod_fabricante: str = ""
    fornecedor_id: Optional[str] = None
    fornecedor_nome: str = ""
    cod_fornecedor: str = ""
    website: str = ""
    ficha_produto: str = ""
    plano_contas: str = ""
    conta_proveitos: str = ""
    iva_taxa: Optional[float] = None
    codigo_produto: str = ""
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    espessura_mm: float = 0.0
    peso_kg: float = 0.0
    comprimento_unidade: str = "mm"
    largura_unidade: str = "mm"
    espessura_unidade: str = "mm"
    peso_unidade: str = "kg"
    responsavel: str = ""
    qtd_uni: float = 1.0
    qtd_stock: float = 0.0
    nivel_reabastecimento: float = 0.0
    qtd_ultima_compra: float = 0.0
    # Stock: unidade de compra e conversão (ex.: compra «rolo», stock «m», fator 50)
    gere_stock: bool = False
    unidade_compra: str = ""
    fator_compra: float = 1.0
    pai_id: Optional[str] = None
    pai_codigo: str = ""
    variante_label: str = ""
    variante_atributos: dict = Field(default_factory=dict)
    variante_tamanho: str = ""
    variante_cor: str = ""
    tem_variantes: bool = False
    codigo_origem: str = ""
    materiais: List[ArtigoMaterial] = Field(default_factory=list)
    roteiro: List[Operacao] = Field(default_factory=list)

    @field_validator(
        "descricao", "unidade", "imagem", "categoria_nome", "subcategoria_nome",
        "fabricante", "cod_fabricante", "fornecedor_nome", "cod_fornecedor",
        "website", "ficha_produto", "plano_contas", "conta_proveitos",
        "codigo_produto", "comprimento_unidade", "largura_unidade",
        "espessura_unidade", "peso_unidade", "responsavel", "pai_codigo",
        "variante_label", "variante_tamanho", "variante_cor", "codigo_origem", "unidade_compra",
        mode="before",
    )
    @classmethod
    def _null_str_to_empty(cls, v: Any):
        return "" if v is None else v

    @field_validator(
        "custo_artigo", "preco_compra", "margem", "comissao_pct",
        "comprimento_mm", "largura_mm", "espessura_mm", "peso_kg",
        "qtd_uni", "qtd_stock", "nivel_reabastecimento", "qtd_ultima_compra", "fator_compra",
        mode="before",
    )
    @classmethod
    def _null_float_to_zero(cls, v: Any):
        if v is None or v == "":
            return 0.0
        return v

    @field_validator("produzido", "ativo", "diversos", "tem_variantes", "gere_stock", mode="before")
    @classmethod
    def _null_bool_to_false(cls, v: Any):
        return False if v is None else v

    @model_validator(mode="after")
    def _normalizar_tipo_artigo(self):
        t = (self.tipo_artigo or TIPO_ARTIGO_ATIVO).strip().lower()
        if t not in TIPOS_ARTIGO_INPUT:
            raise ValueError(
                "Tipo de artigo inválido. Use: " + ", ".join(TIPOS_ARTIGO)
            )
        # Legado «produzido» → Ativo + check produzido
        if t == TIPO_ARTIGO_PRODUZIDO_LEGADO:
            t = TIPO_ARTIGO_ATIVO
            self.produzido = True
        self.tipo_artigo = t
        # Produção só faz sentido em Ativo
        if t != TIPO_ARTIGO_ATIVO:
            self.produzido = False
        # Receita/operações só se produzido
        if not self.produzido:
            self.materiais = []
            self.roteiro = []
        # Alinha flag legado «ativo» com o tipo
        if t == TIPO_ARTIGO_INATIVO:
            self.ativo = False
        elif t in (TIPO_ARTIGO_ATIVO, TIPO_ARTIGO_MATERIA_PRIMA, TIPO_ARTIGO_CONSUMIVEL, TIPO_ARTIGO_SERVICO):
            self.ativo = True
        if t == TIPO_ARTIGO_SERVICO:
            self.comprimento_mm = 0.0
            self.largura_mm = 0.0
            self.espessura_mm = 0.0
            self.peso_kg = 0.0
            self.qtd_stock = 0.0
            self.nivel_reabastecimento = 0.0
            self.qtd_ultima_compra = 0.0
            self.gere_stock = False
        if not self.fator_compra or self.fator_compra <= 0:
            self.fator_compra = 1.0
        # Unidades de dimensão — defaults
        self.comprimento_unidade = (self.comprimento_unidade or "mm").strip() or "mm"
        self.largura_unidade = (self.largura_unidade or "mm").strip() or "mm"
        self.espessura_unidade = (self.espessura_unidade or "mm").strip() or "mm"
        self.peso_unidade = (self.peso_unidade or "kg").strip() or "kg"
        return self


class CategoriaInput(BaseModel):
    nome: str
    centro_custo: Optional[str] = None  # Definições → Listas → Centros de custo


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
    cor: str = ""  # cor da linha (marcação visual, ex.: urgente)
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
    desconto_base: str = "linha"  # linha | unit — € unitário vs total da linha
    # Linha de matéria-prima / consumível vendido directamente (cálculo por unidade/medidas)
    eh_materia_prima: bool = False
    eh_servico: bool = False
    eh_producao: bool = False
    modo_calculo: str = ""  # diversos | materia_prima | servico | compra | producao
    # Snapshot de custo — true após gravar/finalizar; catálogo futuro não altera
    custo_congelado: bool = False
    # Arte / maqueta da linha (PDF/JPEG) — transita para ENC e OF
    arte_path: str = ""
    arte_nome: str = ""
    arte_content_type: str = ""


class MaterialLinha(BaseModel):
    id: str = Field(default_factory=new_id)
    consumivel_id: Optional[str] = None
    # Alias do componente (artigo matéria-prima / consumível)
    material_id: Optional[str] = None
    nome: str = ""
    unidade: str = "un"
    custo_unitario: float = 0.0
    quantidade: float = 1
    comprimento_mm: float = 0.0
    largura_mm: float = 0.0
    margem: float = 50.0
    custo: float = 0.0
    valor: float = 0.0
    # Materiais vindos da receita do artigo da linha (não somam outra vez ao total)
    da_receita: bool = False
    artigo_origem_id: Optional[str] = None
    artigo_origem_nome: str = ""
    linha_origem_id: Optional[str] = None
    # Quantidade por 1 un. do artigo (para reescalar com a qtd da linha)
    quantidade_unit: Optional[float] = None
    # Consumo do próprio artigo MP na linha (não confundir com componentes da receita)
    eh_materia_prima_linha: bool = False


# Papéis do contacto na empresa — definem comunicação automática / portal.
PAPEIS_CONTACTO = ("financeiro", "decisor", "tecnico")
PAPEL_CONTACTO_PT = {
    "financeiro": "Financeiro",
    "decisor": "Decisor / Comprador",
    "tecnico": "Técnico / Designer",
}


class ClienteContacto(BaseModel):
    """Pessoa de contacto da empresa (filha da ficha Empresa)."""
    id: str = Field(default_factory=new_id)
    nome: str = ""
    cargo: str = ""  # título livre (ex.: Directora Financeira)
    # Papéis inteligentes (pode acumular vários)
    papeis: List[str] = Field(default_factory=list)
    email: str = ""
    telefone: str = ""
    departamento: str = ""
    notas: str = ""
    ativo: bool = True
    # Fase 2 (portal B2B)
    user_id: Optional[str] = None
    portal_ativo: bool = False

    @field_validator("papeis", mode="before")
    @classmethod
    def _coerce_papeis(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        out = []
        for p in v or []:
            key = str(p or "").strip().lower()
            if key in ("comprador", "buyer", "decisor_comprador"):
                key = "decisor"
            if key in ("designer", "técnico", "tecnico_designer"):
                key = "tecnico"
            if key in PAPEIS_CONTACTO and key not in out:
                out.append(key)
        return out

    @model_validator(mode="after")
    def _normalizar_contacto(self):
        self.nome = (self.nome or "").strip()
        if not self.nome:
            raise ValueError("Nome do contacto obrigatório")
        self.cargo = (self.cargo or "").strip()
        self.email = (self.email or "").strip()
        self.telefone = (self.telefone or "").strip()
        self.departamento = (self.departamento or "").strip()
        self.notas = (self.notas or "").strip()
        return self


class ClienteInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
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
    # Dados financeiros / comerciais (empresa)
    condicoes_pagamento: str = ""
    desconto_comercial_pct: Optional[float] = None
    limite_credito: Optional[float] = None
    # Contactos da empresa (pessoas)
    contactos: List[ClienteContacto] = Field(default_factory=list)
    # Flags de sistema (geridas pelo backend / configurações)
    sistema: bool = False
    is_default: bool = False

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
        self.condicoes_pagamento = (self.condicoes_pagamento or "").strip()
        if self.desconto_comercial_pct is not None:
            try:
                self.desconto_comercial_pct = max(0.0, float(self.desconto_comercial_pct))
            except (TypeError, ValueError):
                self.desconto_comercial_pct = None
        if self.limite_credito is not None:
            try:
                self.limite_credito = max(0.0, float(self.limite_credito))
            except (TypeError, ValueError):
                self.limite_credito = None

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
        else:
            # Particulares: sem lista de contactos
            self.contactos = []
        return self


class Cliente(ClienteInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    codigo_origem: str = ""
    created_at: str = Field(default_factory=now_iso)


class FornecedorInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
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
    # Quantidade já recebida (receções parciais; em unidades de compra)
    qtd_recebida: float = 0.0


class OrdemCompraInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
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
    centro_custo: str = ""
    notas: str = ""
    linhas: List[OrdemCompraLinha] = Field(default_factory=list)
    anexos: List[Anexo] = Field(default_factory=list)


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
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
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
    anexos: List[Anexo] = Field(default_factory=list)
    ordem_compra_id: Optional[str] = None
    ordem_compra_codigo: str = ""


class PedidoCotacao(PedidoCotacaoInput):
    id: str = Field(default_factory=new_id)
    codigo: str = ""
    created_at: str = Field(default_factory=now_iso)


class OrcamentoInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    cliente: str = ""
    cliente_id: Optional[str] = None
    # «À atenção de» — contacto da empresa (denormalizado)
    contacto_id: Optional[str] = None
    contacto_nome: str = ""
    contacto_email: str = ""
    contacto_telefone: str = ""
    contacto_cargo: str = ""
    contacto_departamento: str = ""
    contacto_papeis: List[str] = Field(default_factory=list)
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    validade: Optional[str] = None
    status: str = "rascunho"
    motivo_perda: str = ""  # porque se perdeu (preço, prazo, sem resposta, outro fornecedor…)
    margem: float = 0.0
    notas: str = ""
    desconto_total: float = 0.0
    desconto_total_tipo: str = "pct"  # pct | eur
    # Portes de envio (isolados do custo de produção fabril)
    portes: float = 0.0
    linhas: List[OrcamentoLinha] = Field(default_factory=list)
    materiais: List[MaterialLinha] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)
    anexos: List[Anexo] = Field(default_factory=list)


class Orcamento(OrcamentoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    versao: int = 0
    versoes: List[dict] = Field(default_factory=list)
    of_id: Optional[str] = None
    of_numero: Optional[str] = None
    encomenda_id: Optional[str] = None
    encomenda_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


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
    # Acerto manual do tempo real de máquina (min). Vazio = usa o estimado.
    tempo_maquina_real: Optional[float] = None
    concluida: bool = False
    manual: bool = False
    nota: str = ""


class OFItem(BaseModel):
    cor: str = ""  # cor da linha (marcação visual, ex.: urgente)
    observacoes: str = ""  # ex.: personalização pedida na loja online
    id: str = Field(default_factory=new_id)
    artigo_id: str
    artigo_nome: str = ""
    artigo_codigo: str = ""
    imagem: str = ""
    quantidade: float = 1
    unidade: str = "un"
    preco_unit: float = 0.0
    # Snapshot de custo no momento da criação da OF (não recalcular com preços futuros)
    custo_compra_unit: float = 0.0
    custo_producao_unit: float = 0.0
    custo_congelado: bool = False
    tipo_personalizacao_id: Optional[str] = None
    tipo_personalizacao_nome: Optional[str] = None
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    operacoes: List[OFOperacao] = Field(default_factory=list)
    # Materiais a consumir (do orçamento de origem ou da receita do artigo), já para a qtd da OF
    materiais: List[dict] = Field(default_factory=list)
    enc_artigo_id: Optional[str] = None
    origem_operacoes: str = ""  # orcamento | catalogo | ""
    origem_materiais: str = ""
    arte_path: str = ""
    arte_nome: str = ""
    arte_content_type: str = ""


class OrdemFabricoInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    cliente: str
    cliente_id: Optional[str] = None
    encomenda_id: Optional[str] = None
    descricao: str = ""
    numero_encomenda: str = ""
    data: Optional[str] = None
    prazo_entrega: Optional[str] = None
    status: str = "pendente"
    notas: str = ""
    prioritaria: bool = False
    responsavel_id: Optional[str] = None
    responsavel_nome: str = ""
    itens: List[OFItem] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)
    anexos: List[Anexo] = Field(default_factory=list)


class OrdemFabrico(OrdemFabricoInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    orcamento_id: Optional[str] = None
    orcamento_numero: Optional[str] = None
    encomenda_numero: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class EncomendaArtigo(BaseModel):
    cor: str = ""  # cor da linha (marcação visual, ex.: urgente)
    id: str = Field(default_factory=new_id)
    artigo_id: Optional[str] = None
    artigo_nome: str = ""
    artigo_codigo: str = ""
    imagem: str = ""
    quantidade: float = 1
    preco_unit: float = 0.0
    # Piso do preço cotado: na encomenda pode subir, não pode descer.
    preco_unit_orcamento: Optional[float] = None
    desconto: float = 0.0
    desconto_tipo: str = "pct"  # pct | eur
    desconto_base: str = "linha"  # linha | unit — € unitário vs total da linha
    personalizacoes: List[PersonalizacaoSel] = Field(default_factory=list)
    # Ligação à linha do orçamento + snapshot de produção (passa para a OF)
    orcamento_linha_id: Optional[str] = None
    quantidade_orcamento: Optional[float] = None
    roteiro_orcamento: Optional[List[dict]] = None
    materiais_orcamento: Optional[List[dict]] = None
    # Notas da linha (ex.: personalização pedida na loja online: «Nome a gravar: Ana»)
    observacoes: str = ""
    # Arte / maqueta herdada do orçamento
    arte_path: str = ""
    arte_nome: str = ""
    arte_content_type: str = ""


class Pagamento(BaseModel):
    id: str = Field(default_factory=new_id)
    recibo_numero: str = ""
    data: Optional[str] = None
    valor: float = 0.0
    metodo: str = "transferencia"  # transferencia | numerario | mbway | multibanco | cheque | cartao | outro
    nota: str = ""
    origem: str = "encomenda"  # encomenda | fatura
    tipo: str = "pagamento"  # pagamento | devolucao
    # Documento fiscal emitido a partir deste pagamento (ecrã Pagamentos)
    documento_id: Optional[str] = None
    documento_numero: str = ""
    documento_tipo: str = ""
    created_at: str = Field(default_factory=now_iso)


class EncomendaInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    cliente: str
    cliente_id: Optional[str] = None
    # «À atenção de» — contacto da empresa (denormalizado)
    contacto_id: Optional[str] = None
    contacto_nome: str = ""
    contacto_email: str = ""
    contacto_telefone: str = ""
    contacto_cargo: str = ""
    contacto_departamento: str = ""
    contacto_papeis: List[str] = Field(default_factory=list)
    descricao: str = ""
    # PO / Nota de Encomenda do cliente B2B (herda de orçamento.numero_encomenda)
    referencia_cliente: str = ""
    data: Optional[str] = None
    prazo_entrega: Optional[str] = None
    estado: str = "aberta"
    notas: str = ""
    desconto_total: float = 0.0
    desconto_total_tipo: str = "pct"  # pct | eur
    envio: float = 0.0
    artigos: List[EncomendaArtigo] = Field(default_factory=list)
    imagens: List[str] = Field(default_factory=list)
    anexos: List[Anexo] = Field(default_factory=list)
    pagamentos: List[Pagamento] = Field(default_factory=list)
    valor_total: Optional[float] = None
    valor_total_manual: bool = False
    valor_pago: float = 0.0
    autorizada_producao: bool = False
    entregue: bool = False
    data_entrega: Optional[str] = None


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
    # PO do cliente — obrigatório em faturas corporate
    referencia_cliente: str = ""
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
    estado: str = "emitida"  # rascunho | emitida | anulada  (emitida = assinada, já não se edita)
    # Origem: pagamento registado na encomenda (ecrã Pagamentos)
    pagamento_id: Optional[str] = None
    # Assinatura interna (encadeada) — fixa o documento
    hash: str = ""
    hash_anterior: str = ""
    assinado_at: Optional[str] = None
    assinado_por: str = ""
    # Emissão num programa certificado (FIZ / TOConline / Moloni): número oficial, ATCUD, PDF, estado na AT
    faturacao: dict = Field(default_factory=dict)


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
    # Orçamentos: validade auto = data + N dias
    orcamento_validade_dias: int = 15
    # Semáforo de margem (lucro / total venda)
    margem_saudavel_pct: float = 40.0
    margem_risco_pct: float = 20.0
    # Templates de notas/disclaimers para PDF
    orcamento_notas_templates: List[dict] = Field(default_factory=list)


class PdfTemplateInput(BaseModel):
    nome: str
    modulo: str
    finalidade: str = "ambos"
    mostrar_branding: bool = True
    campos: dict = Field(default_factory=dict)
    # Aparência (orçamentos): «proposta» (predefinido) ou «classico»; cor de destaque; textos das secções
    estilo: str = "proposta"
    cor: str = ""
    textos: dict = Field(default_factory=dict)  # introducao, incluido, prazos, condicoes, agradecimento
    imagens: bool = True     # fotos/artes dos artigos
    aceitacao: bool = True   # caixa «Aceitação da proposta»
    padrao: bool = False     # modelo usado por defeito no módulo


class PdfTemplate(PdfTemplateInput):
    id: str = Field(default_factory=new_id)
    created_at: str = Field(default_factory=now_iso)


# ----------------------- Constantes de apresentação -----------------------
STATUS_PT = {
    "rascunho": "Rascunho",
    "criado": "Criado",
    "finalizado": "Criado",
    "enviado": "Enviado",
    "negociado": "Negociação",
    "ganho": "Ganho",
    "perdido": "Perdido",
    "aceite": "Ganho",
    "rejeitado": "Perdido",
    "pendente": "Pendente", "em_producao": "Em Produção", "concluido": "Concluído",
}
PAY_PT = {"pendente": "Pendente", "parcial": "Pago parcial", "pago": "Pago total"}
ENC_ESTADO_PT = {"aberta": "Aberta", "em_producao": "Em Produção", "concluida": "Concluída", "cancelada": "Cancelada"}
NC_TIPO_PT = {
    "defeito": "Defeito",
    "quantidade": "Quantidade",
    "material": "Material",
    "prazo": "Prazo",
    "outro": "Outro",
}
NC_ESTADO_PT = {
    "aberta": "Aberta",
    "em_analise": "Em análise",
    "fechada": "Fechada",
}


class NaoConformidadeInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    encomenda_id: Optional[str] = None
    encomenda_artigo_id: Optional[str] = None
    artigo_id: Optional[str] = None
    artigo_nome: str = ""
    artigo_codigo: str = ""
    quantidade: float = 0
    tipo: str = "defeito"
    descricao: str = ""
    acao_corretiva: str = ""
    estado: str = "aberta"
    notas: str = ""
    anexos: List[Anexo] = Field(default_factory=list)
    # Snapshot do custo unitário no momento do registo (desperdício de produção)
    custo_unitario: float = 0.0
    custo_desperdicio: float = 0.0
    stock_abatido: bool = False


class NaoConformidade(NaoConformidadeInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    encomenda_numero: str = ""
    cliente: str = ""
    cliente_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    created_by: Optional[str] = None
    created_by_nome: str = ""


DOC_TIPO_PT = {
    "nota_credito": "Nota de crédito",
    "fatura": "Fatura",
    "proforma": "Fatura Pro Forma",
    "recibo": "Recibo",
    "fatura_recibo": "Fatura-Recibo",
}
DOC_ESTADO_PT = {"emitida": "Emitida", "anulada": "Anulada"}

CONTA_TIPO_PT = {"receber": "A receber", "pagar": "A pagar"}
CONTA_ESTADO_PT = {
    "pendente": "Pendente",
    "parcial": "Parcial",
    "liquidada": "Liquidada",
    "anulada": "Anulada",
}


class ContaAnexo(Anexo):
    pass


class ContaInput(BaseModel):
    # Campos personalizados (Definições → Campos)
    campos_extra: dict = Field(default_factory=dict)
    tipo: str = "receber"  # receber | pagar
    entidade: str = ""
    entidade_tipo: str = ""  # cliente | fornecedor | outro
    entidade_id: Optional[str] = None
    descricao: str = ""
    referencia: str = ""
    data: Optional[str] = None
    vencimento: Optional[str] = None
    valor: float = 0.0
    valor_pago: float = 0.0
    metodo: str = ""
    notas: str = ""
    estado: str = "pendente"
    anexos: List[ContaAnexo] = Field(default_factory=list)


class Conta(ContaInput):
    id: str = Field(default_factory=new_id)
    numero: str = ""
    created_at: str = Field(default_factory=now_iso)


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
        {"key": "introducao", "label": "Texto de introdução (proposta)"},
        {"key": "linhas_artigos", "label": "Linhas de artigos"},
        {"key": "personalizacoes", "label": "Personalizações"},
        {"key": "materiais", "label": "Materiais / consumíveis"},
        {"key": "totais", "label": "Totais e preço final"},
        {"key": "incluido", "label": "O que está incluído (proposta)"},
        {"key": "prazos", "label": "Maquete, prazos e entrega (proposta)"},
        {"key": "condicoes", "label": "Condições"},
        {"key": "notas", "label": "Notas"},
        {"key": "aceitacao", "label": "Caixa de aceitação (proposta)"},
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
