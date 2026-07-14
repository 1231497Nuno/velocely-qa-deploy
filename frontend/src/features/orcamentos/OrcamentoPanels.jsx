import { eur } from "@/lib/api";
import { Trash2 } from "lucide-react";

export function OrcamentoMateriais({ materiais, consumiveis, addMaterial, delMaterial, updMaterial, matValor, isM2 }) {
  return (
    <div className="bg-white border border-gray-200 rounded-sm p-5 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 font-display">Materiais / Consumíveis</h2>
          <p className="text-xs text-gray-500">Materiais soltos adicionados ao orçamento, com margem editável por linha.</p>
        </div>
        <select
          data-testid="add-material-select"
          value=""
          onChange={(e) => { if (e.target.value) addMaterial(e.target.value); e.target.value = ""; }}
          className="border border-dashed border-gray-300 rounded-sm px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-black/20 sm:w-64"
        >
          <option value="">+ Adicionar material…</option>
          {consumiveis.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.unidade} · {eur(c.custo_unitario)})</option>)}
        </select>
      </div>

      {(materiais || []).length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">Sem materiais adicionados.</p>
      ) : (
        <div className="space-y-3" data-testid="materiais-list">
          {(materiais || []).map((m, i) => (
            <div key={m.id || i} data-testid={`material-row-${i}`} className="border border-gray-200 rounded-sm p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium text-gray-900 text-sm">{m.nome} <span className="text-gray-400 font-normal">· {m.unidade} · {eur(m.custo_unitario)}/{m.unidade}</span></div>
                <button data-testid={`del-material-${i}`} onClick={() => delMaterial(i)} className="p-1.5 rounded-sm hover:bg-red-100 text-red-600"><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Quantidade</label>
                  <input data-testid={`material-qtd-${i}`} type="number" min="0" value={m.quantidade} onChange={(e) => updMaterial(i, { quantidade: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                </div>
                {isM2(m.unidade) && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Comprimento (mm)</label>
                      <input data-testid={`material-comp-${i}`} type="number" min="0" value={m.comprimento_mm} onChange={(e) => updMaterial(i, { comprimento_mm: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Largura (mm)</label>
                      <input data-testid={`material-larg-${i}`} type="number" min="0" value={m.largura_mm} onChange={(e) => updMaterial(i, { largura_mm: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Margem (%)</label>
                  <input data-testid={`material-margem-${i}`} type="number" min="0" value={m.margem ?? 50} onChange={(e) => updMaterial(i, { margem: e.target.value })} className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-black/20" />
                </div>
                <div className="text-right">
                  <label className="text-xs text-gray-500 mb-1 block">Valor</label>
                  <div className="tabular-nums font-semibold text-gray-900 py-2" data-testid={`material-valor-${i}`}>{eur(matValor(m))}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrcamentoTotais({ subtotalVenda, totalPers, totalMateriais, descontoLinhas = 0, descTotal, descTotalTipo = "pct", descTotalVal = 0, onDescTotal, onDescTotalTipo, custoProducao, lucro, total }) {
  return (
    <div className="flex justify-end">
      <div className="bg-white border border-gray-200 rounded-sm p-5 w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Preço dos artigos</span>
          <span className="tabular-nums font-medium" data-testid="orc-subtotal-venda">{eur(subtotalVenda)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Personalização</span>
          <span className="tabular-nums font-medium" data-testid="orc-personalizacao">{eur(totalPers)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Materiais</span>
          <span className="tabular-nums font-medium" data-testid="orc-materiais">{eur(totalMateriais)}</span>
        </div>
        {descontoLinhas > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Desconto nas linhas</span>
            <span className="tabular-nums text-red-600" data-testid="orc-desconto-linhas">- {eur(descontoLinhas)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-3">
          <span className="text-gray-500">Desconto no total</span>
          <div className="flex items-center gap-1">
            <input data-testid="orc-desc-total-input" type="number" min="0" step="0.01" value={descTotal ?? 0} onChange={(e) => onDescTotal && onDescTotal(e.target.value)} className="w-20 text-right border border-gray-300 rounded-sm px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20" />
            <select data-testid="orc-desc-total-tipo" value={descTotalTipo} onChange={(e) => onDescTotalTipo && onDescTotalTipo(e.target.value)} className="border border-gray-300 rounded-sm px-1 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black/20">
              <option value="pct">%</option>
              <option value="eur">€</option>
            </select>
          </div>
        </div>
        {descTotalVal > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Valor do desconto total</span>
            <span className="tabular-nums text-red-600" data-testid="orc-desc-total-val">- {eur(descTotalVal)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-3">
          <span className="text-gray-400">Custo de produção</span>
          <span className="tabular-nums text-gray-400" data-testid="orc-subtotal">{eur(custoProducao)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Lucro estimado</span>
          <span className="tabular-nums text-emerald-600" data-testid="orc-lucro">{eur(lucro)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 pt-3">
          <span className="font-semibold text-gray-900">Preço Final</span>
          <span className="tabular-nums font-bold text-xl font-display" data-testid="orc-total">{eur(total)}</span>
        </div>
      </div>
    </div>
  );
}
