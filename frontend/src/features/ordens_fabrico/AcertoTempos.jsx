import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, eur, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import StatusBadge from "@/components/StatusBadge";
import { toast } from "sonner";
import { Clock, History, Search, Save, Timer, X } from "lucide-react";

const fmtMin = (m) => {
  const v = Number(m) || 0;
  const h = Math.floor(v / 60);
  const mm = Math.round(v - h * 60);
  return h > 0 ? `${h}h ${String(mm).padStart(2, "0")}m` : `${Math.round(v * 10) / 10} min`;
};
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));
const chave = (l) => `${l.item_id}:${l.operacao_id}`;

/** Pesquisa de OF por número ou cliente. */
function EscolherOF({ onEscolher }) {
  const [termo, setTermo] = useState("");
  const [res, setRes] = useState([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/ordens-fabrico?page=1&page_size=15&q=${encodeURIComponent(termo.trim())}`);
        setRes(r.items || r || []);
      } catch {
        setRes([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [termo]);

  return (
    <div className="relative max-w-xl">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        value={termo}
        onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder="Nº da OF ou cliente (ex.: OF-0123)…"
        className="w-full border border-gray-300 rounded-sm pl-9 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
        data-testid="acerto-of-pesquisa"
      />
      {aberto && res.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-sm shadow-lg max-h-80 overflow-auto">
          {res.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onEscolher(o.id); setAberto(false); setTermo(""); }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0"
              data-testid={`acerto-of-opt-${o.id}`}
            >
              <span className="min-w-0">
                <span className="mono font-semibold text-gray-900">{o.numero}</span>
                <span className="text-sm text-gray-600 truncate"> · {o.cliente}</span>
              </span>
              <StatusBadge status={o.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AcertoTempos() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const ofId = params.get("of") || "";
  const [dados, setDados] = useState(null);
  const [edits, setEdits] = useState({});
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const podeEditar = can("ordens_fabrico", "edit");

  const carregar = useCallback(async () => {
    if (!ofId) { setDados(null); return; }
    try {
      setDados(await api.get(`/ordens-fabrico/${ofId}/tempos`));
      setEdits({});
    } catch {
      setDados(null);
      toast.error("OF não encontrada");
    }
  }, [ofId]);
  useEffect(() => { carregar(); }, [carregar]);

  const linhas = useMemo(() => (dados?.linhas || []).map((l) => {
    const e = edits[chave(l)] || {};
    const mo = e.mo !== undefined ? num(e.mo) : l.tempo_mao_obra_real;
    const maqTxt = e.maq !== undefined ? e.maq : (l.tempo_maquina_real ?? "");
    const maq = num(maqTxt);
    const custoMaq = maq === null ? l.custo_maquina_est : (maq / 60) * l.taxa_maquina_hora;
    const custoReal = custoMaq + ((mo || 0) / 60) * l.taxa_mao_obra_hora;
    return { ...l, _mo: e.mo !== undefined ? e.mo : String(l.tempo_mao_obra_real ?? 0), _maq: maqTxt === null ? "" : String(maqTxt), moNum: mo || 0, maqNum: maq, custoNovo: custoReal, alterado: !!edits[chave(l)] };
  }), [dados, edits]);

  const totais = useMemo(() => ({
    est: linhas.reduce((s, l) => s + l.custo_estimado, 0),
    antes: linhas.reduce((s, l) => s + l.custo_real, 0),
    depois: linhas.reduce((s, l) => s + l.custoNovo, 0),
    tempoEst: linhas.reduce((s, l) => s + l.tempo_maquina_est + l.tempo_mao_obra_est, 0),
    tempoReal: linhas.reduce((s, l) => s + (l.maqNum ?? l.tempo_maquina_est) + l.moNum, 0),
  }), [linhas]);
  const nAlteradas = linhas.filter((l) => l.alterado).length;

  const setEdit = (l, campo, valor) => setEdits((e) => ({ ...e, [chave(l)]: { ...(e[chave(l)] || {}), [campo]: valor } }));

  const guardar = async () => {
    if (!motivo.trim()) return toast.error("Indique o motivo do acerto");
    const operacoes = linhas.filter((l) => l.alterado).map((l) => {
      const e = edits[chave(l)] || {};
      const out = { item_id: l.item_id, operacao_id: l.operacao_id };
      if (e.mo !== undefined) out.tempo_mao_obra_real = num(e.mo) ?? 0;
      if (e.maq !== undefined) {
        if (num(e.maq) === null) out.limpar_maquina = true;
        else out.tempo_maquina_real = num(e.maq);
      }
      return out;
    });
    if (operacoes.some((o) => (o.tempo_mao_obra_real ?? 0) < 0 || (o.tempo_maquina_real ?? 0) < 0)) {
      return toast.error("Os tempos não podem ser negativos");
    }
    setBusy(true);
    try {
      const out = await api.put(`/ordens-fabrico/${ofId}/tempos`, { motivo: motivo.trim(), operacoes });
      setDados(out);
      setEdits({});
      setMotivo("");
      toast.success("Tempos acertados — custos atualizados");
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não foi possível guardar");
    } finally {
      setBusy(false);
    }
  };

  // agrupar por artigo
  const grupos = [];
  for (const l of linhas) {
    const g = grupos.find((x) => x.item_id === l.item_id);
    if (g) g.linhas.push(l);
    else grupos.push({ item_id: l.item_id, artigo_nome: l.artigo_nome, quantidade: l.quantidade, unidade: l.unidade, linhas: [l] });
  }
  const inputCls = "w-24 border border-gray-300 rounded-sm px-2 py-1.5 text-sm text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-50";

  return (
    <div>
      <PageHeader
        title="Acerto de tempos"
        subtitle="Corrija os tempos reais de máquina e mão de obra de uma OF para acertar os custos de produção"
      />

      <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4">
        <label className="text-sm font-medium text-gray-700 mb-1.5 block">Ordem de fabrico</label>
        <EscolherOF onEscolher={(id) => setParams({ of: id })} />
      </div>

      {!ofId && (
        <div className="bg-white border border-dashed border-gray-300 rounded-sm px-4 py-12 text-center text-sm text-gray-500">
          <Timer size={28} className="mx-auto text-gray-300 mb-2" />
          Escolha uma OF para ver e acertar os tempos utilizados.
        </div>
      )}

      {dados && (
        <>
          <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4 flex flex-wrap items-center justify-between gap-3" data-testid="acerto-of-cabecalho">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link to={`/ordens-fabrico/${dados.of.id}`} className="mono text-lg font-bold text-gray-900 hover:underline">{dados.of.numero}</Link>
                <StatusBadge status={dados.of.status} />
              </div>
              <div className="text-sm text-gray-600 mt-0.5">
                {dados.of.cliente}
                {dados.of.encomenda_id && (
                  <> · <Link to={`/encomendas/${dados.of.encomenda_id}`} className="mono hover:underline">{dados.of.encomenda_numero || "Encomenda"}</Link></>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-right dado-custo">
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-gray-500">Custo estimado</div>
                <div className="font-semibold tabular-nums">{eur(totais.est)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-gray-500">Custo real</div>
                <div className="font-semibold tabular-nums" data-testid="acerto-custo-real">{eur(totais.depois)}</div>
                {nAlteradas > 0 && Math.abs(totais.depois - totais.antes) > 0.004 && (
                  <div className="text-[11px] text-gray-400 tabular-nums">antes {eur(totais.antes)}</div>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-gray-500">Desvio</div>
                <div className={`font-semibold tabular-nums ${totais.depois - totais.est > 0.004 ? "text-red-600" : "text-emerald-700"}`}>
                  {totais.depois - totais.est > 0 ? "+" : ""}{eur(totais.depois - totais.est)}
                </div>
              </div>
            </div>
          </div>

          {linhas.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-sm px-4 py-10 text-center text-sm text-gray-400">Esta OF não tem operações.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-sm overflow-x-auto mb-4">
              <table className="w-full text-sm min-w-[900px]" data-testid="acerto-tabela">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-[0.08em] text-gray-500">
                    <th className="text-left px-4 py-2.5 font-semibold">Operação</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Máquina est.</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Máquina real (min)</th>
                    <th className="text-right px-3 py-2.5 font-semibold">M. obra est.</th>
                    <th className="text-right px-3 py-2.5 font-semibold">M. obra real (min)</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Custo est.</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Custo real</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <FragmentGrupo key={g.item_id} g={g} podeEditar={podeEditar} setEdit={setEdit} inputCls={inputCls} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td colSpan={2} className="px-3 py-2.5 text-right text-xs text-gray-500 font-normal">tempo estimado {fmtMin(totais.tempoEst)}</td>
                    <td colSpan={2} className="px-3 py-2.5 text-right text-xs text-gray-500 font-normal">tempo real {fmtMin(totais.tempoReal)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{eur(totais.est)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{eur(totais.depois)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {podeEditar && linhas.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-sm p-4 mb-4 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Motivo do acerto <span className="text-red-600">*</span></label>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: cronómetro ficou ligado durante o almoço"
                  className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  data-testid="acerto-motivo"
                />
              </div>
              <div className="flex gap-2">
                {nAlteradas > 0 && (
                  <button type="button" onClick={() => setEdits({})} disabled={busy} className="btn btn-secundario">
                    <X size={15} /> Repor
                  </button>
                )}
                <button type="button" onClick={guardar} disabled={busy || nAlteradas === 0} className="btn btn-primario" data-testid="acerto-guardar">
                  <Save size={15} /> {busy ? "A guardar…" : `Guardar acerto${nAlteradas ? ` (${nAlteradas})` : ""}`}
                </button>
              </div>
            </div>
          )}

          {(dados.acertos || []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-sm p-4" data-testid="acerto-historico">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><History size={15} /> Acertos anteriores</h3>
              <ul className="space-y-3">
                {dados.acertos.map((a, i) => (
                  <li key={i} className="text-sm border-l-2 border-brand/40 pl-3">
                    <div className="text-gray-900">
                      <span className="font-medium">{a.motivo}</span>
                      <span className="text-gray-500"> · {fmtDate(a.at)}{a.por ? ` · ${a.por}` : ""}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(a.alteracoes || []).map((x) => `${x.operacao} — ${x.campo}: ${x.de} → ${x.para}`).join(" · ")}
                    </div>
                    <div className="text-xs text-gray-500 tabular-nums">Custo real {eur(a.custo_antes)} → {eur(a.custo_depois)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FragmentGrupo({ g, podeEditar, setEdit, inputCls }) {
  return (
    <>
      <tr className="bg-gray-50/60 border-b border-gray-100">
        <td colSpan={7} className="px-4 py-2 text-xs font-semibold text-gray-700">
          {g.artigo_nome} <span className="font-normal text-gray-500">· {g.quantidade} {g.unidade}</span>
        </td>
      </tr>
      {g.linhas.map((l) => (
        <tr key={l.operacao_id} className={`border-b border-gray-100 ${l.alterado ? "bg-brand-soft/40" : ""}`} data-testid={`acerto-linha-${l.operacao_id}`}>
          <td className="px-4 py-2">
            <div className="font-medium text-gray-900 flex items-center gap-1.5">
              {l.operacao}
              {l.em_curso && <span className="inline-flex items-center gap-1 text-[11px] text-blue-700"><Clock size={11} /> a contar</span>}
            </div>
            <div className="text-xs text-gray-500">{[l.maquina_nome, l.mao_obra_nome].filter(Boolean).join(" · ") || "—"}</div>
          </td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtMin(l.tempo_maquina_est)}</td>
          <td className="px-3 py-2 text-right">
            <input
              type="number" min="0" step="0.5"
              className={inputCls}
              value={l._maq}
              placeholder={String(l.tempo_maquina_est)}
              disabled={!podeEditar || l.em_curso || (!l.tempo_maquina_est && !l.taxa_maquina_hora)}
              onChange={(e) => setEdit(l, "maq", e.target.value)}
              title="Vazio = usa o tempo estimado"
              data-testid={`acerto-maq-${l.operacao_id}`}
            />
          </td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtMin(l.tempo_mao_obra_est)}</td>
          <td className="px-3 py-2 text-right">
            <input
              type="number" min="0" step="0.5"
              className={inputCls}
              value={l._mo}
              disabled={!podeEditar || l.em_curso}
              onChange={(e) => setEdit(l, "mo", e.target.value)}
              data-testid={`acerto-mo-${l.operacao_id}`}
            />
          </td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{eur(l.custo_estimado)}</td>
          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur(l.custoNovo)}</td>
        </tr>
      ))}
    </>
  );
}
