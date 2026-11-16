import "@/App.css";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { TemaProvider } from "@/context/TemaContext";
import { CamposProvider } from "@/context/CamposContext";
import { UnsavedChangesProvider } from "@/hooks/useUnsavedChanges";
import { ConfirmProvider } from "@/hooks/useConfirm";
import Layout from "@/components/Layout";
import ClienteNovo from "@/features/clientes/ClienteNovo";
import FornecedorNovo from "@/features/fornecedores/FornecedorNovo";
import MovelHome from "@/features/movel/MovelHome";
import MovelInventario from "@/features/movel/MovelInventario";
import { MovelRececoes, MovelRececao } from "@/features/movel/MovelRececoes";
import { MovelTransferir, MovelConsultar, MovelAcertar } from "@/features/movel/MovelStock";
import { MovelLocalizacoes, MovelLocalizacao, MovelMovimento, MovelStockBaixo, MovelMovimentos } from "@/features/movel/MovelExtra";
import ErrorBoundary from "@/components/ErrorBoundary";
import VisualizadorFicheiro from "@/components/VisualizadorFicheiro";
import { BloquearLargarFora } from "@/components/ZonaArrastar";
import { podeMovel } from "@/lib/movelOps";
import Login from "@/features/auth/Login";
import DefinirPassword from "@/features/auth/DefinirPassword";
import Dashboard from "@/features/dashboard/Dashboard";
import Artigos from "@/features/artigos/Artigos";
import ArtigoDetail from "@/features/artigos/ArtigoDetail";
import ArtigoNovo from "@/features/artigos/ArtigoNovo";
import Maquinas from "@/features/catalogo/Maquinas";
import MaoObra from "@/features/catalogo/MaoObra";
import TiposPersonalizacao from "@/features/catalogo/TiposPersonalizacao";
import Categorias from "@/features/catalogo/Categorias";
import Orcamentos from "@/features/orcamentos/Orcamentos";
import OrcamentoDetail from "@/features/orcamentos/OrcamentoDetail";
import OrdensFabrico from "@/features/ordens_fabrico/OrdensFabrico";
import OrdemFabricoDetail from "@/features/ordens_fabrico/OrdemFabricoDetail";
import AnaliseProducao from "@/features/producao/AnaliseProducao";
import GestaoUtilizadores from "@/features/utilizadores/GestaoUtilizadores";
import Clientes from "@/features/clientes/Clientes";
import ClienteDetail from "@/features/clientes/ClienteDetail";
import Fornecedores from "@/features/fornecedores/Fornecedores";
import FornecedorDetail from "@/features/fornecedores/FornecedorDetail";
import OrdensCompra from "@/features/ordens_compra/OrdensCompra";
import OrdemCompraDetail from "@/features/ordens_compra/OrdemCompraDetail";
import PedidosCotacao from "@/features/pedidos_cotacao/PedidosCotacao";
import PedidoCotacaoDetail from "@/features/pedidos_cotacao/PedidoCotacaoDetail";
import Encomendas from "@/features/encomendas/Encomendas";
import EncomendaDetail from "@/features/encomendas/EncomendaDetail";
import Financeiro from "@/features/financeiro/Financeiro";
import DocumentoFinanceiroDetail from "@/features/financeiro/DocumentoFinanceiroDetail";
import NaoConformidades from "@/features/nao_conformidades/NaoConformidades";
import NaoConformidadeDetail from "@/features/nao_conformidades/NaoConformidadeDetail";
import Contas from "@/features/contas/Contas";
import ContaDetail from "@/features/contas/ContaDetail";
import Definicoes from "@/features/definicoes/Definicoes";
import Calendario from "@/features/producao/Calendario";
import RentabilidadeClientes from "@/features/relatorios/RentabilidadeClientes";
import Relatorios from "@/features/relatorios/Relatorios";
import Tarefas from "@/features/tarefas/Tarefas";
import TabelasPrecos from "@/features/precos/TabelasPrecos";
import Stock from "@/features/stock/Stock";
import CargaMaquinas from "@/features/producao/CargaMaquinas";
import Oficina from "@/features/producao/Oficina";
import MovelPicking from "@/features/movel/MovelPicking";
import OficinaTV from "@/features/producao/OficinaTV";
import Planeamento from "@/features/producao/Planeamento";
import Manutencao from "@/features/producao/Manutencao";
import Tesouraria from "@/features/tesouraria/Tesouraria";
import Objetivos from "@/features/relatorios/Objetivos";
import FechoMes from "@/features/relatorios/FechoMes";
import PortalCliente from "@/features/portal/PortalCliente";
import CalculadoraPreco from "@/features/calculadora/CalculadoraPreco";
import PrecosFornecedor from "@/features/precos/PrecosFornecedor";
import Historico from "@/features/historico/Historico";
import Crm from "@/features/crm/Crm";
import Pagamentos from "@/features/pagamentos/Pagamentos";
import PagamentoDetail from "@/features/pagamentos/PagamentoDetail";
import AcertoTempos from "@/features/ordens_fabrico/AcertoTempos";

