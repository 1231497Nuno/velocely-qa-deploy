import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fieldCls } from "@/features/artigos/ArtigoInlineEdit";

/**
 * Editor de variantes livres.
 * - modo "live": artigo já guardado (paiId) — lista/API add/remove
 * - modo "draft": criação — variantes em memória, devolve via onChange
 */
export default function ArtigoVariantesEditor({
  paiId = null,
  draftVariantes = null,
  onDraftChange = null,
  canEdit = true,
  paiNome = "",
}) {
  const nav = useNavigate();
  const isDraft = !paiId;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    if (!paiId) return;
    setLoading(true);
    try {
      const d = await api.get(`/artigos/${paiId}/variantes`);
      setRows(d.variantes || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erro a carregar variantes");
    } finally {
      setLoading(false);
    }
  }, [paiId]);

  useEffect(() => {
    if (isDraft) {
      setRows(Array.isArray(draftVariantes) ? draftVariantes : []);
    } else {
      load();
    }
  }, [isDraft, draftVariantes, load]);

  const adicionar = async () => {
    const lab = (label || "").trim();
    if (!lab) return toast.error("Escreva o nome da variante (ex.: Preto / M)");
    if (isDraft) {
      const next = [
        ...rows,
        {
          _tmp: `tmp-${Date.now()}`,
          variante_label: lab,
          variante_atributos: {},
          nome: paiNome ? `${paiNome} — ${lab}` : lab,
        },
      ];
      setRows(next);
      onDraftChange?.(next);
      setLabel("");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post(`/artigos/${paiId}/variantes`, {
        variantes: [{ label: lab, atributos: {} }],
      });
      if ((res.total || 0) === 0) toast.message("Variante já existia");
      else toast.success("Variante adicionada");
      setLabel("");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Erro ao adicionar");
    } finally {
      setBusy(false);
    }
  };

  const remover = async (row) => {
    if (isDraft) {
      const next = rows.filter((r) => (r._tmp || r.id) !== (row._tmp || row.id));
      setRows(next);
      onDraftChange?.(next);
      return;
    }
    if (!window.confirm(`Remover a variante «${row.variante_label || row.nome}»?`)) return;
    setBusy(true);
    try {
      const res = await api.del(`/artigos/${paiId}/variantes/${row.id}`);
      toast.success(res?.soft ? "Variante inactivada (em uso no histórico)" : "Variante removida");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Erro ao remover");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-sm border border-gray-200 bg-white" data-testid="artigo-variantes-editor">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-900">Variantes</div>
        <p className="text-xs text-gray-500 mt-0.5">
          Escreva o nome (ex.: Preto / M) e clique Adicionar. Pode remover quando quiser.
        </p>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-sm text-gray-400">A carregar…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                {!isDraft && <th className="px-4 py-2 font-semibold">Código</th>}
                <th className="px-4 py-2 font-semibold">Variante</th>
                {!isDraft && <th className="px-4 py-2 font-semibold text-right">Stock</th>}
                {canEdit && <th className="px-4 py-2 w-12" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id || r._tmp}
                  className="border-b border-gray-50 hover:bg-gray-50"
                  data-testid={`variante-row-${r.id || r._tmp}`}
                >
                  {!isDraft && (
                    <td className="px-4 py-2 mono tabular-nums text-gray-600">
                      {r.id ? (
                        <button type="button" className="hover:underline" onClick={() => nav(`/artigos/${r.id}`)}>
                          {r.codigo}
                        </button>
                      ) : (
                        r.codigo
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2 font-medium text-gray-900">{r.variante_label || r.nome}</td>
                  {!isDraft && (
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{r.qtd_stock ?? 0}</td>
                  )}
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        title="Remover"
                        data-testid={`variante-rem-${r.id || r._tmp}`}
                        disabled={busy}
                        onClick={() => remover(r)}
                        className="p-1.5 rounded-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isDraft ? 2 : 4} className="px-4 py-6 text-center text-sm text-gray-400">
                    Ainda sem variantes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60" data-testid="variante-add-form">
          <label className="text-xs text-gray-600">Nome da variante</label>
          <div className="mt-1 flex flex-wrap gap-2 items-center">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }}
              placeholder="ex.: Preto / M"
              className={`${fieldCls} flex-1 min-w-[12rem]`}
              data-testid="variante-label-input"
            />
            <button
              type="button"
              disabled={busy}
              onClick={adicionar}
              data-testid="variante-add-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-black text-white rounded-sm hover:bg-gray-800 disabled:opacity-50"
            >
              <Plus size={14} /> {busy ? "…" : "Adicionar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Após criar o artigo pai, cria as variantes em draft. */
export async function persistDraftVariantes(paiId, draftVariantes) {
  const list = (draftVariantes || []).filter((v) => v?.variante_label);
  if (!paiId || !list.length) return { total: 0 };
  return api.post(`/artigos/${paiId}/variantes`, {
    variantes: list.map((v) => ({
      label: v.variante_label,
      atributos: v.variante_atributos || {},
      nome: v.nome,
    })),
  });
}
