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

function Protected({ children, adminOnly }) {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">A carregar...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/artigos" element={<Protected><Artigos /></Protected>} />
      <Route path="/maquinas" element={<Protected><Maquinas /></Protected>} />
      <Route path="/materiais" element={<Protected><Materiais /></Protected>} />
      <Route path="/mao-obra" element={<Protected><MaoObra /></Protected>} />
      <Route path="/personalizacao" element={<Protected><TiposPersonalizacao /></Protected>} />
      <Route path="/orcamentos" element={<Protected><Orcamentos /></Protected>} />
      <Route path="/orcamentos/:id" element={<Protected><OrcamentoDetail /></Protected>} />
      <Route path="/ordens-fabrico" element={<Protected><OrdensFabrico /></Protected>} />
      <Route path="/ordens-fabrico/:id" element={<Protected><OrdemFabricoDetail /></Protected>} />
      <Route path="/analise-producao" element={<Protected><AnaliseProducao /></Protected>} />
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
