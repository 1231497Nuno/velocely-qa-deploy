import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/features/auth/Login";
import Dashboard from "@/features/dashboard/Dashboard";
import Artigos from "@/features/artigos/Artigos";
import Maquinas from "@/features/catalogo/Maquinas";
import Materiais from "@/features/catalogo/Materiais";
import MaoObra from "@/features/catalogo/MaoObra";
import TiposPersonalizacao from "@/features/catalogo/TiposPersonalizacao";
import Orcamentos from "@/features/orcamentos/Orcamentos";
import OrcamentoDetail from "@/features/orcamentos/OrcamentoDetail";
import OrdensFabrico from "@/features/ordens_fabrico/OrdensFabrico";
import OrdemFabricoDetail from "@/features/ordens_fabrico/OrdemFabricoDetail";
import AnaliseProducao from "@/features/producao/AnaliseProducao";
import GestaoUtilizadores from "@/features/utilizadores/GestaoUtilizadores";
import Clientes from "@/features/clientes/Clientes";
import Encomendas from "@/features/encomendas/Encomendas";
import EncomendaDetail from "@/features/encomendas/EncomendaDetail";
import Definicoes from "@/features/definicoes/Definicoes";
import Calendario from "@/features/producao/Calendario";
import RentabilidadeClientes from "@/features/relatorios/RentabilidadeClientes";

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
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/calendario" element={<Protected><Calendario /></Protected>} />
      <Route path="/clientes" element={<Protected modulo="clientes"><Clientes /></Protected>} />
      <Route path="/encomendas" element={<Protected modulo="encomendas"><Encomendas /></Protected>} />
      <Route path="/encomendas/:id" element={<Protected modulo="encomendas"><EncomendaDetail /></Protected>} />
      <Route path="/artigos" element={<Protected modulo="artigos"><Artigos /></Protected>} />
      <Route path="/maquinas" element={<Protected modulo="maquinas"><Maquinas /></Protected>} />
      <Route path="/materiais" element={<Protected modulo="materiais"><Materiais /></Protected>} />
      <Route path="/mao-obra" element={<Protected modulo="mao_obra"><MaoObra /></Protected>} />
      <Route path="/personalizacao" element={<Protected modulo="personalizacao"><TiposPersonalizacao /></Protected>} />
      <Route path="/orcamentos" element={<Protected modulo="orcamentos"><Orcamentos /></Protected>} />
      <Route path="/orcamentos/:id" element={<Protected modulo="orcamentos"><OrcamentoDetail /></Protected>} />
      <Route path="/ordens-fabrico" element={<Protected modulo="ordens_fabrico"><OrdensFabrico /></Protected>} />
      <Route path="/ordens-fabrico/:id" element={<Protected modulo="ordens_fabrico"><OrdemFabricoDetail /></Protected>} />
      <Route path="/analise-producao" element={<Protected modulo="analise_producao"><AnaliseProducao /></Protected>} />
      <Route path="/rentabilidade-clientes" element={<Protected modulo="analise_producao"><RentabilidadeClientes /></Protected>} />
      <Route path="/utilizadores" element={<Protected adminOnly><GestaoUtilizadores /></Protected>} />
      <Route path="/definicoes" element={<Protected adminOnly><Definicoes /></Protected>} />
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
