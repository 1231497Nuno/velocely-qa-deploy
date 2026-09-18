/** Tipos de artigo, campos e blocos da ficha. */

export const TIPOS_ARTIGO = [
  {
    id: "ativo",
    label: "Ativo",
    desc: "Artigo de venda — pode ser produzido (receita e operações)",
  },
  {
    id: "consumivel",
    label: "Consumível",
    desc: "Artigos que irão ser consumidos / matéria-prima",
  },
  {
    id: "servico",
    label: "Serviço",
    desc: "Sem stock nem produção",
  },
  {
    id: "nao_utilizado",
    label: "Não utilizado",
    desc: "Pode usar em operações futuras, com confirmação",
  },
  {
    id: "inativo",
    label: "Inativo",
    desc: "Não pode voltar a ser utilizado em operações futuras",
  },
];

export const TIPO_ARTIGO_PT = Object.fromEntries(TIPOS_ARTIGO.map((t) => [t.id, t.label]));

/** Blocos da ficha — ordem default; o utilizador pode arrastar/minimizar. */
export const BLOCOS_ARTIGO = [
  { id: "detalhes", label: "Detalhes do produto" },
  { id: "dimensoes", label: "Dimensões" },
  { id: "preco", label: "Informação preço venda" },
  { id: "stock", label: "Informação de stock" },
  { id: "materiais", label: "Materiais necessários" },
  { id: "operacoes", label: "Operações / tempos" },
  { id: "custo", label: "Custo total calculado" },
];

export const BLOCOS_ARTIGO_DEFAULT_ORDER = BLOCOS_ARTIGO.map((b) => b.id);

/** Quais blocos aparecem por tipo (+ check produzido). */
export function blocosVisiveis(tipo, produzido) {
  const t = tipo === "produzido" ? "ativo" : (tipo || "ativo");
  const set = new Set(["detalhes", "preco", "custo"]);
  if (t !== "servico") {
    set.add("dimensoes");
    set.add("stock");
  }
  if (t === "ativo" && produzido) {
    set.add("materiais");
    set.add("operacoes");
  }
  if (t === "consumivel") {
    set.delete("preco"); // sem margem/comissão típica — custo fica em detalhes/custo
    set.add("custo");
  }
  return set;
}

/** Campos do bloco «detalhes» visíveis por tipo. */
const DETALHES_BY_TIPO = {
  ativo: [
    "nome", "codigo", "tipo_artigo", "produzido",
    "fabricante", "categoria", "fornecedor", "subcategoria",
    "cod_fornecedor", "website", "ficha_produto", "cod_fabricante",
    "plano_contas", "descricao", "imagem",
    "created_at", "created_by", "updated_at",
  ],
  consumivel: [
    "nome", "codigo", "tipo_artigo",
    "fabricante", "categoria", "fornecedor", "subcategoria",
    "cod_fornecedor", "cod_fabricante", "plano_contas", "descricao", "imagem",
    "created_at", "created_by", "updated_at",
  ],
  servico: [
    "nome", "codigo", "tipo_artigo",
    "categoria", "subcategoria", "website", "ficha_produto", "plano_contas",
    "descricao", "imagem",
    "created_at", "created_by", "updated_at",
  ],
  nao_utilizado: [
    "nome", "codigo", "tipo_artigo",
    "fabricante", "categoria", "fornecedor", "subcategoria",
    "cod_fornecedor", "website", "ficha_produto", "cod_fabricante",
    "plano_contas", "descricao", "imagem",
    "created_at", "created_by", "updated_at",
  ],
  inativo: [
    "nome", "codigo", "tipo_artigo",
    "fabricante", "categoria", "fornecedor", "subcategoria",
    "cod_fornecedor", "website", "ficha_produto", "cod_fabricante",
    "plano_contas", "descricao", "imagem",
    "created_at", "created_by", "updated_at",
  ],
};

