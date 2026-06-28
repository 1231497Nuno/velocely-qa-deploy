import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Artigos from "@/pages/Artigos";
import Maquinas from "@/pages/Maquinas";
import Materiais from "@/pages/Materiais";
import MaoObra from "@/pages/MaoObra";
import TiposPersonalizacao from "@/pages/TiposPersonalizacao";
import Orcamentos from "@/pages/Orcamentos";
import OrcamentoDetail from "@/pages/OrcamentoDetail";
import OrdensFabrico from "@/pages/OrdensFabrico";
import OrdemFabricoDetail from "@/pages/OrdemFabricoDetail";
import AnaliseProducao from "@/pages/AnaliseProducao";
import GestaoUtilizadores from "@/pages/GestaoUtilizadores";
import Clientes from "@/pages/Clientes";
import Encomendas from "@/pages/Encomendas";
import EncomendaDetail from "@/pages/EncomendaDetail";

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
      <Route path="/utilizadores" element={<Protected adminOnly><GestaoUtilizadores /></Protected>} />
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
