import { useState } from "react";
import { toast } from "sonner";
import { Mail, Save } from "lucide-react";
import { api } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full border border-gray-300 rounded-sm px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand";
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** Guardar o relatório com os filtros e colunas atuais; opcionalmente agendar o envio por email. */
export default function GuardarRelatorioDialog({ open, onClose, params, existente, periodoLabel, onSaved }) {
  const inicial = existente || {};
  const [nome, setNome] = useState(inicial.nome || "");
  const [partilhado, setPartilhado] = useState(!!inicial.partilhado);
  const [envio, setEnvio] = useState({
    ativo: false, frequencia: "semanal", dia_semana: 0, dia_mes: 1, hora: 8, formato: "pdf", mensagem: "",
    ...(inicial.envio || {}),
    destinatarios: (inicial.envio?.destinatarios || []).join(", "),
  });
  const [comoNovo, setComoNovo] = useState(!existente?.pode_editar);
  const [busy, setBusy] = useState(false);
  const setE = (patch) => setEnvio((x) => ({ ...x, ...patch }));

  const gravar = async () => {
    setBusy(true);
    try {
      const body = {
        ...params, nome, partilhado,
        envio: { ...envio, destinatarios: envio.destinatarios.split(/[,;\s]+/).filter(Boolean), hora: Number(envio.hora), dia_semana: Number(envio.dia_semana), dia_mes: Number(envio.dia_mes) },
      };
      const r = existente?.id && !comoNovo ? await api.put(`/relatorios/guardados/${existente.id}`, body) : await api.post("/relatorios/guardados", body);
      toast.success(body.envio.ativo ? "Relatório guardado — envio automático agendado" : "Relatório guardado");
      onSaved(r);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardar relatório</DialogTitle>
          <DialogDescription>Fica com o período «{periodoLabel}», os filtros e as colunas escolhidas. O período é recalculado cada vez que abre ou envia.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs font-medium text-gray-600">Nome</label><input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Vendas do mês passado por cliente" data-testid="guardar-nome" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={partilhado} onChange={(e) => setPartilhado(e.target.checked)} /> Partilhar com os colegas (podem abrir, não alterar)</label>
          {existente?.pode_editar && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={comoNovo} onChange={(e) => setComoNovo(e.target.checked)} /> Guardar como novo (não alterar «{existente.nome}»)</label>
          )}
          <div className="border border-gray-200 rounded-sm p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={envio.ativo} onChange={(e) => setE({ ativo: e.target.checked })} data-testid="guardar-envio" /> <Mail size={14} /> Enviar automaticamente por email</label>
            {envio.ativo && (
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-600">Frequência</label>
                  <select className={inputCls} value={envio.frequencia} onChange={(e) => setE({ frequencia: e.target.value })}>
                    <option value="diario">Todos os dias</option><option value="semanal">Todas as semanas</option><option value="mensal">Todos os meses</option>
                  </select></div>
                {envio.frequencia === "semanal" && <div><label className="text-xs text-gray-600">Dia</label>
                  <select className={inputCls} value={envio.dia_semana} onChange={(e) => setE({ dia_semana: e.target.value })}>{DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>}
                {envio.frequencia === "mensal" && <div><label className="text-xs text-gray-600">Dia do mês</label>
                  <select className={inputCls} value={envio.dia_mes} onChange={(e) => setE({ dia_mes: e.target.value })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></div>}
                <div><label className="text-xs text-gray-600">Hora</label>
                  <select className={inputCls} value={envio.hora} onChange={(e) => setE({ hora: e.target.value })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></div>
                <div><label className="text-xs text-gray-600">Formato</label>
                  <select className={inputCls} value={envio.formato} onChange={(e) => setE({ formato: e.target.value })}><option value="pdf">PDF</option><option value="xlsx">Excel</option></select></div>
                <div className="col-span-2"><label className="text-xs text-gray-600">Para (emails separados por vírgula)</label><input className={inputCls} value={envio.destinatarios} onChange={(e) => setE({ destinatarios: e.target.value })} placeholder="geral@famarte.pt" data-testid="guardar-destinatarios" /></div>
                <div className="col-span-2"><label className="text-xs text-gray-600">Mensagem (opcional)</label><input className={inputCls} value={envio.mensagem} onChange={(e) => setE({ mensagem: e.target.value })} /></div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primario" disabled={busy || !nome.trim()} onClick={gravar} data-testid="guardar-gravar"><Save size={15} /> Guardar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
