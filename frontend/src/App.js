import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/features/auth/Login";
import DefinirPassword from "@/features/auth/DefinirPassword";
import Dashboard from "@/features/dashboard/Dashboard";
import Artigos from "@/features/artigos/Artigos";
import ArtigoDetail from "@/features/artigos/ArtigoDetail";
import Maquinas from "@/features/catalogo/Maquinas";
import Materiais from "@/features/catalogo/Materiais";
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
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/definir-password" element={<DefinirPassword />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/calendario" element={<Protected modulo="calendario"><Calendario /></Protected>} />
      <Route path="/clientes" element={<Protected modulo="clientes"><Clientes /></Protected>} />
      <Route path="/clientes/:id" element={<Protected modulo="clientes"><ClienteDetail /></Protected>} />
      <Route path="/fornecedores" element={<Protected modulo="fornecedores"><Fornecedores /></Protected>} />
      <Route path="/fornecedores/:id" element={<Protected modulo="fornecedores"><FornecedorDetail /></Protected>} />
      <Route path="/ordens-compra" element={<Protected modulo="ordens_compra"><OrdensCompra /></Protected>} />
      <Route path="/ordens-compra/:id" element={<Protected modulo="ordens_compra"><OrdemCompraDetail /></Protected>} />
      <Route path="/pedidos-cotacao" element={<Protected modulo="pedidos_cotacao"><PedidosCotacao /></Protected>} />
      <Route path="/pedidos-cotacao/:id" element={<Protected modulo="pedidos_cotacao"><PedidoCotacaoDetail /></Protected>} />
      <Route path="/encomendas" element={<Protected modulo="encomendas"><Encomendas /></Protected>} />
      <Route path="/encomendas/:id" element={<Protected modulo="encomendas"><EncomendaDetail /></Protected>} />
      <Route path="/nao-conformidades" element={<Protected modulo="nao_conformidades"><NaoConformidades /></Protected>} />
      <Route path="/nao-conformidades/:id" element={<Protected modulo="nao_conformidades"><NaoConformidadeDetail /></Protected>} />
      <Route path="/financeiro" element={<Protected modulo="financeiro"><Financeiro /></Protected>} />
      <Route path="/financeiro/:id" element={<Protected modulo="financeiro"><DocumentoFinanceiroDetail /></Protected>} />
      <Route path="/contas" element={<Protected modulo="contas"><Contas /></Protected>} />
      <Route path="/contas/:id" element={<Protected modulo="contas"><ContaDetail /></Protected>} />
      <Route path="/artigos" element={<Protected modulo="artigos"><Artigos /></Protected>} />
      <Route path="/artigos/:id" element={<Protected modulo="artigos"><ArtigoDetail /></Protected>} />
      <Route path="/categorias" element={<Protected modulo="artigos"><Categorias /></Protected>} />
      <Route path="/subcategorias" element={<Navigate to="/categorias" replace />} />
      <Route path="/maquinas" element={<Protected modulo="maquinas"><Maquinas /></Protected>} />
      <Route path="/materiais" element={<Protected modulo="materiais"><Materiais /></Protected>} />
      <Route path="/mao-obra" element={<Protected modulo="mao_obra"><MaoObra /></Protected>} />
      <Route path="/personalizacao" element={<Protected modulo="personalizacao"><TiposPersonalizacao /></Protected>} />
      <Route path="/orcamentos" element={<Protected modulo="orcamentos"><Orcamentos /></Protected>} />
      <Route path="/orcamentos/:id" element={<Protected modulo="orcamentos"><OrcamentoDetail /></Protected>} />
      <Route path="/ordens-fabrico" element={<Protected modulo="ordens_fabrico"><OrdensFabrico /></Protected>} />
      <Route path="/ordens-fabrico/:id" element={<Protected modulo="ordens_fabrico"><OrdemFabricoDetail /></Protected>} />
      <Route path="/analise-producao" element={<Protected modulo="analise_producao"><AnaliseProducao /></Protected>} />
      <Route path="/rentabilidade-clientes" element={<Protected modulo="rentabilidade"><RentabilidadeClientes /></Protected>} />
      <Route path="/utilizadores" element={<Protected adminOnly><GestaoUtilizadores /></Protected>} />
      <Route path="/historico" element={<Protected modulo="historico"><Historico /></Protected>} />
      <Route path="/definicoes" element={<Protected modulo="definicoes"><Definicoes /></Protected>} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
