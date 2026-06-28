import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate, eur } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/Layout";
import SearchBar from "../components/SearchBar";
import ClienteSelector from "../components/ClienteSelector";
import StatusBadge from "../components/StatusBadge";
import { Plus, Trash2, Factory } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

export default function Encomendas() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [estadoFilter, setEstadoFilter] = useState("pendentes");
  const [form, setForm] = useState({ cliente: "", cliente_id: "", descricao: "", prazo_entrega: "", notas: "" });
  const nav = useNavigate();

  const load = useCallback(async () => setItems(await api.get("/encomendas")), []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.cliente_id) return toast.error("Selecione um cliente");
    const enc = await api.post("/encomendas", form);
    toast.success("Encomenda criada");
    setOpen(false);
    nav(`/encomendas/${enc.id}`);
  };
  const remove = async (e, id) => {
    e.stopPropagation();
    await api.del(`/encomendas/${id}`);
    toast.success("Encomenda eliminada");
    load();
  };

  const ql = q.trim().toLowerCase();
  const byEstado = items.filter((e) => {
    if (estadoFilter === "pendentes") return e.estado !== "concluida" && e.estado !== "cancelada";
    if (estadoFilter === "concluidas") return e.estado === "concluida";
    return true;
  });
  const items_f = ql ? byEstado.filter((e) => [e.numero, e.cliente, e.orcamento_numero].some((v) => (v || "").toLowerCase().includes(ql))) : byEstado;
  const payBadge = { pendente: "pendente", parcial: "parcial", pago: "pago" };
  const hoje = new Date().toISOString().slice(0, 10);
  const filtros = [["pendentes", "Pendentes"], ["concluidas", "Concluídas"], ["todas", "Todas"]];

  return (
    <div>
      <PageHeader
        title="Encomendas"
        subtitle="Encomendas de clientes e respetivas ordens de fabrico"
        actions={can("encomendas", "create") && (
          <button data-testid="new-encomenda-btn" onClick={() => { setForm({ cliente: "", cliente_id: "", descricao: "", prazo_entrega: "", notas: "" }); setOpen(true); }} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Nova Encomenda</button>
        )}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-sm p-1 w-fit">
          {filtros.map(([k, l]) => (
            <button key={k} data-testid={`enc-filtro-${k}`} onClick={() => setEstadoFilter(k)} className={`px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${estadoFilter === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1">
          <SearchBar value={q} onChange={setQ} placeholder="Pesquisar por número, cliente ou orçamento..." testid="encomendas-search" />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Nº</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Prazo entrega</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Valor</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Pagamento</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">OFs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">Estado</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody data-testid="encomendas-table">
            {items_f.map((e) => (
              <tr key={e.id} data-testid={`encomenda-row-${e.id}`} onClick={() => nav(`/encomendas/${e.id}`)} className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3 mono tabular-nums font-medium text-gray-900">{e.numero}</td>
                <td className="px-4 py-3 text-gray-700">{e.cliente}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{fmtDate(e.data)}</td>
                <td className="px-4 py-3 tabular-nums" data-testid={`enc-prazo-${e.id}`}>
                  {e.prazo_entrega ? (
                    <span className={e.prazo_entrega < hoje && e.estado !== "concluida" ? "text-red-600 font-medium" : "text-gray-600"}>{fmtDate(e.prazo_entrega)}</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{eur(e.valor_total)}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={payBadge[e.status_pagamento]} /></td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-700">{e.num_ofs}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={e.estado} /></td>
                <td className="px-4 py-3">
                  {can("encomendas", "delete") && <button data-testid={`delete-encomenda-${e.id}`} onClick={(ev) => remove(ev, e.id)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {items_f.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">Sem encomendas.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Nova Encomenda</DialogTitle>
            <DialogDescription>Crie uma encomenda e associe ordens de fabrico.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cliente</label>
              <ClienteSelector value={form.cliente_id} onChange={(id, nome) => setForm({ ...form, cliente_id: id, cliente: nome })} testid="encomenda-cliente-select" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Descrição</label>
              <input data-testid="encomenda-descricao-input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Prazo de entrega</label>
              <input data-testid="encomenda-prazo-input" type="date" value={form.prazo_entrega} onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
            <button data-testid="save-encomenda-btn" onClick={create} className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium">Criar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
