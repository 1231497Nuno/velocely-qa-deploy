import "@/App.css";
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { UnsavedChangesProvider } from "@/hooks/useUnsavedChanges";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";
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
import Historico from "@/features/historico/Historico";

function Protected({ children, adminOnly, modulo }) {
  const { user, ready, isAdmin, can } = useAuth();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">A carregar...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (modulo && !can(modulo, "view")) return <Navigate to="/" replace />;
  return <Layout><ErrorBoundary>{children}</ErrorBoundary></Layout>;
}

/** Layout raiz: provider de alterações por guardar (precisa de data router). */
function RootLayout() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/definir-password", element: <DefinirPassword /> },
      { path: "/", element: <Protected><Dashboard /></Protected> },
      { path: "/calendario", element: <Protected modulo="calendario"><Calendario /></Protected> },
      { path: "/clientes", element: <Protected modulo="clientes"><Clientes /></Protected> },
      { path: "/clientes/:id", element: <Protected modulo="clientes"><ClienteDetail /></Protected> },
      { path: "/fornecedores", element: <Protected modulo="fornecedores"><Fornecedores /></Protected> },
      { path: "/fornecedores/:id", element: <Protected modulo="fornecedores"><FornecedorDetail /></Protected> },
      { path: "/ordens-compra", element: <Protected modulo="ordens_compra"><OrdensCompra /></Protected> },
      { path: "/ordens-compra/:id", element: <Protected modulo="ordens_compra"><OrdemCompraDetail /></Protected> },
      { path: "/pedidos-cotacao", element: <Protected modulo="pedidos_cotacao"><PedidosCotacao /></Protected> },
      { path: "/pedidos-cotacao/:id", element: <Protected modulo="pedidos_cotacao"><PedidoCotacaoDetail /></Protected> },
      { path: "/encomendas", element: <Protected modulo="encomendas"><Encomendas /></Protected> },
      { path: "/encomendas/:id", element: <Protected modulo="encomendas"><EncomendaDetail /></Protected> },
      { path: "/nao-conformidades", element: <Protected modulo="nao_conformidades"><NaoConformidades /></Protected> },
      { path: "/nao-conformidades/:id", element: <Protected modulo="nao_conformidades"><NaoConformidadeDetail /></Protected> },
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
      { path: "/ordens-fabrico/:id", element: <Protected modulo="ordens_fabrico"><OrdemFabricoDetail /></Protected> },
      { path: "/analise-producao", element: <Protected modulo="analise_producao"><AnaliseProducao /></Protected> },
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
      <ErrorBoundary>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