const PRECO_BY_TIPO = {
  ativo: ["preco_venda", "custo_artigo", "margem", "comissao_pct"],
  consumivel: ["custo_artigo"],
  servico: ["preco_venda", "custo_artigo", "margem", "comissao_pct"],
  nao_utilizado: ["preco_venda", "custo_artigo", "margem", "comissao_pct"],
  inativo: ["preco_venda", "custo_artigo", "margem", "comissao_pct"],
};

const STOCK_BY_TIPO = {
  ativo: ["unidade", "qtd_uni", "qtd_stock", "nivel_reabastecimento", "responsavel", "qtd_ultima_compra"],
  consumivel: ["unidade", "qtd_uni", "qtd_stock", "nivel_reabastecimento", "responsavel", "qtd_ultima_compra"],
  servico: ["unidade"],
  nao_utilizado: ["unidade", "qtd_uni", "qtd_stock", "nivel_reabastecimento", "responsavel", "qtd_ultima_compra"],
  inativo: ["unidade", "qtd_uni", "qtd_stock", "nivel_reabastecimento", "responsavel", "qtd_ultima_compra"],
};

export function camposBloco(blocoId, tipo) {
  const t = tipo === "produzido" ? "ativo" : (tipo || "ativo");
  if (blocoId === "detalhes") return DETALHES_BY_TIPO[t] || DETALHES_BY_TIPO.ativo;
  if (blocoId === "dimensoes") return ["comprimento_mm", "largura_mm", "espessura_mm", "peso_kg"];
  if (blocoId === "preco") return PRECO_BY_TIPO[t] || PRECO_BY_TIPO.ativo;
  if (blocoId === "stock") return STOCK_BY_TIPO[t] || STOCK_BY_TIPO.ativo;
  return [];
}

export function mostraCampo(tipo, campo) {
  const t = tipo === "produzido" ? "ativo" : (tipo || "ativo");
  const all = new Set([
    ...(DETALHES_BY_TIPO[t] || []),
    ...(t !== "servico" ? ["comprimento_mm", "largura_mm", "espessura_mm", "peso_kg"] : []),
    ...(PRECO_BY_TIPO[t] || []),
    ...(STOCK_BY_TIPO[t] || []),
  ]);
  return all.has(campo);
}

/** @deprecated use isProduzido(form) */
export function camposDoTipo(tipo) {
  return new Set(camposBloco("detalhes", tipo).concat(camposBloco("preco", tipo), camposBloco("stock", tipo)));
}

export function isProduzido(artigoOuForm) {
  if (!artigoOuForm) return false;
  if (typeof artigoOuForm === "boolean") return artigoOuForm;
  if (artigoOuForm.produzido === true) return true;
  if (artigoOuForm.tipo_artigo === "produzido") return true;
  if (artigoOuForm.produzido === false) return false;
  const mats = artigoOuForm.materiais || [];
  const rot = artigoOuForm.roteiro || [];
  return mats.length > 0 || rot.length > 0;
}

export function normalizarTipo(artigo) {
  const raw = artigo?.tipo_artigo;
  if (raw === "produzido") return "ativo";
  if (raw && TIPO_ARTIGO_PT[raw]) return raw;
  if (artigo?.ativo === false) return "inativo";
  return "ativo";
}

export const emptyArtigoForm = {
  tipo_artigo: "ativo",
  produzido: false,
  nome: "",
  descricao: "",
  unidade: "un",
  imagem: "",
  custo_artigo: 0,
  margem: 30,
  comissao_pct: 0,
  categoria_id: "",
  categoria_nome: "",
  subcategoria_id: "",
  subcategoria_nome: "",
  ativo: true,
  fabricante: "",
  cod_fabricante: "",
  fornecedor_id: "",
  fornecedor_nome: "",
  cod_fornecedor: "",
  website: "",
  ficha_produto: "",
  plano_contas: "",
  codigo_produto: "",
  comprimento_mm: 0,
  largura_mm: 0,
  espessura_mm: 0,
  peso_kg: 0,
  comprimento_unidade: "mm",
  largura_unidade: "mm",
  espessura_unidade: "mm",
  peso_unidade: "kg",
  responsavel: "",
  qtd_uni: 1,
  qtd_stock: 0,
  nivel_reabastecimento: 0,
  qtd_ultima_compra: 0,
  materiais: [],
  roteiro: [],
  diversos: false,
};

