import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, eur, API, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ClienteSelector from "@/components/ClienteSelector";
import ContactoSelector from "@/components/ContactoSelector";
import StatusBadge from "@/components/StatusBadge";
import PdfExportButton from "@/components/PdfExportButton";
import EnviarEmailButton from "@/components/EnviarEmailButton";
import { isDiversosArtigo } from "@/components/LinhaTipoIcon";
import { LinhaCodigoSelect, LinhaDescricaoInput } from "@/components/LinhaArtigoFields";
import { OrcamentoMateriais, OrcamentoTotais } from "@/features/orcamentos/OrcamentoPanels";
import {
  expandReceitaParaMateriaisOrc,
  expandMateriaPrimaParaLinhaOrc,
  reescalarMateriaisDaLinha,
  resolverCustosComponentes,
  semMateriaisDaLinha,
} from "@/features/orcamentos/orcamentoMateriais";
import {
  modoCalculoLinha,
  regrasModo,
  tipoLinhaFromArtigo,
  flagsLinhaFromModo,
  custosIniciaisFromArtigo,
  precoVendaInicialFromArtigo,
  migrarLinhasOrc,
} from "@/features/orcamentos/orcamentoLinhaRegras";
import {
  breakdownLinhaUnit,
  precoUnitFromBreakdown,
} from "@/features/orcamentos/orcamentoLinhaCalculo";
import { custoConsumoMedida, custoUnitarioArtigo } from "@/features/artigos/artigoCustoPlaca";
import HistoricoTimeline from "@/components/HistoricoTimeline";
import DetailTabs, { useDetailTab } from "@/components/DetailTabs";
import ImagemUpload from "@/components/ImagemUpload";
import FicheirosTab from "@/components/FicheirosTab";
import { StickyDetailHeader, StickyBackButton } from "@/components/StickyDetailHeader";
import { Plus, Trash2, Save, FileText, Cog, Layers, X, ChevronDown, ChevronRight, RotateCcw, AlertTriangle, ClipboardList, CheckCircle2, Send, Handshake, Trophy, Ban, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { orcTemNumero, orcNumeroLabel, orcStatus, orcEditavel, orcIsGanho, orcLinhaPronta, ymdHoje, orcErroDatas } from "@/lib/orcamento";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const toHours = (v, u) => (Number(v) || 0) / (u === "h" ? 1 : 60);
const maqHora = (m) => (m ? (Number(m.custo_amortizacao_hora) || 0) + (Number(m.custo_energia_hora) || 0) : 0);

export default function OrcamentoDetail() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useDetailTab(["orcamento", "ficheiros", "historico"], "orcamento");
  const [orc, setOrc] = useState(null);
  const [artigos, setArtigos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [maoObra, setMaoObra] = useState([]);
  const [consumiveis, setConsumiveis] = useState([]);
  const [openOps, setOpenOps] = useState({});
  /** Separador ativo na linha expandida: "mats" | "ops" */
  const [linePanel, setLinePanel] = useState({});
  const [empresa, setEmpresa] = useState({});
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteDoc, setClienteDoc] = useState(null);
  const [showRequisitosEncomenda, setShowRequisitosEncomenda] = useState(false);
  const [showRequisitosFinalizar, setShowRequisitosFinalizar] = useState(false);
  const [showConverterPrecos, setShowConverterPrecos] = useState(false);
  const [precosEncomenda, setPrecosEncomenda] = useState({});
  const [converting, setConverting] = useState(false);
  const [viewVersao, setViewVersao] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const o = await api.get(`/orcamentos/${id}`);
      // migrar personalização única (legado) para lista
      o.linhas = (o.linhas || []).map((l) => {
        if (!l.id) l.id = crypto.randomUUID();
        if ((!l.personalizacoes || l.personalizacoes.length === 0) && l.tipo_personalizacao_id) {
          l.personalizacoes = [{ id: l.tipo_personalizacao_id, nome: l.tipo_personalizacao_nome || "", valor: Number(l.valor_personalizacao) || 0 }];
        } else if (!l.personalizacoes) {
          l.personalizacoes = [];
        }
        if (!l.tipo_linha) l.tipo_linha = "";
        if (l.descricao_livre == null) l.descricao_livre = false;
        return l;
      });
      o.materiais = o.materiais || [];

      const [arts, tipos, maqs, mos, cons, empresa, cs] = await Promise.all([
        api.get("/artigos?lite=1"),
        api.get("/tipos-personalizacao"),
        api.get("/maquinas"),
        api.get("/mao-obra"),
        api.get("/consumiveis"),
        api.get("/settings/empresa").catch(() => ({})),
        o.cliente_id ? api.get("/clientes").catch(() => []) : Promise.resolve([]),
      ]);
      const orcMigrado = migrarLinhasOrc(o, arts);
      setOrc(orcMigrado);
      setArtigos(arts);
      setTipos(tipos);
      setMaquinas(maqs);
      setMaoObra(mos);
      setConsumiveis(cons);
      setEmpresa(empresa);
      const clientes = Array.isArray(cs) ? cs : (cs.items || []);
      const cli = o.cliente_id ? (clientes.find((x) => x.id === o.cliente_id) || null) : null;
      setClienteDoc(cli);
      setClienteEmail(o.contacto_email || cli?.email || "");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setLoadError(typeof detail === "string" ? detail : "Não foi possível carregar o orçamento.");
      setOrc(null);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (loadError && !orc) {
    return (
      <div className="text-sm space-y-3 py-8 text-center">
        <p className="text-gray-600">{loadError}</p>
        <button type="button" onClick={() => load()} className="bg-black text-white rounded-sm px-4 py-2 text-sm font-medium">Tentar novamente</button>
      </div>
    );
  }
  if (!orc) return <div className="text-sm text-gray-500">A carregar...</div>;

  const upd = (patch) => setOrc({ ...orc, ...patch });

  const isM2 = (u) => ["m²", "m2"].includes((u || "").toLowerCase());
  const matCusto = (m) => custoConsumoMedida({
    unidade: m.unidade,
    custo_unitario: m.custo_unitario,
    quantidade: m.quantidade,
    comprimento_mm: m.comprimento_mm,
    largura_mm: m.largura_mm,
    modo_m2: m.modo_m2,
  });

  const artigoDaLinha = (l) => artigos.find((x) => x.id === l?.artigo_id);
  const modoLinha = (l) => modoCalculoLinha(l, artigoDaLinha(l));
  const regrasLinha = (l) => regrasModo(modoLinha(l));

  const lineCtx = () => ({ matCusto, maquinas, maoObra, toHours, maqHora });
  const lineBd = (l) => breakdownLinhaUnit(l, orc.materiais || [], lineCtx());

  const lineCusto = (l) => lineBd(l).custo;
  const linePreco = (l) => precoUnitFromBreakdown(l, lineBd(l));
  const compPreco = (l) => {
    const bd = lineBd(l);
    // Auto = preço calculado (custo × margem); catálogo só na origem inicial
    if (l.preco_origem === "catalogo" && !l.preco_unit_manual) {
      return Number(l.preco_venda_catalogo ?? l.preco_unit) || bd.precoCalc;
    }
    return bd.precoCalc;
  };

  /** Após editar materiais/ops: actualiza custos explícitos e recalcula preço (custo × margem), salvo se manual. */
  const adaptarLinhaPorReceita = (linhas, materiais, linhaId, { forcarCalculado = true } = {}) => {
    if (!linhaId) return linhas;
    const idx = linhas.findIndex((l) => l.id === linhaId);
    if (idx < 0) return linhas;
    const l = linhas[idx];
    if (l.descricao_livre || l.tipo_linha === "descritor") return linhas;
    const modo = modoLinha(l);
    const regras = regrasModo(modo);
    let compra = regras.compraZero ? 0 : (l.custo_compra_unit != null ? Number(l.custo_compra_unit) : NaN);
    if (!regras.compraZero && !Number.isFinite(compra)) {
      const a = artigoDaLinha(l);
      compra = a ? custoUnitarioArtigo(a) : 0;
    }
    const lCompra = { ...l, modo_calculo: modo, ...flagsLinhaFromModo(modo), custo_compra_unit: compra };
    const bd = breakdownLinhaUnit(lCompra, materiais, lineCtx());
    const updated = {
      ...lCompra,
      custo_compra_unit: bd.compra,
      custo_materiais_unit: bd.materiais,
      custo_operacoes_unit: bd.operacoes,
      custo_base_unit: Math.round((bd.compra + bd.materiais) * 100) / 100,
      custo_producao_unit: bd.custo,
    };
    if (l.preco_origem !== "manual" && !l.preco_unit_manual) {
      if (forcarCalculado) {
        updated.preco_origem = "calculado";
        updated.preco_unit = bd.precoCalc;
        updated.preco_unit_manual = false;
      } else if (l.preco_origem === "catalogo") {
        updated.preco_unit = Number(l.preco_venda_catalogo) || bd.precoCalc;
      } else {
        updated.preco_unit = bd.precoCalc;
      }
    }
    const next = [...linhas];
    next[idx] = updated;
    return next;
  };

  const precoVendaArtigo = (l) => Number(l?.preco_venda_catalogo ?? l?.preco_unit) || 0;

  const reloadArtigos = async () => {
    const arts = await api.get("/artigos?lite=1");
    setArtigos(arts);
    return arts;
  };

  const emptyLinha = () => ({
    id: crypto.randomUUID(),
    artigo_id: "",
    artigo_nome: "",
    artigo_codigo: "",
    tipo_linha: "",
    descricao_livre: false,
    quantidade: 1,
    tipo_personalizacao_id: "",
    tipo_personalizacao_nome: "",
    valor_personalizacao: 0,
    custo_base_unit: 0,
    margem: 0,
    roteiro: [],
    custo_producao_unit: 0,
    preco_unit: 0,
    desconto: 0,
    desconto_tipo: "pct",
    desconto_base: "linha",
    personalizacoes: [],
    imagem: "",
  });

  const applyTipoLinha = (i, v) => {
    if (v === "descritor") {
      const linha = orc.linhas[i];
      const linhaId = linha.id || crypto.randomUUID();
      const linhas = [...orc.linhas];
      linhas[i] = {
        ...linha,
        id: linhaId,
        tipo_linha: "descritor",
        descricao_livre: true,
        artigo_id: "",
        artigo_codigo: "",
        imagem: "",
        custo_base_unit: 0,
        margem: 0,
        roteiro: [],
        preco_unit: 0,
        preco_unit_manual: true,
      };
      upd({
        linhas,
        materiais: semMateriaisDaLinha(orc.materiais, linhaId),
      });
    } else {
      updLinha(i, { tipo_linha: v });
    }
  };

  const applyArtigoLinha = async (i, aLite, opts = {}) => {
    const l = orc.linhas[i];
    const linhaId = l.id || crypto.randomUUID();
    let a = aLite;
    try {
      // Artigo completo: receita + preço de venda correcto (lite não inclui BOM/custeio)
      a = await api.get(`/artigos/${aLite.id}`);
    } catch {
      a = aLite;
    }
    const livre = !!opts.descricao_livre || isDiversosArtigo(a);
    const modo = modoCalculoLinha(l, a);
    const regras = regrasModo(modo);
    const tipoLinha = livre ? "descritor" : tipoLinhaFromArtigo(a);
    const margemArt = regras.margemZero ? 0 : (Number(a.margem) ?? 30);
    const precoVenda = precoVendaInicialFromArtigo(a, modo, margemArt);
    const custos = custosIniciaisFromArtigo(a, modo);
    let nextLinha = {
      ...l,
      id: linhaId,
      tipo_linha: tipoLinha,
      descricao_livre: livre,
      ...flagsLinhaFromModo(modo),
      artigo_id: a.id,
      artigo_codigo: a.codigo || "",
      artigo_nome: opts.clear_nome ? "" : a.nome,
      imagem: l.imagem || a.imagem || "",
      ...custos,
      margem: margemArt,
      roteiro: regras.roteiroFromArtigo ? JSON.parse(JSON.stringify(a.roteiro || [])) : [],
      preco_venda_catalogo: precoVenda,
      preco_unit: precoVenda,
      preco_unit_manual: regras.precoManual,
      preco_origem: regras.precoOrigem,
    };
    const matsBase = semMateriaisDaLinha(orc.materiais, linhaId);
    let matsReceita = [];
    if (regras.expandMateriaPrima) {
      matsReceita = expandMateriaPrimaParaLinhaOrc(a, {
        linhaId,
        quantidadeLinha: nextLinha.quantidade || 1,
      });
    } else if (regras.expandReceita) {
      const matIds = (a.materiais || []).map((m) => m.material_id || m.consumivel_id).filter(Boolean);
      const custosById = await resolverCustosComponentes(matIds, { api, consumiveis });
      matsReceita = expandReceitaParaMateriaisOrc(a, {
        linhaId,
        quantidadeLinha: nextLinha.quantidade || 1,
        custosById,
      });
    }
    let linhas = [...orc.linhas];
    linhas[i] = nextLinha;
    linhas = adaptarLinhaPorReceita(linhas, [...matsBase, ...matsReceita], linhaId, { forcarCalculado: regras.forcarCalculado });
    // Actualiza cache com artigo completo
    setArtigos((prev) => {
      const others = prev.filter((x) => x.id !== a.id);
      return [...others, { ...a, lite: false, preco_venda: precoVenda }];
    });
    upd({ linhas, materiais: [...matsBase, ...matsReceita] });
  };

  const addLinha = () => {
    upd({ linhas: [...orc.linhas, emptyLinha()] });
  };

  const updLinha = (i, patch) => {
    const l = [...orc.linhas];
    const prev = l[i];
    const linhaId = prev.id || crypto.randomUUID();
    let next = { ...prev, id: linhaId, ...patch };
    let materiais = orc.materiais || [];
    if (Object.prototype.hasOwnProperty.call(patch, "quantidade") && linhaId) {
      materiais = reescalarMateriaisDaLinha(materiais, linhaId, next.quantidade);
    }
    // Alterar margem → passa a preço calculado (custo × margem)
    if (Object.prototype.hasOwnProperty.call(patch, "margem") && next.preco_origem !== "manual" && !next.preco_unit_manual) {
      next.preco_origem = "calculado";
      const bd = breakdownLinhaUnit(next, materiais, lineCtx());
      next = {
        ...next,
        custo_materiais_unit: bd.materiais,
        custo_operacoes_unit: bd.operacoes,
        custo_base_unit: Math.round((bd.compra + bd.materiais) * 100) / 100,
        custo_producao_unit: bd.custo,
        preco_unit: bd.precoCalc,
      };
    }
    l[i] = next;
    upd({ linhas: l, materiais });
  };
  const delLinha = (i) => {
    const linha = orc.linhas[i];
    const linhaId = linha?.id;
    upd({
      linhas: orc.linhas.filter((_, idx) => idx !== i),
      materiais: semMateriaisDaLinha(orc.materiais, linhaId),
    });
  };

  const updOp = (li, oi, patch) => {
    const r = [...(orc.linhas[li].roteiro || [])];
    r[oi] = { ...r[oi], ...patch };
    let linhas = orc.linhas.map((l, idx) => (idx === li ? { ...l, roteiro: r } : l));
    const linha = linhas[li];
    if (linha?.id && linha?.eh_producao) {
      linhas = adaptarLinhaPorReceita(linhas, orc.materiais, linha.id);
    }
    upd({ linhas });
  };
  const addOp = (li) => {
    if (!orc.linhas[li]?.eh_producao) return;
    const r = [...(orc.linhas[li].roteiro || []), { nome: "", maquina_id: "", maquina_nome: "", tempo_maquina: 0, tempo_maquina_unidade: "min", mao_obra_id: "", mao_obra_nome: "", tempo_mao_obra: 0, tempo_mao_obra_unidade: "min" }];
    updLinha(li, { roteiro: r });
  };
  const delOp = (li, oi) => {
    let linhas = orc.linhas.map((l, idx) => (
      idx === li ? { ...l, roteiro: (l.roteiro || []).filter((_, j) => j !== oi) } : l
    ));
    const linha = linhas[li];
    if (linha?.id && linha?.eh_producao) {
      linhas = adaptarLinhaPorReceita(linhas, orc.materiais, linha.id);
    }
    upd({ linhas });
  };

  const persUnit = (l) => (l.personalizacoes || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const artUnidade = (artigoId) => (artigos.find((a) => a.id === artigoId) || {}).unidade || "un";
  const addPers = (i, tipoId) => {
    const t = tipos.find((x) => x.id === tipoId);
    if (!t) return;
    const list = [...(orc.linhas[i].personalizacoes || []), { id: t.id, nome: t.nome, valor: Number(t.valor) || 0, tempo: Number(t.tempo) || 0 }];
    updLinha(i, { personalizacoes: list });
  };
  const updPers = (i, pi, patch) => {
    const list = [...(orc.linhas[i].personalizacoes || [])];
    list[pi] = { ...list[pi], ...patch };
    updLinha(i, { personalizacoes: list });
  };
  const delPers = (i, pi) => updLinha(i, { personalizacoes: (orc.linhas[i].personalizacoes || []).filter((_, idx) => idx !== pi) });

  // --- materiais soltos + da receita ---
  const matValor = (m) => {
    if (m.da_receita) return 0;
    return matCusto(m) * (1 + (Number(m.margem) ?? 50) / 100);
  };
  const updMaterial = (i, patch) => {
    const list = [...(orc.materiais || [])];
    const prev = list[i];
    const next = { ...prev, ...patch };
    next.custo = Math.round(matCusto(next) * 100) / 100;
    // Se editar qtd na receita, actualiza também quantidade_unit (por 1 un. do artigo)
    if (prev?.da_receita && Object.prototype.hasOwnProperty.call(patch, "quantidade")) {
      const qLinha = Number(orc.linhas.find((x) => x.id === prev.linha_origem_id)?.quantidade) || 1;
      next.quantidade_unit = qLinha > 0 ? (Number(patch.quantidade) || 0) / qLinha : Number(patch.quantidade) || 0;
    }
    list[i] = next;
    if (prev?.da_receita && prev.linha_origem_id) {
      const lin = orc.linhas.find((x) => x.id === prev.linha_origem_id);
      if (lin?.eh_producao || lin?.eh_materia_prima) {
        const linhas = adaptarLinhaPorReceita(orc.linhas, list, prev.linha_origem_id);
        upd({ materiais: list, linhas });
        return;
      }
    }
    upd({ materiais: list });
  };
  const addMaterial = (cid) => {
    const c = consumiveis.find((x) => x.id === cid);
    if (!c) return;
    const un = c.unidade || "un";
    const m2 = isM2(un);
    const custoU = custoUnitarioArtigo(c);
    upd({
      materiais: [...(orc.materiais || []), {
        consumivel_id: c.id,
        material_id: c.id,
        nome: c.nome,
        unidade: un,
        custo_unitario: custoU,
        quantidade: m2 ? 1 : 1,
        comprimento_mm: 0,
        largura_mm: 0,
        modo_m2: m2 ? "dimensoes" : "area",
        margem: 50,
        da_receita: false,
      }],
    });
  };
  const delMaterial = (i) => {
    const prev = (orc.materiais || [])[i];
    if (prev?.eh_materia_prima_linha) {
      const siblings = (orc.materiais || []).filter(
        (m) => m.linha_origem_id === prev.linha_origem_id && m.da_receita && m.eh_materia_prima_linha,
      );
      if (siblings.length <= 1) return;
    }
    const list = (orc.materiais || []).filter((_, idx) => idx !== i);
    if (prev?.da_receita && prev.linha_origem_id) {
      upd({
        materiais: list,
        linhas: adaptarLinhaPorReceita(orc.linhas, list, prev.linha_origem_id),
      });
      return;
    }
    upd({ materiais: list });
  };

  const matGlobalIdx = (matId) => (orc.materiais || []).findIndex((m) => m.id === matId);

  const addMaterialLinha = (linha, cid) => {
    const c = consumiveis.find((x) => x.id === cid);
    if (!c || !linha?.id) return;
    const qLinha = Number(linha.quantidade) > 0 ? Number(linha.quantidade) : 1;
    const un = c.unidade || "un";
    const m2 = isM2(un);
    const custoU = custoUnitarioArtigo(c);
    const novo = {
      id: crypto.randomUUID(),
      consumivel_id: c.id,
      material_id: c.id,
      nome: c.nome,
      unidade: un,
      custo_unitario: custoU,
      quantidade: qLinha,
      quantidade_unit: 1,
      comprimento_mm: 0,
      largura_mm: 0,
      modo_m2: m2 ? "dimensoes" : "area",
      margem: 0,
      custo: m2 ? 0 : custoU * qLinha,
      valor: 0,
      da_receita: true,
      artigo_origem_id: linha.artigo_id || "",
      artigo_origem_nome: linha.artigo_nome || "",
      linha_origem_id: linha.id,
    };
    const list = [...(orc.materiais || []), novo];
    upd({
      materiais: list,
      linhas: adaptarLinhaPorReceita(orc.linhas, list, linha.id),
    });
  };

  /** Nova medida do mesmo material (como na receita do artigo). */
  const addMedidaMaterialLinha = (linha, baseMat) => {
    if (!linha?.id || !baseMat) return;
    const qLinha = Number(linha.quantidade) > 0 ? Number(linha.quantidade) : 1;
    const m2 = isM2(baseMat.unidade);
    const novo = {
      id: crypto.randomUUID(),
      consumivel_id: baseMat.consumivel_id || baseMat.material_id,
      material_id: baseMat.material_id || baseMat.consumivel_id,
      nome: baseMat.nome,
      unidade: baseMat.unidade || "un",
      custo_unitario: Number(baseMat.custo_unitario) || 0,
      quantidade: qLinha,
      quantidade_unit: 1,
      comprimento_mm: 0,
      largura_mm: 0,
      modo_m2: m2 ? "dimensoes" : "area",
      margem: 0,
      custo: 0,
      valor: 0,
      da_receita: true,
      artigo_origem_id: linha.artigo_id || baseMat.artigo_origem_id || "",
      artigo_origem_nome: linha.artigo_nome || baseMat.artigo_origem_nome || "",
      linha_origem_id: linha.id,
      eh_materia_prima_linha: !!baseMat.eh_materia_prima_linha,
    };
    const list = [...(orc.materiais || []), novo];
    upd({
      materiais: list,
      linhas: adaptarLinhaPorReceita(orc.linhas, list, linha.id),
    });
  };

  const setModoMedidaMat = (gi, modo) => {
    const m = (orc.materiais || [])[gi];
    if (!m) return;
    if (modo === "dimensoes") {
      updMaterial(gi, {
        modo_m2: "dimensoes",
        quantidade: Number(m.quantidade) > 0 ? m.quantidade : 1,
        comprimento_mm: m.comprimento_mm || "",
        largura_mm: m.largura_mm || "",
      });
      return;
    }
    const comp = Number(m.comprimento_mm) || 0;
    const larg = Number(m.largura_mm) || 0;
    let area = m.quantidade || "";
    if (comp > 0 && larg > 0) {
      const pecas = Number(m.quantidade) > 0 ? Number(m.quantidade) : 1;
      area = Math.round((comp / 1000) * (larg / 1000) * pecas * 10000) / 10000;
    }
    updMaterial(gi, { modo_m2: "area", quantidade: area, comprimento_mm: "", largura_mm: "" });
  };

  /** Agrupa consumos da linha por material (várias medidas). */
  const matsAgrupadosLinha = (mats) => {
    const map = new Map();
    for (const m of mats || []) {
      const key = m.material_id || m.consumivel_id || m.id;
      if (!map.has(key)) {
        map.set(key, {
          key,
          material_id: m.material_id || m.consumivel_id,
          nome: m.nome,
          unidade: m.unidade,
          custo_unitario: m.custo_unitario,
          medidas: [],
        });
      }
      map.get(key).medidas.push(m);
    }
    return [...map.values()];
  };

  const custoOperacao = (op) => {
    const mq = maquinas.find((x) => x.id === op.maquina_id);
    const mo = maoObra.find((x) => x.id === op.mao_obra_id);
    const hMaq = toHours(op.tempo_maquina, op.tempo_maquina_unidade);
    const hMo = toHours(op.tempo_mao_obra, op.tempo_mao_obra_unidade);
    const rateMaq = maqHora(mq);
    const rateMo = mo ? Number(mo.custo_hora) || 0 : 0;
    const cMaq = hMaq * rateMaq;
    const cMo = hMo * rateMo;
    return {
      hMaq,
      hMo,
      rateMaq,
      rateMo,
      cMaq: Math.round(cMaq * 100) / 100,
      cMo: Math.round(cMo * 100) / 100,
      total: Math.round((cMaq + cMo) * 100) / 100,
    };
  };

  const formulaMedida = (m) => {
    const un = (m.unidade || "un").trim() || "un";
    const custoU = Number(m.custo_unitario) || 0;
    const qtdEf = (() => {
      if (isM2(un)) {
        const comp = Number(m.comprimento_mm) || 0;
        const larg = Number(m.largura_mm) || 0;
        const qtd = Number(m.quantidade) || 0;
        if (comp > 0 && larg > 0) return (comp / 1000) * (larg / 1000) * (qtd > 0 ? qtd : 1);
        return qtd;
      }
      return Number(m.quantidade) || 0;
    })();
    const total = matCusto(m);
    const qtdTxt = qtdEf.toLocaleString("pt-PT", { maximumFractionDigits: 4 });
    return `${qtdTxt} ${un} × ${eur(custoU)} = ${eur(total)}`;
  };

  // --- descontos (igual às encomendas: % / €, e € por linha ou por unidade) ---
  const lineGross = (l) => (linePreco(l) + persUnit(l)) * (Number(l.quantidade) || 0);
  const lineDisc = (l) => {
    const qtd = Number(l.quantidade) || 0;
    const unit = linePreco(l) + persUnit(l);
    const base = unit * qtd;
    const d = Number(l.desconto) || 0;
    if (d <= 0 || base <= 0) return 0;
    const tipo = l.desconto_tipo || "pct";
    const porUnidade = (l.desconto_base || "linha") === "unit";
    if (tipo === "eur" && porUnidade) return Math.min(d * qtd, base);
    return tipo === "eur" ? Math.min(d, base) : (base * d) / 100;
  };
  const lineNet = (l) => lineGross(l) - lineDisc(l);

  const subtotalVenda = orc.linhas.reduce((s, l) => s + linePreco(l) * (l.quantidade || 0), 0);
  const subtotalCusto = orc.linhas.reduce((s, l) => s + lineCusto(l) * (l.quantidade || 0), 0);
  const totalPers = orc.linhas.reduce((s, l) => s + persUnit(l) * (l.quantidade || 0), 0);
  const matsSoltos = (orc.materiais || []).filter((m) => !m.da_receita);
  const custoMateriais = matsSoltos.reduce((s, m) => s + matCusto(m), 0);
  const totalMateriais = matsSoltos.reduce((s, m) => s + matValor(m), 0);
  const descontoLinhas = orc.linhas.reduce((s, l) => s + lineDisc(l), 0);
  const subtotalLiquido = subtotalVenda + totalPers + totalMateriais - descontoLinhas;
  const descTotalVal = (() => {
    const d = Number(orc.desconto_total) || 0;
    if (d <= 0) return 0;
    return orc.desconto_total_tipo === "eur" ? Math.min(d, subtotalLiquido) : (subtotalLiquido * d) / 100;
  })();
  const total = subtotalLiquido - descTotalVal;
  const lucro = total - subtotalCusto - custoMateriais;
  const linhasAbaixoCusto = orc.linhas.filter((l) => l.artigo_id && linePreco(l) < lineCusto(l)).length;

  const linhaPronta = (l) => {
    if (!l) return false;
    if (l.artigo_id) return true;
    if ((l.tipo_linha === "descritor" || l.descricao_livre) && (l.artigo_nome || "").trim()) return true;
    return !!(l.artigo_nome || "").trim();
  };
  const requisitosFinalizar = (() => {
    if (orcTemNumero(orc)) return [];
    const faltas = [];
    if (!(orc.cliente_id || (orc.cliente || "").trim())) faltas.push("Selecione o cliente");
    if (!(orc.linhas || []).some(linhaPronta)) faltas.push("Adicione pelo menos uma linha (artigo, serviço ou descritor)");
    const errDatas = orcErroDatas(orc, { aoFinalizar: true });
    if (errDatas) faltas.push(errDatas);
    return faltas;
  })();
  const requisitosEncomenda = (() => {
    if (orc.encomenda_id) return [];
    const faltas = [];
    if (!orcTemNumero(orc)) faltas.push("Finalize o orçamento para obter o número");
    if (!(orc.cliente_id || (orc.cliente || "").trim())) faltas.push("Selecione o cliente");
    if (!(orc.linhas || []).some(linhaPronta)) faltas.push("Adicione pelo menos uma linha (artigo, serviço ou descritor)");
    if (orc.status !== "aceite" && orc.status !== "ganho") faltas.push("Passe o estado para Ganho");
    return faltas;
  })();

  const bodyFrom = (o) => ({
    cliente: o.cliente,
    cliente_id: o.cliente_id || null,
    contacto_id: o.contacto_id || null,
    contacto_nome: o.contacto_nome || "",
    contacto_email: o.contacto_email || "",
    contacto_telefone: o.contacto_telefone || "",
    contacto_cargo: o.contacto_cargo || "",
    contacto_departamento: o.contacto_departamento || "",
    descricao: o.descricao || "",
    numero_encomenda: o.numero_encomenda || "",
    data: o.data,
    validade: o.validade,
    status: o.status,
    notas: o.notas || "",
    imagens: o.imagens || [],
    desconto_total: Number(o.desconto_total) || 0,
    desconto_total_tipo: o.desconto_total_tipo || "pct",
    linhas: (o.linhas || [])
      .filter((l) => l.artigo_id || ((l.tipo_linha === "descritor" || l.descricao_livre) && (l.artigo_nome || "").trim()))
      .map((l) => ({
      ...l,
      id: l.id || crypto.randomUUID(),
      artigo_id: l.artigo_id || "",
      artigo_codigo: l.artigo_codigo || "",
      tipo_linha: l.tipo_linha || "",
      descricao_livre: !!l.descricao_livre || l.tipo_linha === "descritor",
      quantidade: Number(l.quantidade) || 0,
      desconto: Number(l.desconto) || 0,
      desconto_tipo: l.desconto_tipo || "pct",
      desconto_base: l.desconto_base === "unit" ? "unit" : "linha",
      personalizacoes: (l.personalizacoes || []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor) || 0 })),
      valor_personalizacao: persUnit(l),
      preco_unit: Number(l.preco_unit) || 0,
      preco_unit_manual: !!l.preco_unit_manual,
      preco_origem: l.preco_origem || (l.preco_unit_manual ? "manual" : "catalogo"),
      preco_venda_catalogo: l.preco_venda_catalogo != null ? Number(l.preco_venda_catalogo) : undefined,
      eh_materia_prima: !!l.eh_materia_prima,
      eh_servico: !!l.eh_servico,
      eh_producao: !!l.eh_producao,
      modo_calculo: l.modo_calculo || "",
      custo_compra_unit: l.custo_compra_unit != null ? Number(l.custo_compra_unit) : undefined,
      custo_materiais_unit: l.custo_materiais_unit != null ? Number(l.custo_materiais_unit) : undefined,
      custo_operacoes_unit: l.custo_operacoes_unit != null ? Number(l.custo_operacoes_unit) : undefined,
      margem: Number(l.margem) || 0,
    })),
    materiais: (o.materiais || []).map((m) => ({
      ...m,
      consumivel_id: m.consumivel_id || m.material_id || "",
      material_id: m.material_id || m.consumivel_id || "",
      custo_unitario: Number(m.custo_unitario) || 0,
      quantidade: Number(m.quantidade) || 0,
      comprimento_mm: Number(m.comprimento_mm) || 0,
      largura_mm: Number(m.largura_mm) || 0,
      margem: m.da_receita ? 0 : (Number(m.margem) || 0),
      da_receita: !!m.da_receita,
      artigo_origem_id: m.artigo_origem_id || null,
      artigo_origem_nome: m.artigo_origem_nome || "",
      linha_origem_id: m.linha_origem_id || null,
      quantidade_unit: m.quantidade_unit != null ? Number(m.quantidade_unit) : null,
      eh_materia_prima_linha: !!m.eh_materia_prima_linha,
    })),
  });

  const payloadFrom = (o) => {
    const payload = bodyFrom(o);
    if (!orcTemNumero(o)) payload.status = "rascunho";
    return payload;
  };

  const save = async ({ silent = false } = {}) => {
    const errDatas = orcErroDatas(orc);
    if (errDatas) {
      toast.error(errDatas);
      return false;
    }
    await api.put(`/orcamentos/${id}`, payloadFrom(orc));
    await load();
    if (!silent) toast.success("Orçamento guardado");
    return true;
  };

  const temNumero = orcTemNumero(orc);
  const temCliente = !!(orc.cliente_id || (orc.cliente || "").trim());
  const st = orcStatus(orc);
  const editavel = orcEditavel(orc);
  const versoes = orc.versoes || [];

  const setStatus = async (status) => {
    try {
      await api.put(`/orcamentos/${id}`, payloadFrom({ ...orc, status }));
      toast.success(status === "ganho" ? "Orçamento ganho" : status === "perdido" ? "Orçamento perdido" : status === "enviado" ? "Marcado como enviado" : "Estado actualizado");
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Não foi possível alterar o estado");
    }
  };

  const negociar = async () => {
    try {
      if (editavel) {
        const ok = await save({ silent: true });
        if (!ok) return;
      }
      const o = await api.post(`/orcamentos/${id}/negociar`);
      toast.success(`Negociação ${o.numero} V${o.versao}`);
      setViewVersao(null);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Não foi possível abrir a negociação");
    }
  };

  const finalizar = async () => {
    if (requisitosFinalizar.length > 0) {
      setShowRequisitosFinalizar(true);
      toast.error(requisitosFinalizar[0]);
      return;
    }
    try {
      const ok = await save({ silent: true });
      if (!ok) return;
      const o = await api.post(`/orcamentos/${id}/finalizar`);
      toast.success(`Orçamento ${o.numero} criado`);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((x) => x.msg || x).join("; ")
        : (typeof detail === "string" ? detail : "Não foi possível finalizar");
      toast.error(msg);
      setShowRequisitosFinalizar(true);
    }
  };

  const converter = async () => {
    if (requisitosEncomenda.length > 0) {
      setShowRequisitosEncomenda(true);
      toast.error(requisitosEncomenda[0]);
      return;
    }
    const init = {};
    (orc.linhas || []).filter(orcLinhaPronta).forEach((l) => {
      init[l.id] = Number(l.preco_unit) || 0;
    });
    setPrecosEncomenda(init);
    setShowConverterPrecos(true);
  };

  const confirmarConverter = async () => {
    const linhas = (orc.linhas || []).filter(orcLinhaPronta);
    for (const l of linhas) {
      const piso = Number(l.preco_unit) || 0;
      const p = Number(precosEncomenda[l.id]);
      if (Number.isNaN(p) || p + 0.001 < piso) {
        toast.error(`O preço de «${l.artigo_nome || "artigo"}» não pode ser inferior ao do orçamento (${eur(piso)})`);
        return;
      }
    }
    const precos = {};
    linhas.forEach((l) => { precos[l.id] = Number(precosEncomenda[l.id]); });
    setConverting(true);
    try {
      const enc = await api.post(`/orcamentos/${id}/converter`, { precos });
      setShowConverterPrecos(false);
      toast.success(`Encomenda ${enc.numero} criada`);
      nav(`/encomendas/${enc.id}`);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setShowRequisitosEncomenda(true);
      toast.error(typeof detail === "string" ? detail : "Erro ao converter");
    } finally {
      setConverting(false);
    }
  };

  return (
    <div>
      <StickyDetailHeader
        back={<StickyBackButton onClick={() => nav("/orcamentos")} testid="orcamento-back-btn" label="Voltar aos orçamentos" />}
        title={orcNumeroLabel(orc)}
        badges={<StatusBadge status={st} testid="orcamento-status-badge" />}
        subtitle={orc.cliente ? `Orçamento · ${orc.cliente}` : "Orçamento em rascunho"}
        actions={
          <>
            {!temNumero && can("orcamentos", "edit") && (
              <button data-testid="finalizar-orcamento-btn" onClick={finalizar} className="bg-black text-white hover:bg-gray-800 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <CheckCircle2 size={15} /> Finalizar
              </button>
            )}
            {temNumero && can("orcamentos", "edit") && st !== "ganho" && st !== "perdido" && (
              <button data-testid="orc-status-enviado" onClick={() => setStatus("enviado")} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Send size={15} /> Enviado
              </button>
            )}
            {temNumero && can("orcamentos", "edit") && (st === "criado" || st === "enviado" || st === "perdido") && (
              <button data-testid="orc-negociar-btn" onClick={negociar} className="bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Handshake size={15} /> Negociar
              </button>
            )}
            {temNumero && can("orcamentos", "edit") && st === "negociado" && (
              <button data-testid="orc-nova-versao-btn" onClick={negociar} className="bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <GitBranch size={15} /> Nova versão
              </button>
            )}
            {temNumero && can("orcamentos", "edit") && st !== "ganho" && (
              <button data-testid="orc-status-ganho" onClick={() => setStatus("ganho")} className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Trophy size={15} /> Ganho
              </button>
            )}
            {temNumero && can("orcamentos", "edit") && st !== "perdido" && st !== "ganho" && (
              <button data-testid="orc-status-perdido" onClick={() => setStatus("perdido")} className="bg-white text-red-700 border border-red-300 hover:bg-red-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <Ban size={15} /> Perdido
              </button>
            )}
            {temNumero && <PdfExportButton modulo="orcamento" recordId={id} />}
            {temNumero && can("orcamentos", "edit") && (
              <EnviarEmailButton
                variant="orcamento"
                recordId={id}
                defaultTo={clienteEmail}
                clienteNome={orc.cliente}
                onSent={(res) => {
                  setOrc((o) => ({ ...o, status: res?.status || "enviado" }));
                  load();
                }}
              />
            )}
            {orc.encomenda_id && (
              <Link to={`/encomendas/${orc.encomenda_id}`} data-testid="goto-encomenda-link" className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                <ClipboardList size={15} /> {orc.encomenda_numero}
              </Link>
            )}
            {temNumero && !orc.encomenda_id && can("encomendas", "create") && orcIsGanho(orc) && (
              <button
                data-testid="convert-quote-btn"
                onClick={converter}
                className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors"
              >
                <ClipboardList size={15} /> Criar Encomenda
              </button>
            )}
            {editavel && can("orcamentos", "edit") && (
              <button data-testid="save-orcamento-btn" onClick={() => save()} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors">
                <Save size={15} /> Guardar
              </button>
            )}
          </>
        }
      />

      <DetailTabs
        testid="orcamento-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "orcamento", label: "Orçamento", testid: "orc-tab-orcamento" },
          { id: "ficheiros", label: "Ficheiros", testid: "orc-tab-ficheiros" },
          { id: "historico", label: "Histórico", testid: "orc-tab-historico" },
        ]}
      />

      {tab === "orcamento" && (
        <>
      {/* Meta */}
      <div className={`bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 ${editavel ? "" : "pointer-events-none opacity-70"}`}>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Descrição</label>
          <input data-testid="orc-descricao-input" value={orc.descricao || ""} onChange={(e) => upd({ descricao: e.target.value })} placeholder="Descrição do orçamento" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Referência cliente</label>
          <input data-testid="orc-encomenda-input" value={orc.numero_encomenda || ""} onChange={(e) => upd({ numero_encomenda: e.target.value })} placeholder="Referência do cliente" className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
        </div>
      </div>

      {showRequisitosFinalizar && !temNumero && requisitosFinalizar.length > 0 && (
        <div data-testid="orc-requisitos-finalizar" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-4 py-2.5 mb-3 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-medium">Para finalizar o orçamento:</p>
            <ul className="mt-1 list-disc list-inside text-amber-800/90 space-y-0.5">
              {requisitosFinalizar.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showRequisitosEncomenda && !orc.encomenda_id && requisitosEncomenda.length > 0 && (
        <div data-testid="orc-requisitos-encomenda" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-4 py-2.5 mb-3 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-medium">Para criar a encomenda:</p>
            <ul className="mt-1 list-disc list-inside text-amber-800/90 space-y-0.5">
              {requisitosEncomenda.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Meta */}
      <div className={`bg-white border border-gray-200 rounded-sm p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${editavel ? "" : "pointer-events-none opacity-70"}`}>
        <div className={showRequisitosFinalizar && !temCliente ? "ring-2 ring-amber-400 rounded-sm" : ""}>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Cliente</label>
          <ClienteSelector
            value={orc.cliente_id}
            onChange={async (cid, nome, cli) => {
              const next = {
                ...orc,
                cliente_id: cid,
                cliente: nome,
                contacto_id: null,
                contacto_nome: "",
                contacto_email: "",
                contacto_telefone: "",
                contacto_cargo: "",
                contacto_departamento: "",
              };
              // Sugerir desconto comercial da empresa se ainda não houver desconto no doc
              if (cli?.tipo === "empresa" && cli.desconto_comercial_pct != null && !(Number(orc.desconto_total) > 0)) {
                next.desconto_total = Number(cli.desconto_comercial_pct) || 0;
                next.desconto_total_tipo = "pct";
              }
              setOrc(next);
              setClienteDoc(cli || null);
              setClienteEmail(cli?.email || "");
              if (cid) setShowRequisitosFinalizar(false);
              try {
                await api.put(`/orcamentos/${id}`, payloadFrom(next));
              } catch {
                toast.error("Não foi possível associar o cliente");
              }
            }}
            testid="orc-cliente-select"
          />
        </div>
        {(clienteDoc?.tipo === "empresa" || (clienteDoc?.contactos || []).length > 0 || orc.contacto_nome) && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">À atenção de</label>
            <ContactoSelector
              contactos={clienteDoc?.contactos || []}
              value={orc.contacto_id}
              disabled={!editavel || !orc.cliente_id}
              onChange={async (cid, c) => {
                const next = {
                  ...orc,
                  contacto_id: cid,
                  contacto_nome: c?.nome || "",
                  contacto_email: c?.email || "",
                  contacto_telefone: c?.telefone || "",
                  contacto_cargo: c?.cargo || "",
                  contacto_departamento: c?.departamento || "",
                };
                setOrc(next);
                setClienteEmail(c?.email || clienteDoc?.email || "");
                try {
                  await api.put(`/orcamentos/${id}`, payloadFrom(next));
                } catch {
                  toast.error("Não foi possível definir o contacto");
                }
              }}
              testid="orc-contacto-select"
            />
          </div>
        )}
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Data</label>
          <input
            data-testid="orc-data-input"
            type="date"
            value={orc.data || ""}
            min={st === "rascunho" ? ymdHoje() : undefined}
            max={st === "rascunho" ? ymdHoje() : undefined}
            onChange={(e) => {
              const data = e.target.value;
              const patch = { data };
              if (orc.validade && data && orc.validade < data) patch.validade = data;
              upd(patch);
            }}
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1.5 block">Validade</label>
          <input
            data-testid="orc-validade-input"
            type="date"
            value={orc.validade || ""}
            min={orc.data || ymdHoje()}
            onChange={(e) => {
              const validade = e.target.value;
              if (orc.data && validade && validade < orc.data) {
                toast.error("A validade não pode ser anterior à data do orçamento");
                return;
              }
              upd({ validade });
            }}
            disabled={!editavel}
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black disabled:bg-gray-50"
          />
        </div>
      </div>

      {/* Linhas */}
      {linhasAbaixoCusto > 0 && (
        <div data-testid="orc-alerta-margem" className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-sm px-4 py-2.5 mb-3 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span><strong>{linhasAbaixoCusto}</strong> {linhasAbaixoCusto === 1 ? "linha está" : "linhas estão"} com preço abaixo do custo de produção — está a vender a perder.</span>
        </div>
      )}
      <div className={`bg-white border border-gray-200 rounded-sm overflow-hidden mb-4 ${editavel ? "" : "pointer-events-none opacity-70"}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText size={16} /> Linhas do Orçamento
            <span className="text-xs font-normal tabular-nums text-gray-400">{orc.linhas.length}</span>
          </div>
        </div>
        <div className="overflow-auto max-h-[min(55vh,28rem)] lg:max-h-[min(65vh,32rem)] isolate">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
            <tr className="border-b border-gray-200">
              <th className="text-left px-2 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[9rem] bg-white sticky top-0 z-20">Código</th>
              <th className="text-left px-2 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[24%] bg-white sticky top-0 z-20">Descrição</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 w-[16%] bg-white sticky top-0 z-20">Personalização</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Pers. €/un</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Qtd</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Preço Unit.</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Unit. c/Pers</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Desconto</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500 bg-white sticky top-0 z-20">Subtotal</th>
              <th className="px-4 py-2.5 w-12 bg-white sticky top-0 z-20"></th>
            </tr>
          </thead>
          <tbody data-testid="orc-linhas">
            {orc.linhas.map((l, i) => (
              <Fragment key={l.id || i}>
              <tr
                className={`border-b border-gray-100 ${l.artigo_id ? "cursor-pointer hover:bg-gray-50/80" : ""} ${openOps[i] ? "bg-slate-50/60" : ""}`}
                onClick={(e) => {
                  if (!l.artigo_id) return;
                  if (e.target.closest("input, select, textarea, button, a, [role='combobox'], [role='button'], [data-radix-popper-content-wrapper]")) return;
                  setOpenOps((o) => ({ ...o, [i]: !o[i] }));
                }}
                data-testid={`line-row-${i}`}
              >
                <td className="px-2 py-2.5 align-top">
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      data-testid={`line-ops-toggle-${i}`}
                      disabled={!l.artigo_id}
                      title={openOps[i] ? "Minimizar linha" : "Expandir linha"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!l.artigo_id) return;
                        setOpenOps((o) => ({ ...o, [i]: !o[i] }));
                      }}
                      className={`mt-0.5 p-1 rounded-sm shrink-0 transition-colors ${
                        l.artigo_id
                          ? "text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                          : "text-gray-300 cursor-default"
                      }`}
                    >
                      {openOps[i] ? <ChevronDown size={18} strokeWidth={2.2} /> : <ChevronRight size={18} strokeWidth={2.2} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <LinhaCodigoSelect
                        artigos={artigos}
                        linha={l}
                        testid={`line-codigo-${i}`}
                        onArtigosRefresh={reloadArtigos}
                        onPick={(a, opts) => applyArtigoLinha(i, a, opts)}
                      />
                      {l.artigo_id && (() => {
                        const bd = lineBd(l);
                        return (
                          <div className="mt-1 text-[11px] text-gray-500 tabular-nums truncate pointer-events-none" title="Custo → preço">
                            {eur(bd.custo)} custo
                            <span className="text-gray-300 mx-0.5">·</span>
                            {l.margem ?? 0}%
                            <span className="text-gray-300 mx-0.5">→</span>
                            {eur(linePreco(l))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5 align-top">
                  <div className="flex items-start gap-2">
                    <ImagemUpload value={l.imagem} onChange={(p) => updLinha(i, { imagem: p })} size={36} editable={false} testid={`line-imagem-${i}`} />
                    <div className="flex-1 min-w-0">
                      <LinhaDescricaoInput
                        value={l.artigo_nome}
                        codigo={l.artigo_codigo || (artigos.find((a) => a.id === l.artigo_id) || {}).codigo}
                        showRef={!!l.descricao_livre || l.tipo_linha === "descritor" || isDiversosArtigo(artigos.find((a) => a.id === l.artigo_id))}
                        testid={`line-descricao-${i}`}
                        onChange={(v) => updLinha(i, { artigo_nome: v, descricao_livre: true })}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="space-y-1.5" data-testid={`line-pers-list-${i}`}>
                    {(l.personalizacoes || []).map((p, pi) => (
                      <div key={`${p.id || p.nome}-${pi}`} data-testid={`line-pers-${i}-${pi}`} className="flex items-center gap-1.5 bg-gray-100 rounded-sm pl-2 pr-1 py-1">
                        <span className="flex-1 text-xs text-gray-700 truncate" title={p.nome}>{p.nome}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <input data-testid={`line-pers-valor-${i}-${pi}`} type="number" step="0.01" value={p.valor ?? 0} onChange={(e) => updPers(i, pi, { valor: e.target.value })} className="w-16 text-right border border-gray-300 rounded-sm px-1 py-0.5 text-xs tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                          <span className="text-[10px] text-gray-400">€</span>
                          <button data-testid={`line-pers-del-${i}-${pi}`} onClick={() => delPers(i, pi)} className="p-0.5 rounded-sm hover:bg-red-100 text-red-600"><X size={12} /></button>
                        </div>
                      </div>
                    ))}
                    <select data-testid={`line-pers-add-${i}`} value="" onChange={(e) => { if (e.target.value) addPers(i, e.target.value); e.target.value = ""; }} className="w-full border border-dashed border-gray-300 rounded-sm px-2 py-1.5 text-xs bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-black/20">
                      <option value="">+ Pers.…</option>
                      {tipos.map((t) => <option key={t.id} value={t.id}>{`${t.nome} (${eur(t.valor)})`}</option>)}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 align-top" data-testid={`line-pers-total-${i}`}>{eur(persUnit(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-1.5 justify-end">
                    <input data-testid={`line-qtd-${i}`} type="number" min="0" value={l.quantidade} onChange={(e) => updLinha(i, { quantidade: e.target.value })} className="w-20 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    {l.artigo_id && <span className="text-xs text-gray-400 shrink-0">{artUnidade(l.artigo_id)}</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top" data-testid={`line-preco-${i}`}>
                  <div className="flex items-center gap-1 justify-end">
                    <input data-testid={`line-preco-input-${i}`} type="number" min="0" step="0.01" value={l.preco_unit_manual ? (l.preco_unit ?? 0) : Number(linePreco(l).toFixed(2))} onChange={(e) => updLinha(i, { preco_unit: e.target.value, preco_unit_manual: true, preco_origem: "manual" })} className="w-24 text-right border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
                    {(l.preco_unit_manual || l.preco_origem === "calculado") && !(l.descricao_livre || l.tipo_linha === "descritor" || isDiversosArtigo(artigos.find((a) => a.id === l.artigo_id))) && (
                      <button data-testid={`line-preco-reset-${i}`} onClick={() => {
                        const pv = Number(l.preco_venda_catalogo) || precoVendaArtigo(l);
                        updLinha(i, { preco_unit_manual: false, preco_origem: "catalogo", preco_unit: pv });
                      }} title="Repor preço de venda do artigo" className="p-1 rounded-sm hover:bg-gray-100 text-gray-500"><RotateCcw size={13} /></button>
                    )}
                  </div>
                  {linePreco(l) < lineCusto(l) && <div data-testid={`line-abaixo-custo-${i}`} className="text-[10px] text-red-600 font-medium text-right mt-0.5 flex items-center justify-end gap-1"><AlertTriangle size={10} /> &lt; custo</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 align-top" data-testid={`line-unit-pers-${i}`}>{eur(linePreco(l) + persUnit(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1 justify-end">
                      <input data-testid={`line-desc-${i}`} type="number" min="0" step="0.01" value={l.desconto ?? 0} onChange={(e) => updLinha(i, { desconto: e.target.value })} className="w-14 text-right border border-gray-300 rounded-sm px-1.5 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                      <select data-testid={`line-desc-tipo-${i}`} value={l.desconto_tipo || "pct"} onChange={(e) => updLinha(i, { desconto_tipo: e.target.value })} className="border border-gray-300 rounded-sm px-1 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                        <option value="pct">%</option>
                        <option value="eur">€</option>
                      </select>
                    </div>
                    <label
                      className="inline-flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none"
                      title="Se marcado, o desconto em € aplica-se por unidade; senão ao total da linha"
                    >
                      <input
                        data-testid={`line-desc-unit-${i}`}
                        type="checkbox"
                        checked={(l.desconto_base || "linha") === "unit"}
                        onChange={(e) => updLinha(i, { desconto_base: e.target.checked ? "unit" : "linha" })}
                        className="w-3 h-3 accent-black"
                      />
                      por un.
                    </label>
                    {lineDisc(l) > 0 && <div className="text-[10px] text-red-500 text-right">- {eur(lineDisc(l))}</div>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium align-top" data-testid={`line-subtotal-${i}`}>{eur(lineNet(l))}</td>
                <td className="px-4 py-2.5 align-top">
                  <button data-testid={`delete-line-${i}`} onClick={() => delLinha(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
              {openOps[i] && l.artigo_id && (() => {
                const bd = lineBd(l);
                const regras = regrasLinha(l);
                const modo = modoLinha(l);
                const artUn = artUnidade(l.artigo_id);
                const precoBaseMP = bd.materiaisLinhas[0]?.custo_unitario ?? (Number(l.preco_venda_catalogo) || 0);
                const custoLabel = regras.custoLabel || "Compra";
                const origem =
                  l.preco_unit_manual || l.preco_origem === "manual"
                    ? "manual"
                    : l.preco_origem === "calculado"
                      ? "calc."
                      : "catálogo";
                return (
                <tr className="bg-slate-50 border-b border-gray-100">
                  <td colSpan={10} className="px-3 py-2.5 space-y-2">
                    {/* Fórmula numa linha */}
                    <div
                      data-testid={`line-calc-${i}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs bg-white border border-gray-200 rounded-sm px-2.5 py-2"
                    >
                      {regras.showConsumoBreakdown ? (
                        <>
                          <span className="text-gray-400 shrink-0">Preço base</span>
                          <span className="tabular-nums font-medium">{eur(precoBaseMP)}/{artUn}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-400 shrink-0">Consumo</span>
                          <span className="tabular-nums font-medium" data-testid={`line-calc-mats-${i}`}>{eur(bd.materiais)}</span>
                        </>
                      ) : regras.showFullBreakdown ? (
                        <>
                          <span className="text-gray-400 shrink-0">Compra</span>
                          <span className="tabular-nums font-medium" data-testid={`line-calc-compra-${i}`}>{eur(bd.compra)}</span>
                          <span className="text-gray-300">+</span>
                          <span className="text-gray-400 shrink-0">Mats</span>
                          <span className="tabular-nums font-medium" data-testid={`line-calc-mats-${i}`}>{eur(bd.materiais)}</span>
                          <span className="text-gray-300">+</span>
                          <span className="text-gray-400 shrink-0">Ops</span>
                          <span className="tabular-nums font-medium" data-testid={`line-calc-ops-${i}`}>{eur(bd.operacoes)}</span>
                        </>
                      ) : regras.showSimpleCusto ? (
                        <>
                          <span className="text-gray-400 shrink-0">{custoLabel}</span>
                          <span className="tabular-nums font-medium" data-testid={`line-calc-compra-${i}`}>{eur(bd.compra)}</span>
                        </>
                      ) : null}
                      <span className="text-gray-300">=</span>
                      <span className="text-gray-700 font-semibold shrink-0">Custo</span>
                      <span className="tabular-nums font-semibold" data-testid={`line-calc-custo-${i}`}>{eur(bd.custo)}</span>
                      <span className="text-gray-300 mx-0.5">|</span>
                      <span className="text-gray-400 shrink-0">Margem</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        data-testid={`line-margem-${i}`}
                        value={l.margem ?? 0}
                        onChange={(e) => updLinha(i, { margem: e.target.value })}
                        className="w-14 border border-gray-300 rounded-sm px-1 py-0.5 text-xs tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-black/20"
                      />
                      <span className="text-gray-400">%</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-emerald-700 font-semibold tabular-nums" data-testid={`line-calc-preco-${i}`}>{eur(linePreco(l))}</span>
                      <span className="text-[10px] text-gray-400 ml-auto">{origem}{regras.showFullBreakdown && bd.precoCatalogo ? ` · cat. ${eur(bd.precoCatalogo)}` : ""}</span>
                    </div>

                    {(() => {
                      const panel = regras.showOps ? (linePanel[i] || "mats") : "mats";
                      const nMats = bd.materiaisLinhas.length;
                      const nOps = (l.roteiro || []).length;
                      const showTabs = regras.showMateriaisTab && regras.showOps;
                      return (
                        <div>
                          {showTabs && (
                          <div
                            className="grid grid-cols-2 gap-1 p-1 mb-3 bg-gray-100 border border-gray-200 rounded-sm"
                            data-testid={`line-panel-tabs-${i}`}
                            role="tablist"
                            aria-label="Detalhe da linha"
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={panel === "mats"}
                              data-testid={`line-panel-mats-${i}`}
                              onClick={() => setLinePanel((p) => ({ ...p, [i]: "mats" }))}
                              className={`rounded-sm px-3 py-2 text-left transition-all ${
                                panel === "mats"
                                  ? "bg-white border border-gray-200 shadow-sm text-gray-900"
                                  : "border border-transparent text-gray-500 hover:bg-white/70 hover:text-gray-800"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Layers size={15} className={panel === "mats" ? "text-gray-900" : "text-gray-400"} />
                                <span className={`text-sm ${panel === "mats" ? "font-semibold" : "font-medium"}`}>Materiais</span>
                              </div>
                              <div className={`mt-0.5 pl-[23px] text-[11px] tabular-nums ${panel === "mats" ? "text-gray-600 font-medium" : "text-gray-400"}`}>
                                {eur(bd.materiais)}
                                {nMats > 0 && <span className="ml-1">· {nMats} {nMats === 1 ? "item" : "itens"}</span>}
                              </div>
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={panel === "ops"}
                              data-testid={`line-panel-ops-${i}`}
                              onClick={() => setLinePanel((p) => ({ ...p, [i]: "ops" }))}
                              className={`rounded-sm px-3 py-2 text-left transition-all ${
                                panel === "ops"
                                  ? "bg-white border border-gray-200 shadow-sm text-gray-900"
                                  : "border border-transparent text-gray-500 hover:bg-white/70 hover:text-gray-800"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Cog size={15} className={panel === "ops" ? "text-gray-900" : "text-gray-400"} />
                                <span className={`text-sm ${panel === "ops" ? "font-semibold" : "font-medium"}`}>Operações</span>
                              </div>
                              <div className={`mt-0.5 pl-[23px] text-[11px] tabular-nums ${panel === "ops" ? "text-gray-600 font-medium" : "text-gray-400"}`}>
                                {eur(bd.operacoes)}
                                {nOps > 0 && <span className="ml-1">· {nOps} {nOps === 1 ? "op." : "ops."}</span>}
                              </div>
                            </button>
                          </div>
                          )}

                          {regras.showMedidas && !showTabs && (
                            <div className="mb-2 px-1">
                              <span className="text-sm font-semibold text-gray-800">Medidas de consumo</span>
                              <span className="ml-2 text-[11px] text-gray-500 tabular-nums">{eur(bd.materiais)} · {artUn}</span>
                            </div>
                          )}

                          {regras.showMateriaisTab && panel === "mats" && (
                            <div>
                              {regras.allowAddMaterial && (
                              <div className="flex items-center justify-end mb-1 gap-2">
                                <select
                                  data-testid={`line-add-mat-${i}`}
                                  value=""
                                  onChange={(e) => { if (e.target.value && regras.allowAddMaterial) addMaterialLinha(l, e.target.value); e.target.value = ""; }}
                                  className="border border-dashed border-gray-300 rounded-sm px-1.5 py-0.5 text-[11px] bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-black/20 max-w-[14rem]"
                                >
                                  <option value="">+ Material…</option>
                                  {consumiveis.map((c) => (
                                    <option key={c.id} value={c.id}>{c.nome} · {eur(c.custo_unitario)}/{c.unidade || "un"}</option>
                                  ))}
                                </select>
                              </div>
                              )}
                              <div className="space-y-2" data-testid={`line-mats-${i}`}>
                                {matsAgrupadosLinha(bd.materiaisLinhas).map((grp) => {
                                  const unMat = (grp.unidade || "un").trim() || "un";
                                  const m2 = isM2(unMat);
                                  const totalGrp = grp.medidas.reduce((s, m) => s + matCusto(m), 0);
                                  return (
                                    <div key={grp.key} className="bg-white border border-gray-200 rounded-sm px-2 py-1.5 space-y-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="text-[11px] font-medium text-gray-800 truncate">{grp.nome}</div>
                                          <div className="text-[10px] text-gray-500 tabular-nums">
                                            Preço base: <span className="font-medium text-gray-700">{eur(grp.custo_unitario)}/{unMat}</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="text-[11px] tabular-nums font-semibold text-gray-800">{eur(totalGrp)}</span>
                                          <button
                                            type="button"
                                            data-testid={`line-add-medida-${i}-${grp.key}`}
                                            onClick={() => addMedidaMaterialLinha(l, grp.medidas[0])}
                                            className="text-[10px] font-medium text-gray-800 hover:underline"
                                          >
                                            + Medida
                                          </button>
                                        </div>
                                      </div>
                                      {grp.medidas.map((m, mi) => {
                                        const gi = matGlobalIdx(m.id);
                                        if (gi < 0) return null;
                                        const modo = m.modo_m2 === "dimensoes" || (Number(m.comprimento_mm) > 0 && Number(m.largura_mm) > 0)
                                          ? "dimensoes"
                                          : "area";
                                        const temDim = modo === "dimensoes";
                                        return (
                                          <div key={m.id} className="border border-gray-100 rounded-sm bg-gray-50/80 px-1.5 py-1.5 space-y-1">
                                            <div className="flex items-center justify-between gap-1">
                                              <span className="text-[10px] text-gray-500">Medida {mi + 1}</span>
                                              <div className="flex items-center gap-1">
                                                {m2 && (
                                                  <div className="inline-flex rounded-sm border border-gray-300 overflow-hidden text-[10px]">
                                                    <button
                                                      type="button"
                                                      onClick={() => setModoMedidaMat(gi, "area")}
                                                      className={`px-1.5 py-0.5 ${modo === "area" ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}
                                                    >
                                                      Área (m²)
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => setModoMedidaMat(gi, "dimensoes")}
                                                      className={`px-1.5 py-0.5 border-l border-gray-300 ${modo === "dimensoes" ? "bg-gray-900 text-white" : "bg-white text-gray-600"}`}
                                                    >
                                                      L×A (mm)
                                                    </button>
                                                  </div>
                                                )}
                                        {grp.medidas.length > 1 && (
                                          <button type="button" onClick={() => delMaterial(gi)} className="p-0.5 rounded-sm hover:bg-red-100 text-red-600" title="Remover medida">
                                            <X size={11} />
                                          </button>
                                        )}
                                        {grp.medidas.length === 1 && regras.allowAddMaterial && (
                                          <button type="button" onClick={() => delMaterial(gi)} className="p-0.5 rounded-sm hover:bg-red-100 text-red-600" title="Remover material">
                                            <X size={11} />
                                          </button>
                                        )}
                                              </div>
                                            </div>
                                            <div className={`grid gap-1.5 ${temDim ? "grid-cols-3" : "grid-cols-1 max-w-[10rem]"}`}>
                                              {temDim ? (
                                                <>
                                                  <div>
                                                    <label className="text-[10px] text-gray-500 block mb-0.5">Comp. (mm)</label>
                                                    <input type="number" min="0" value={m.comprimento_mm ?? 0} onChange={(e) => updMaterial(gi, { comprimento_mm: e.target.value, modo_m2: "dimensoes" })} className="w-full border border-gray-200 rounded-sm px-1.5 py-1 text-[11px] text-right tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                                                  </div>
                                                  <div>
                                                    <label className="text-[10px] text-gray-500 block mb-0.5">Larg. (mm)</label>
                                                    <input type="number" min="0" value={m.largura_mm ?? 0} onChange={(e) => updMaterial(gi, { largura_mm: e.target.value, modo_m2: "dimensoes" })} className="w-full border border-gray-200 rounded-sm px-1.5 py-1 text-[11px] text-right tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                                                  </div>
                                                  <div>
                                                    <label className="text-[10px] text-gray-500 block mb-0.5">Peças (un)</label>
                                                    <input type="number" min="0" step="1" value={m.quantidade ?? 0} onChange={(e) => updMaterial(gi, { quantidade: e.target.value, modo_m2: "dimensoes" })} className="w-full border border-gray-200 rounded-sm px-1.5 py-1 text-[11px] text-right tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                                                  </div>
                                                </>
                                              ) : (
                                                <div>
                                                  <label className="text-[10px] text-gray-500 block mb-0.5">Qtd ({unMat})</label>
                                                  <input type="number" min="0" step="0.01" value={m.quantidade ?? 0} onChange={(e) => updMaterial(gi, { quantidade: e.target.value, comprimento_mm: "", largura_mm: "", modo_m2: "area" })} className="w-full border border-gray-200 rounded-sm px-1.5 py-1 text-[11px] text-right tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                                                </div>
                                              )}
                                            </div>
                                            <div className="text-[10px] text-gray-600 tabular-nums font-medium">
                                              {formulaMedida(m)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                                {bd.materiaisLinhas.length === 0 && <p className="text-[11px] text-gray-400 px-0.5">Sem materiais</p>}
                              </div>
                            </div>
                          )}

                          {regras.showOps && panel === "ops" && (
                            <div>
                              <div className="flex items-center justify-end mb-1">
                                <button type="button" data-testid={`line-add-op-${i}`} onClick={() => addOp(i)} className="text-[11px] text-gray-800 font-medium flex items-center gap-0.5 hover:underline"><Plus size={12} /> Op</button>
                              </div>
                              <div className="space-y-1.5" data-testid={`line-ops-${i}`}>
                                {(l.roteiro || []).map((op, oi) => {
                                  const calc = custoOperacao(op);
                                  const unMaq = op.tempo_maquina_unidade || "min";
                                  const unMo = op.tempo_mao_obra_unidade || "min";
                                  return (
                                  <div key={op.id || oi} className="bg-white border border-gray-200 rounded-sm px-2 py-1.5 space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <input placeholder="Nome da operação" value={op.nome || ""} onChange={(e) => updOp(i, oi, { nome: e.target.value })} className="flex-1 min-w-0 border border-gray-200 rounded-sm px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-black/20" />
                                      <span className="text-[11px] tabular-nums font-semibold text-gray-800 shrink-0">{eur(calc.total)}</span>
                                    </div>
                                    <div className="grid grid-cols-[minmax(0,1.2fr)_52px_44px] gap-1 items-end">
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Máquina · preço base €/h</label>
                                        <select value={op.maquina_id || ""} onChange={(e) => { const mq = maquinas.find((x) => x.id === e.target.value); updOp(i, oi, { maquina_id: e.target.value, maquina_nome: mq ? mq.nome : "" }); }} className="w-full border border-gray-200 rounded-sm px-1 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                                          <option value="">—</option>
                                          {maquinas.map((mq) => (
                                            <option key={mq.id} value={mq.id}>{mq.nome} · {eur(maqHora(mq))}/h</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Tempo</label>
                                        <input type="number" min="0" step="0.01" value={op.tempo_maquina ?? 0} onChange={(e) => updOp(i, oi, { tempo_maquina: e.target.value })} className="w-full border border-gray-200 rounded-sm px-1 py-1 text-[11px] text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Un.</label>
                                        <select value={unMaq} onChange={(e) => updOp(i, oi, { tempo_maquina_unidade: e.target.value })} className="w-full border border-gray-200 rounded-sm px-0.5 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-black/20"><option value="min">min</option><option value="h">h</option></select>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-[minmax(0,1.2fr)_52px_44px_24px] gap-1 items-end">
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Mão de obra · preço base €/h</label>
                                        <select value={op.mao_obra_id || ""} onChange={(e) => { const mo = maoObra.find((x) => x.id === e.target.value); updOp(i, oi, { mao_obra_id: e.target.value, mao_obra_nome: mo ? mo.nome : "" }); }} className="w-full border border-gray-200 rounded-sm px-1 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
                                          <option value="">—</option>
                                          {maoObra.map((mo) => (
                                            <option key={mo.id} value={mo.id}>{mo.nome} · {eur(Number(mo.custo_hora) || 0)}/h</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Tempo</label>
                                        <input type="number" min="0" step="0.01" value={op.tempo_mao_obra ?? 0} onChange={(e) => updOp(i, oi, { tempo_mao_obra: e.target.value })} className="w-full border border-gray-200 rounded-sm px-1 py-1 text-[11px] text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Un.</label>
                                        <select value={unMo} onChange={(e) => updOp(i, oi, { tempo_mao_obra_unidade: e.target.value })} className="w-full border border-gray-200 rounded-sm px-0.5 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-black/20"><option value="min">min</option><option value="h">h</option></select>
                                      </div>
                                      <button type="button" onClick={() => delOp(i, oi)} className="p-0.5 mb-0.5 rounded-sm hover:bg-red-100 text-red-600 flex justify-center self-end" title="Remover"><X size={12} /></button>
                                    </div>
                                    <div className="text-[10px] text-gray-600 tabular-nums space-y-0.5 border-t border-gray-100 pt-1">
                                      {calc.rateMaq > 0 || Number(op.tempo_maquina) > 0 ? (
                                        <div>
                                          Máq: {Number(op.tempo_maquina) || 0} {unMaq} (= {calc.hMaq.toLocaleString("pt-PT", { maximumFractionDigits: 4 })} h) × {eur(calc.rateMaq)}/h = <span className="font-medium">{eur(calc.cMaq)}</span>
                                        </div>
                                      ) : null}
                                      {calc.rateMo > 0 || Number(op.tempo_mao_obra) > 0 ? (
                                        <div>
                                          M.O.: {Number(op.tempo_mao_obra) || 0} {unMo} (= {calc.hMo.toLocaleString("pt-PT", { maximumFractionDigits: 4 })} h) × {eur(calc.rateMo)}/h = <span className="font-medium">{eur(calc.cMo)}</span>
                                        </div>
                                      ) : null}
                                      <div className="font-semibold text-gray-800">Total operação: {eur(calc.total)}</div>
                                    </div>
                                  </div>
                                  );
                                })}
                                {(l.roteiro || []).length === 0 && <p className="text-[11px] text-gray-400 px-0.5">Sem operações</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
                );
              })()}
              </Fragment>
            ))}
            <tr className="border-t border-dashed border-gray-200 bg-gray-50/40">
              <td className="px-4 py-2.5" colSpan={10}>
                <button
                  type="button"
                  data-testid="add-line-item"
                  onClick={addLinha}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1.5"
                >
                  <Plus size={14} /> Adicionar linha
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div className={editavel ? "" : "pointer-events-none opacity-70"}>
      <OrcamentoMateriais
        materiais={(orc.materiais || []).filter((m) => !m.da_receita)}
        consumiveis={consumiveis}
        addMaterial={addMaterial}
        delMaterial={(iSolto) => {
          const soltos = (orc.materiais || []).filter((m) => !m.da_receita);
          const target = soltos[iSolto];
          if (!target) return;
          const gi = (orc.materiais || []).findIndex((m) => m === target || (m.id && m.id === target.id));
          if (gi >= 0) delMaterial(gi);
        }}
        updMaterial={(iSolto, patch) => {
          const soltos = (orc.materiais || []).filter((m) => !m.da_receita);
          const target = soltos[iSolto];
          if (!target) return;
          const gi = (orc.materiais || []).findIndex((m) => m === target || (m.id && m.id === target.id));
          if (gi >= 0) updMaterial(gi, patch);
        }}
        matValor={matValor}
        matCusto={matCusto}
        isM2={isM2}
      />

      <OrcamentoTotais subtotalVenda={subtotalVenda} totalPers={totalPers} totalMateriais={totalMateriais} descontoLinhas={descontoLinhas} descTotal={orc.desconto_total} descTotalTipo={orc.desconto_total_tipo} descTotalVal={descTotalVal} onDescTotal={(v) => upd({ desconto_total: v })} onDescTotalTipo={(t) => upd({ desconto_total_tipo: t })} custoProducao={subtotalCusto + custoMateriais} lucro={lucro} total={total} ivaTaxa={empresa.iva_isento ? 0 : (Number(empresa.iva_taxa) || 0)} ivaIsento={!!empresa.iva_isento} condicoesPagamento={empresa.condicoes_pagamento} />
      </div>

      {temNumero && (
        <section className="mt-6" data-testid="orc-versoes">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <GitBranch size={15} /> Versões do orçamento
          </h2>
          <div className="bg-white border border-gray-200 rounded-sm divide-y divide-gray-100">
            {versoes.map((v) => (
              <button
                type="button"
                key={`v-${v.versao}`}
                data-testid={`orc-versao-${v.versao}`}
                onClick={() => setViewVersao(viewVersao === v.versao ? null : v.versao)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 ${viewVersao === v.versao ? "bg-amber-50" : ""}`}
              >
                <div className="min-w-0">
                  <div className="mono tabular-nums font-medium text-gray-900">{v.label || `${orc.numero}${v.versao > 1 ? ` V${v.versao}` : ""}`}</div>
                  <div className="text-xs text-gray-500 truncate">{v.descricao || v.cliente || "—"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums text-sm font-semibold">{eur(v.total)}</div>
                  <div className="text-xs text-gray-400">{fmtDate((v.data || "").slice(0, 10))}</div>
                </div>
              </button>
            ))}
            <div className="px-4 py-3 flex items-center justify-between gap-3 bg-gray-50">
              <div className="min-w-0">
                <div className="mono tabular-nums font-medium text-gray-900">{orcNumeroLabel(orc)} <span className="text-xs font-normal text-gray-500">actual</span></div>
                <div className="text-xs text-gray-500 truncate">{orc.descricao || orc.cliente || "—"}</div>
              </div>
              <div className="tabular-nums text-sm font-semibold">{eur(total)}</div>
            </div>
            {viewVersao != null && versoes.find((v) => v.versao === viewVersao) && (
              <div className="px-4 py-3 bg-amber-50/60 text-sm text-amber-950" data-testid="orc-versao-detalhe">
                <p className="font-medium mb-2">Versão arquivada {versoes.find((v) => v.versao === viewVersao).label}</p>
                <ul className="space-y-1 text-xs">
                  {(versoes.find((v) => v.versao === viewVersao).linhas || []).map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">{l.artigo_codigo ? `${l.artigo_codigo} · ` : ""}{l.artigo_nome}</span>
                      <span className="tabular-nums shrink-0">{l.quantidade} × {eur(l.preco_unit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

        </>
      )}

      {tab === "ficheiros" && (
        <FicheirosTab tipo="orcamento" id={id} canEdit={can("orcamentos", "edit") && orcEditavel(orc)} />
      )}

      {tab === "historico" && (
        <HistoricoTimeline tipo="orcamento" id={id} hideTitle />
      )}

      <Dialog open={showConverterPrecos} onOpenChange={setShowConverterPrecos}>
        <DialogContent className="max-w-lg sm:rounded-sm" data-testid="converter-precos-dialog">
          <DialogHeader>
            <DialogTitle>Criar encomenda</DialogTitle>
            <DialogDescription>
              Podes aumentar os preços relativamente ao orçamento. Não é permitido diminuir.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">
                  <th className="py-2 pr-2">Artigo</th>
                  <th className="py-2 px-2 text-right">Orçamento</th>
                  <th className="py-2 pl-2 text-right">Encomenda</th>
                </tr>
              </thead>
              <tbody>
                {(orc.linhas || []).filter(orcLinhaPronta).map((l) => {
                  const piso = Number(l.preco_unit) || 0;
                  const val = precosEncomenda[l.id] ?? piso;
                  const abaixo = Number(val) + 0.001 < piso;
                  return (
                    <tr key={l.id} data-testid={`converter-preco-row-${l.id}`} className="border-t border-gray-100">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-900 truncate max-w-[12rem]" title={l.artigo_nome}>{l.artigo_nome || "—"}</div>
                        <div className="text-[11px] text-gray-400 tabular-nums">{l.quantidade || 1} un</div>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-gray-600">{eur(piso)}</td>
                      <td className="py-2 pl-2 text-right">
                        <input
                          data-testid={`converter-preco-input-${l.id}`}
                          type="number"
                          min={piso}
                          step="0.01"
                          value={val}
                          onChange={(e) => setPrecosEncomenda((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          className={`w-24 text-right border rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20 ${abaixo ? "border-red-400" : "border-gray-300"}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2">
            <button type="button" data-testid="converter-precos-cancel" onClick={() => setShowConverterPrecos(false)} className="border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-sm px-3 py-1.5 text-sm font-medium">
              Cancelar
            </button>
            <button type="button" data-testid="converter-precos-confirm" disabled={converting} onClick={confirmarConverter} className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-sm px-3 py-1.5 text-sm font-medium">
              {converting ? "A criar…" : "Criar encomenda"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