function Protected({ children, adminOnly, modulo }) {
  const { user, ready, isAdmin, can } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">A carregar...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (modulo && !can(modulo, "view")) return <Navigate to="/" replace />;
  return <Layout><ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary></Layout>;
}

/** App móvel (/m): sem o menu lateral; sem sessão vai ao login e volta. */
function MovelProtected({ children, modulo, op }) {
  const { user, ready, can } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">A carregar...</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (modulo && !can(modulo, "view")) return <Navigate to="/m" replace />;
  if (op && !podeMovel(user, can, op)) return <Navigate to="/m" replace />;
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

/** Layout raiz: provider de alterações por guardar (precisa de data router). */
function RootLayout() {
  return (
    <UnsavedChangesProvider>
      <ConfirmProvider>
        <Outlet />
      </ConfirmProvider>
    </UnsavedChangesProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/definir-password", element: <DefinirPassword /> },
      { path: "/p/:token", element: <PortalCliente /> },
      { path: "/m", element: <MovelProtected><MovelHome /></MovelProtected> },
      { path: "/m/inventario", element: <MovelProtected modulo="artigos" op="inventario"><MovelInventario /></MovelProtected> },
      { path: "/m/rececoes", element: <MovelProtected modulo="ordens_compra" op="rececoes"><MovelRececoes /></MovelProtected> },
      { path: "/m/rececoes/f/:fid", element: <MovelProtected modulo="ordens_compra" op="rececoes"><MovelRececao /></MovelProtected> },
      { path: "/m/rececoes/:id", element: <MovelProtected modulo="ordens_compra" op="rececoes"><MovelRececao /></MovelProtected> },
      { path: "/m/localizacoes", element: <MovelProtected modulo="artigos" op="localizacoes"><MovelLocalizacoes /></MovelProtected> },
      { path: "/m/localizacoes/:id", element: <MovelProtected modulo="artigos" op="localizacoes"><MovelLocalizacao /></MovelProtected> },
      { path: "/m/movimento", element: <MovelProtected modulo="artigos" op="movimento"><MovelMovimento /></MovelProtected> },
      { path: "/m/stock-baixo", element: <MovelProtected modulo="artigos" op="stock_baixo"><MovelStockBaixo /></MovelProtected> },
      { path: "/m/movimentos", element: <MovelProtected modulo="artigos" op="movimentos"><MovelMovimentos /></MovelProtected> },
      { path: "/m/transferir", element: <MovelProtected modulo="artigos" op="transferir"><MovelTransferir /></MovelProtected> },
      { path: "/m/consultar", element: <MovelProtected modulo="artigos" op="consultar"><MovelConsultar /></MovelProtected> },
      { path: "/m/acertar", element: <MovelProtected modulo="artigos" op="acertar"><MovelAcertar /></MovelProtected> },
      { path: "/m/picking", element: <MovelProtected modulo="ordens_fabrico" op="picking"><MovelPicking /></MovelProtected> },
      { path: "/m/picking/:id", element: <MovelProtected modulo="ordens_fabrico" op="picking"><MovelPicking /></MovelProtected> },
      { path: "/tv/oficina", element: <MovelProtected modulo="ordens_fabrico"><OficinaTV /></MovelProtected> },
      { path: "/m/*", element: <Navigate to="/m" replace /> },
      { path: "/", element: <Protected><Dashboard /></Protected> },
      { path: "/calendario", element: <Protected modulo="calendario"><Calendario /></Protected> },
      { path: "/crm", element: <Protected modulo="crm"><Crm /></Protected> },
      { path: "/clientes", element: <Protected modulo="clientes"><Clientes /></Protected> },
      { path: "/clientes/novo", element: <Protected modulo="clientes"><ClienteNovo /></Protected> },
      { path: "/clientes/:id", element: <Protected modulo="clientes"><ClienteDetail /></Protected> },
      { path: "/fornecedores", element: <Protected modulo="fornecedores"><Fornecedores /></Protected> },
      { path: "/fornecedores/novo", element: <Protected modulo="fornecedores"><FornecedorNovo /></Protected> },
      { path: "/fornecedores/:id", element: <Protected modulo="fornecedores"><FornecedorDetail /></Protected> },
      { path: "/ordens-compra", element: <Protected modulo="ordens_compra"><OrdensCompra /></Protected> },
      { path: "/ordens-compra/:id", element: <Protected modulo="ordens_compra"><OrdemCompraDetail /></Protected> },
      { path: "/pedidos-cotacao", element: <Protected modulo="pedidos_cotacao"><PedidosCotacao /></Protected> },
      { path: "/pedidos-cotacao/:id", element: <Protected modulo="pedidos_cotacao"><PedidoCotacaoDetail /></Protected> },
      { path: "/encomendas", element: <Protected modulo="encomendas"><Encomendas /></Protected> },
      { path: "/encomendas/:id", element: <Protected modulo="encomendas"><EncomendaDetail /></Protected> },
      { path: "/nao-conformidades", element: <Protected modulo="nao_conformidades"><NaoConformidades /></Protected> },
      { path: "/nao-conformidades/:id", element: <Protected modulo="nao_conformidades"><NaoConformidadeDetail /></Protected> },
      { path: "/pagamentos", element: <Protected modulo="encomendas"><Pagamentos /></Protected> },
      { path: "/pagamentos/:eid/:pid", element: <Protected modulo="encomendas"><PagamentoDetail /></Protected> },
      { path: "/financeiro", element: <Protected modulo="financeiro"><Financeiro /></Protected> },
      { path: "/financeiro/:id", element: <Protected modulo="financeiro"><DocumentoFinanceiroDetail /></Protected> },
      { path: "/contas", element: <Protected modulo="contas"><Contas /></Protected> },
      { path: "/contas/:id", element: <Protected modulo="contas"><ContaDetail /></Protected> },
      { path: "/artigos", element: <Protected modulo="artigos"><Artigos /></Protected> },
      { path: "/artigos/novo", element: <Protected modulo="artigos"><ArtigoNovo /></Protected> },
      { path: "/artigos/:id", element: <Protected modulo="artigos"><ArtigoDetail /></Protected> },
      { path: "/categorias", element: <Protected modulo="artigos"><Categorias /></Protected> },
      { path: "/subcategorias", element: <Navigate to="/categorias" replace /> },
      { path: "/maquinas", element: <Protected modulo="maquinas"><Maquinas /></Protected> },
      { path: "/materiais", element: <Navigate to="/artigos" replace /> },
      { path: "/mao-obra", element: <Protected modulo="mao_obra"><MaoObra /></Protected> },
      { path: "/personalizacao", element: <Protected modulo="personalizacao"><TiposPersonalizacao /></Protected> },
      { path: "/orcamentos", element: <Protected modulo="orcamentos"><Orcamentos /></Protected> },
      { path: "/orcamentos/:id", element: <Protected modulo="orcamentos"><OrcamentoDetail /></Protected> },
      { path: "/ordens-fabrico", element: <Protected modulo="ordens_fabrico"><OrdensFabrico /></Protected> },
      { path: "/ordens-fabrico/acerto-tempos", element: <Protected modulo="ordens_fabrico"><AcertoTempos /></Protected> },
      { path: "/ordens-fabrico/:id", element: <Protected modulo="ordens_fabrico"><OrdemFabricoDetail /></Protected> },
      { path: "/analise-producao", element: <Protected modulo="analise_producao"><AnaliseProducao /></Protected> },
      { path: "/tabelas-precos", element: <Protected modulo="artigos"><TabelasPrecos /></Protected> },
      { path: "/stock", element: <Protected modulo="artigos"><Stock /></Protected> },
      { path: "/precos-fornecedor", element: <Protected modulo="artigos"><PrecosFornecedor /></Protected> },
      { path: "/calculadora", element: <Protected modulo="orcamentos"><CalculadoraPreco /></Protected> },
      { path: "/objetivos", element: <Protected modulo="relatorios"><Objetivos /></Protected> },
      { path: "/fecho-mes", element: <Protected modulo="relatorios"><FechoMes /></Protected> },
      { path: "/tesouraria", element: <Protected modulo="contas"><Tesouraria /></Protected> },
      { path: "/oficina", element: <Protected modulo="ordens_fabrico"><Oficina /></Protected> },
      { path: "/planeamento", element: <Protected modulo="ordens_fabrico"><Planeamento /></Protected> },
      { path: "/manutencao", element: <Protected modulo="maquinas"><Manutencao /></Protected> },
      { path: "/carga-maquinas", element: <Protected modulo="ordens_fabrico"><CargaMaquinas /></Protected> },
      { path: "/tarefas", element: <Protected><Tarefas /></Protected> },
      { path: "/relatorios", element: <Protected modulo="relatorios"><Relatorios /></Protected> },
      { path: "/rentabilidade-clientes", element: <Protected modulo="rentabilidade"><RentabilidadeClientes /></Protected> },
      { path: "/utilizadores", element: <Protected adminOnly><GestaoUtilizadores /></Protected> },
      { path: "/historico", element: <Protected modulo="historico"><Historico /></Protected> },
      { path: "/definicoes", element: <Protected modulo="definicoes"><Definicoes /></Protected> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

function App() {
  return (
    <>
      <Toaster position="top-right" richColors />
      <VisualizadorFicheiro />
      <BloquearLargarFora />
      <ErrorBoundary>
        <TemaProvider>
          <AuthProvider>
            <CamposProvider>
              <RouterProvider router={router} />
            </CamposProvider>
          </AuthProvider>
        </TemaProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
