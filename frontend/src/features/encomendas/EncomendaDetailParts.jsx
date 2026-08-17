import { Link } from "react-router-dom";
import { eur, fmtDate } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import {
  AlertTriangle, User, Phone, Mail, MapPin, Hash, Factory, Layers, Plus,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export const EncAlertas = ({ enc }) => {
  if (!enc.tem_artigos_sem_of && !enc.sobreproducao) return null;
  return (
    <div className="space-y-2 mb-4" data-testid="enc-alertas-producao">
      {enc.tem_artigos_sem_of && (
        <div data-testid="enc-alerta-sem-of" className="rounded-sm border border-red-200 bg-red-50 p-3 flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-red-800">Artigos sem ordem de fabrico</div>
            <div className="text-xs text-red-700 mt-0.5">Estes artigos não estão em nenhuma OF e não vão ser produzidos: <span className="font-medium">{(enc.artigos_sem_of || []).join(", ")}</span>. Cria uma Ordem de Fabrico para os incluir.</div>
          </div>
        </div>
      )}
      {enc.sobreproducao && (
        <div data-testid="enc-alerta-sobreproducao" className="rounded-sm border border-amber-200 bg-amber-50 p-3 flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-amber-800">Sobreprodução</div>
            <div className="text-xs text-amber-700 mt-0.5">As OFs criadas ultrapassam a quantidade encomendada em: <span className="font-medium">{(enc.artigos_sobreproducao || []).join(", ")}</span>.</div>
          </div>
        </div>
      )}
    </div>
  );
};

const KpiCard = ({ testid, label, value, valueClass = "", sub }) => (
  <div className="bg-white border border-gray-200 rounded-sm p-4 min-w-0 overflow-hidden" data-testid={testid}>
    <div className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 leading-tight">{label}</div>
    <div className={`text-xl sm:text-2xl font-bold tabular-nums font-display mt-1 break-words ${valueClass}`}>{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-0.5 break-words">{sub}</div>}
  </div>
);

export const EncKPIs = ({ enc }) => {
  const pct = Number(enc.percentual_pago);
  const pctLabel = Number.isFinite(pct) ? `${pct.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%` : null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <KpiCard testid="enc-kpi-valor" label="Valor da Encomenda" value={eur(enc.valor_total)} />
      <KpiCard testid="enc-kpi-pago" label="Pago" value={eur(enc.valor_pago)} valueClass="text-emerald-600" sub={`${pctLabel ? `${pctLabel} · ` : ""}Pendente ${eur(enc.valor_pendente)}`} />
      <KpiCard testid="enc-kpi-custo-real" label="Custo Produção (real)" value={eur(enc.custo_producao_real)} sub={`Estimado ${eur(enc.custo_producao_estimado)}`} />
      <KpiCard testid="enc-kpi-margem" label="Margem (valor − custo real)" value={eur(enc.margem_producao)} valueClass={enc.margem_producao >= 0 ? "text-emerald-600" : "text-red-600"} />
    </div>
  );
};

export const EncPagamentoResumo = ({ enc }) => {
  const base = Number(enc.total_com_iva) || Number(enc.valor_total) || 0;
  const pago = Number(enc.valor_pago) || 0;
  const pct = Number.isFinite(Number(enc.percentual_pago))
    ? Number(enc.percentual_pago)
    : (base > 0.009 ? Math.min(100, Math.max(0, (pago / base) * 100)) : 0);
  const pctLabel = `${pct.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;
  const devolvido = Number(enc.valor_devolvido) || 0;
  return (
    <div className="mb-4" data-testid="enc-pagamentos-resumo">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div className="bg-white border border-gray-200 rounded-sm p-4 min-w-0" data-testid="enc-pag-kpi-estado">
          <div className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 leading-tight">Estado da encomenda</div>
          <div className="mt-2"><StatusBadge status={enc.estado} testid="enc-pag-estado-badge" /></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-sm p-4 min-w-0" data-testid="enc-pag-kpi-status">
          <div className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 leading-tight">Estado do pagamento</div>
          <div className="mt-2"><StatusBadge status={enc.status_pagamento} testid="enc-pag-pagamento-badge" /></div>
        </div>
        <KpiCard testid="enc-pag-kpi-pago" label="Pago" value={eur(pago)} valueClass="text-emerald-600" sub={`de ${eur(base)} c/ IVA`} />
        <KpiCard testid="enc-pag-kpi-pendente" label="Pendente" value={eur(enc.valor_pendente)} valueClass={(enc.valor_pendente || 0) > 0.009 ? "text-amber-700" : "text-emerald-600"} sub={devolvido > 0.009 ? `Devolvido ${eur(devolvido)}` : undefined} />
      </div>
      <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="enc-pag-percentual">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Percentual pago</span>
          <span className="text-lg font-bold tabular-nums font-display text-gray-900" data-testid="enc-pag-percentual-valor">{pctLabel}</span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            data-testid="enc-pag-percentual-bar"
            className={`h-full rounded-full ${pct >= 99.9 ? "bg-emerald-600" : pct > 0 ? "bg-amber-500" : "bg-gray-300"}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export const ClientePanel = ({ enc, cliente, moradaCompleta, onPrazoChange, onPrazoBlur }) => (
  <div className="bg-white border border-gray-200 rounded-sm p-5" data-testid="encomenda-cliente-info">
    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><User size={15} /> Cliente</h3>
    <div className="space-y-2 text-sm">
      <div className="font-medium text-gray-900">{enc.cliente}</div>
      {cliente?.contacto && <div className="text-gray-600 flex items-center gap-2"><Phone size={13} /> {cliente.contacto}</div>}
      {cliente?.email && <div className="text-gray-600 flex items-center gap-2"><Mail size={13} /> {cliente.email}</div>}
      {(cliente?.morada || cliente?.cidade) && <div className="text-gray-600 flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> <span>{moradaCompleta}</span></div>}
      {cliente?.nif && <div className="text-gray-600 flex items-center gap-2"><Hash size={13} /> {cliente.nif}</div>}
      <div className="text-gray-500 text-xs pt-2 border-t border-gray-100">Data: {fmtDate(enc.data)}</div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-gray-500 shrink-0">Prazo de entrega</span>
        <input data-testid="enc-prazo-input" type="date" value={enc.prazo_entrega || ""} onChange={onPrazoChange} onBlur={onPrazoBlur} className="border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
      </div>
      {enc.descricao && <div className="text-gray-600 text-sm">{enc.descricao}</div>}
    </div>
  </div>
);

/** Bloco compacto do cliente para a barra sticky da encomenda. */
export const ClienteStickyMeta = ({
  enc, cliente, moradaCompleta, onPrazoChange, onPrazoBlur,
  onEntregaToggle, onDataEntregaChange, onDataEntregaBlur,
}) => (
  <div className="rounded-sm border border-gray-200 bg-gray-50/80 px-3 py-2" data-testid="encomenda-cliente-info">
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm">
      <div className="min-w-0 flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-1.5 content-start">
        <div className="min-w-0 col-span-2 sm:col-span-1 lg:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 flex items-center gap-1"><User size={11} /> Cliente</div>
          <div className="text-gray-900 font-medium truncate text-xs sm:text-sm" title={enc.cliente || ""}>{enc.cliente || "—"}</div>
        </div>
        {cliente?.contacto && (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 flex items-center gap-1"><Phone size={11} /> Contacto</div>
            <div className="text-gray-800 truncate text-xs">{cliente.contacto}</div>
          </div>
        )}
        {cliente?.email && (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 flex items-center gap-1"><Mail size={11} /> Email</div>
            <div className="text-gray-800 truncate text-xs" title={cliente.email}>{cliente.email}</div>
          </div>
        )}
        {cliente?.nif && (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 flex items-center gap-1"><Hash size={11} /> NIF</div>
            <div className="text-gray-800 tabular-nums text-xs">{cliente.nif}</div>
          </div>
        )}
        {(cliente?.morada || cliente?.cidade) && (
          <div className="min-w-0 col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 flex items-center gap-1"><MapPin size={11} /> Morada</div>
            <div className="text-gray-700 truncate text-xs" title={moradaCompleta}>{moradaCompleta}</div>
          </div>
        )}
        {enc.descricao && (
          <div className="min-w-0 col-span-2 sm:col-span-3 lg:col-span-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Desc.</div>
            <div className="text-gray-700 truncate text-xs" title={enc.descricao}>{enc.descricao}</div>
          </div>
        )}
      </div>

      {/* Data, prazo e entrega */}
      <div className="shrink-0 w-full sm:w-[11.5rem] flex flex-col gap-y-1.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 leading-none">Data</div>
          <div className="tabular-nums text-xs font-medium text-gray-900 mt-0.5 leading-none h-7 flex items-center">
            {fmtDate(enc.data) || "—"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 leading-none">Prazo de entrega</div>
          <div className="mt-0.5 h-7 flex items-center">
            <input
              data-testid="enc-prazo-input"
              type="date"
              value={enc.prazo_entrega || ""}
              onChange={onPrazoChange}
              onBlur={onPrazoBlur}
              className="w-full border border-gray-300 rounded-sm px-2 py-1 text-xs tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20"
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 cursor-pointer">
            <input
              data-testid="enc-entregue-check"
              type="checkbox"
              checked={!!enc.entregue}
              onChange={onEntregaToggle}
              className="w-3.5 h-3.5 accent-teal-700"
            />
            Material entregue
          </label>
          {enc.entregue && (
            <div className="mt-0.5 h-7 flex items-center">
              <input
                data-testid="enc-data-entrega-input"
                type="date"
                value={enc.data_entrega || ""}
                onChange={onDataEntregaChange}
                onBlur={onDataEntregaBlur}
                className="w-full border border-gray-300 rounded-sm px-2 py-1 text-xs tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-black/20"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

export const OFsPanel = ({ enc, onCriar, canCreate }) => (
  <div className="bg-white border border-gray-200 rounded-sm p-5" data-testid="encomenda-ofs-panel">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Factory size={15} /> Ordens de Fabrico</h3>
      {canCreate && (
        <button
          type="button"
          data-testid="encomenda-criar-of-btn"
          onClick={onCriar}
          className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors"
        >
          <Plus size={15} /> Criar OF
        </button>
      )}
    </div>
    <div className="mb-3" data-testid="enc-detail-progresso">
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>Produção lançada em OFs</span>
        <span className="tabular-nums">{enc.qtd_em_ofs || 0}/{enc.qtd_total || 0} un · {enc.progresso_producao || 0}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${((enc.progresso_producao || 0) >= 100) ? "bg-emerald-500" : "bg-blue-500"} transition-[width] duration-500`} style={{ width: `${Math.min(100, enc.progresso_producao || 0)}%` }} />
      </div>
    </div>
    {(enc.ordens_fabrico || []).length === 0 ? (
      <p className="text-sm text-gray-400 py-6 text-center">Ainda sem ordens de fabrico.</p>
    ) : (
      <div className="space-y-2" data-testid="encomenda-ofs">
        {enc.ordens_fabrico.map((o) => (
          <Link key={o.id} to={`/ordens-fabrico/${o.id}`} data-testid={`encomenda-of-${o.id}`} className="flex items-center justify-between gap-3 border border-gray-200 rounded-sm px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="mono tabular-nums font-medium text-gray-900">{o.numero}</span>
              <span className="text-sm text-gray-500">{Math.round(o.progresso || 0)}%</span>
            </div>
            <StatusBadge status={o.status} />
          </Link>
        ))}
      </div>
    )}
  </div>
);

export const OfFaseadaDialog = ({ open, onOpenChange, artigos, ofQtys, setOfQtys, ofQtyByArtigo, remaining, artUnidade, onCriar }) => {
  const linhas = (artigos || []).filter((a) => a.artigo_id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" data-testid="of-faseada-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Layers size={18} /> Criar Ordem de Fabrico</DialogTitle>
          <DialogDescription>Escolhe a quantidade de cada artigo a produzir nesta OF. Sugerimos a quantidade em falta; podes ajustar livremente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          {linhas.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Esta encomenda não tem artigos.</p>
          ) : linhas.map((a) => {
            const emOFs = ofQtyByArtigo[a.artigo_id] || 0;
            const total = Number(a.quantidade) || 0;
            const rem = remaining(a);
            return (
              <div key={a.id} data-testid={`of-faseada-linha-${a.id}`} className="flex items-center gap-3 border border-gray-200 rounded-sm px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{a.artigo_nome}</div>
                  <div className="text-xs text-gray-400">
                    Total {total} {artUnidade(a.artigo_id)} · Em OFs {emOFs} · <span className={rem > 0 ? "text-amber-600" : "text-emerald-600"}>Em falta {rem}</span>
                  </div>
                </div>
                <input
                  data-testid={`of-faseada-qtd-${a.id}`}
                  type="number" min="0" step="1"
                  value={ofQtys[a.id] ?? 0}
                  onChange={(e) => setOfQtys({ ...ofQtys, [a.id]: e.target.value })}
                  className="w-24 text-right border border-gray-300 rounded-sm px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20"
                />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium">Cancelar</button>
          <button data-testid="of-faseada-criar-btn" onClick={() => { onOpenChange(false); onCriar(); }} className="bg-blue-600 text-white hover:bg-blue-700 rounded-sm px-4 py-2 text-sm font-medium flex items-center gap-2"><Factory size={15} /> Criar OF</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