export function buildArtigoBody(form) {
  let tipo = form.tipo_artigo || "ativo";
  if (tipo === "produzido") tipo = "ativo";
  const produzido = tipo === "ativo" && isProduzido(form);
  const body = {
    nome: form.nome,
    descricao: form.descricao || "",
    unidade: form.unidade || "un",
    imagem: form.imagem || "",
    tipo_artigo: tipo,
    produzido,
    custo_artigo: Number(form.custo_artigo) || 0,
    margem: tipo === "consumivel" || form.diversos ? 0 : (Number(form.margem) || 0),
    comissao_pct: tipo === "consumivel" || form.diversos ? 0 : (Number(form.comissao_pct) || 0),
    categoria_id: form.categoria_id || null,
    categoria_nome: form.categoria_nome || "",
    subcategoria_id: form.subcategoria_id || null,
    subcategoria_nome: form.subcategoria_nome || "",
    ativo: tipo !== "inativo",
    fabricante: form.fabricante || "",
    cod_fabricante: form.cod_fabricante || "",
    fornecedor_id: form.fornecedor_id || null,
    fornecedor_nome: form.fornecedor_nome || "",
    cod_fornecedor: form.cod_fornecedor || "",
    website: form.website || "",
    ficha_produto: form.ficha_produto || "",
    plano_contas: form.plano_contas || "",
    codigo_produto: form.codigo_produto || "",
    comprimento_mm: tipo === "servico" ? 0 : (Number(form.comprimento_mm) || 0),
    largura_mm: tipo === "servico" ? 0 : (Number(form.largura_mm) || 0),
    espessura_mm: tipo === "servico" ? 0 : (Number(form.espessura_mm) || 0),
    peso_kg: tipo === "servico" ? 0 : (Number(form.peso_kg) || 0),
    comprimento_unidade: form.comprimento_unidade || "mm",
    largura_unidade: form.largura_unidade || "mm",
    espessura_unidade: form.espessura_unidade || "mm",
    peso_unidade: form.peso_unidade || "kg",
    responsavel: form.responsavel || "",
    qtd_uni: Number(form.qtd_uni) || 1,
    qtd_stock: tipo === "servico" ? 0 : (Number(form.qtd_stock) || 0),
    nivel_reabastecimento: tipo === "servico" ? 0 : (Number(form.nivel_reabastecimento) || 0),
    qtd_ultima_compra: tipo === "servico" ? 0 : (Number(form.qtd_ultima_compra) || 0),
    materiais: produzido
      ? (form.materiais || []).filter((m) => m.material_id).map((m) => ({
        ...m,
        quantidade: Number(m.quantidade) || 0,
        custo_unitario: Number(m.custo_unitario) || 0,
      }))
      : [],
    roteiro: produzido
      ? (form.roteiro || []).map((op) => ({
        ...op,
        tempo_maquina: Number(op.tempo_maquina) || 0,
        tempo_mao_obra: Number(op.tempo_mao_obra) || 0,
      }))
      : [],
  };
  return body;
}

const LAYOUT_KEY = "artigo-blocos-layout-v1";

export function loadBlocosLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { order: [...BLOCOS_ARTIGO_DEFAULT_ORDER], collapsed: {} };
    const parsed = JSON.parse(raw);
    const known = new Set(BLOCOS_ARTIGO_DEFAULT_ORDER);
    const order = (parsed.order || []).filter((id) => known.has(id));
    for (const id of BLOCOS_ARTIGO_DEFAULT_ORDER) {
      if (!order.includes(id)) order.push(id);
    }
    return { order, collapsed: parsed.collapsed || {} };
  } catch {
    return { order: [...BLOCOS_ARTIGO_DEFAULT_ORDER], collapsed: {} };
  }
}

export function saveBlocosLayout(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch { /* ignore */ }
}
