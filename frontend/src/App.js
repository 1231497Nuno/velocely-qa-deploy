import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
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
import Tempos from "@/pages/Tempos";

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/artigos" element={<Artigos />} />
          <Route path="/maquinas" element={<Maquinas />} />
          <Route path="/materiais" element={<Materiais />} />
          <Route path="/mao-obra" element={<MaoObra />} />
          <Route path="/personalizacao" element={<TiposPersonalizacao />} />
          <Route path="/orcamentos" element={<Orcamentos />} />
          <Route path="/orcamentos/:id" element={<OrcamentoDetail />} />
          <Route path="/ordens-fabrico" element={<OrdensFabrico />} />
          <Route path="/ordens-fabrico/:id" element={<OrdemFabricoDetail />} />
          <Route path="/tempos" element={<Tempos />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
