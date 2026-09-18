import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/pt";
import { eur } from "@/lib/api";
import ImagemUpload from "@/components/ImagemUpload";
import { FieldGrid, FieldRow } from "@/features/artigos/ArtigoBlocosShell";
import { InlineField, InlineSelect, fieldCls, contentWidthCh, fitInputCls, fitSelectCls } from "@/features/artigos/ArtigoInlineEdit";
import {
  TIPOS_ARTIGO,
  TIPO_ARTIGO_PT,
  camposBloco,
  normalizarTipo,
  isProduzido,
} from "@/features/artigos/artigoTipos";

dayjs.extend(relativeTime);
dayjs.locale("pt");

const UNIDADES = ["un", "kg", "g", "m", "cm", "m²", "L", "ml", "folha", "par", "h"];
const UNIDADES_LINEAR = ["mm", "cm", "m", "in"];
const UNIDADES_PESO = ["kg", "g", "mg", "t", "lb"];

function RelBadge({ iso }) {
  if (!iso) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 whitespace-nowrap">
      {d.fromNow()}
    </span>
  );
}

/**
 * Blocos de campos. Em vista normal: clique num campo → edita e grava no blur.
 * Em modo Editar: inputs ligados ao draft.
 */
export default function ArtigoFichaCampos({
  blocoId,
  artigo,
  draft,
  editing,
  canEdit,
  categorias = [],
  subcategorias = [],
  onChange,
  onPatch,
  onSetTipo,
  onSetProduzido,
  onSetCategoria,
  onSetSubcategoria,
  precoVenda,
}) {
  const src = editing ? draft : artigo;
  if (!src) return null;
  const tipo = normalizarTipo(src);
  const campos = new Set(camposBloco(blocoId, tipo));
  const show = (c) => campos.has(c);
  const catId = editing ? (draft?.categoria_id || "") : (artigo?.categoria_id || "");
  const subsDaCat = subcategorias.filter((s) => s.categoria_id === catId);

  const patchNum = (key) => (v) => onPatch?.({ [key]: Number(v) || 0 });
  const patchStr = (key) => (v) => onPatch?.({ [key]: String(v ?? "") });

  if (blocoId === "detalhes") {
    return (
      <div>
        <div className="px-4 py-3 border-b border-gray-100 flex gap-4 items-start">
          {show("imagem") && (
            <ImagemUpload
              value={editing ? draft?.imagem : artigo?.imagem}
              editable={editing || canEdit}
              onChange={(p) => (editing ? onChange?.({ imagem: p || "" }) : onPatch?.({ imagem: p || "" }))}
              size={64}
              testid="artigo-detail-imagem"
            />
          )}
          {show("descricao") && (
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-1">Descrição</div>
              {editing ? (
                <textarea
                  rows={2}
                  value={draft?.descricao || ""}
                  onChange={(e) => onChange?.({ descricao: e.target.value })}
                  className={`${fieldCls} text-left`}
                  data-testid="artigo-desc-input"
                />
              ) : (
                <InlineField
                  value={artigo?.descricao || ""}
                  canEdit={canEdit}
                  multiline
                  align="left"
                  onSave={patchStr("descricao")}
                  testid="artigo-desc-edit"
                  placeholder="Clique para adicionar descrição"
                  className="text-sm text-gray-700 whitespace-pre-wrap"
                />
              )}
            </div>
          )}
        </div>
        <FieldGrid>
          {show("nome") && (
            <FieldRow label="Nome produto" testid="ficha-nome">
              {editing ? (
                <input value={draft?.nome || ""} onChange={(e) => onChange?.({ nome: e.target.value })} className={fieldCls} data-testid="artigo-nome-input" />
              ) : (
                <InlineField value={artigo?.nome || ""} canEdit={canEdit} onSave={(v) => onPatch?.({ nome: String(v).trim() })} testid="artigo-nome-edit" />
              )}
            </FieldRow>
          )}
          {show("codigo") && (
            <FieldRow label="Nº produto" testid="ficha-codigo">
              <span className="mono tabular-nums font-medium">{artigo?.codigo || "—"}</span>
            </FieldRow>
          )}
          {show("tipo_artigo") && (
            <FieldRow label="Tipo" testid="ficha-tipo">
              {editing ? (
                <select
                  value={tipo}
                  onChange={(e) => onSetTipo?.(e.target.value)}
                  className={fieldCls}
                  data-testid="artigo-tipo-select"
                >
                  {TIPOS_ARTIGO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              ) : (
                <InlineSelect
                  value={tipo}
                  display={TIPO_ARTIGO_PT[tipo] || tipo}
                  canEdit={canEdit}
                  allowEmpty={false}
                  options={TIPOS_ARTIGO.map((t) => ({ value: t.id, label: t.label }))}
                  onSave={(v) => onSetTipo?.(v)}
                  testid="artigo-tipo"
                />
              )}
            </FieldRow>
          )}
          {show("produzido") && tipo === "ativo" && (
            <FieldRow label="Produzido" testid="ficha-produzido">
              <label className="inline-flex items-center justify-end gap-2 cursor-pointer" data-testid="artigo-produzido-check">
                <input
                  type="checkbox"
                  checked={editing ? !!draft?.produzido : isProduzido(artigo)}
                  disabled={editing ? false : !canEdit}
                  onChange={(e) => onSetProduzido?.(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">{(editing ? draft?.produzido : isProduzido(artigo)) ? "Sim" : "Não"}</span>
              </label>
            </FieldRow>
          )}
          {show("fabricante") && (
            <FieldRow label="Fabricante" testid="ficha-fabricante">
              {editing ? (
                <input value={draft?.fabricante || ""} onChange={(e) => onChange?.({ fabricante: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.fabricante || ""} canEdit={canEdit} onSave={patchStr("fabricante")} testid="artigo-fabricante" />
              )}
            </FieldRow>
          )}
          {show("categoria") && (
            <FieldRow label="Categoria de produto" testid="ficha-categoria">
              {editing ? (
                <select value={draft?.categoria_id || ""} onChange={(e) => onSetCategoria?.(e.target.value)} className={fieldCls} data-testid="artigo-categoria-select">
                  <option value="">— Sem categoria —</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              ) : (
                <InlineSelect
                  value={artigo?.categoria_id}
                  display={artigo?.categoria_nome}
                  canEdit={canEdit}
                  options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
                  onSave={(v) => onSetCategoria?.(v)}
                  emptyLabel="— Sem categoria —"
                  testid="artigo-categoria"
                />
              )}
            </FieldRow>
          )}
          {show("fornecedor") && (
            <FieldRow label="Fornecedor" testid="ficha-fornecedor">
              {editing ? (
                <input value={draft?.fornecedor_nome || ""} onChange={(e) => onChange?.({ fornecedor_nome: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.fornecedor_nome || ""} canEdit={canEdit} onSave={patchStr("fornecedor_nome")} testid="artigo-fornecedor" />
              )}
            </FieldRow>
          )}
          {show("subcategoria") && (
            <FieldRow label="Sub categoria" testid="ficha-subcategoria">
              {editing ? (
                <select
                  value={draft?.subcategoria_id || ""}
                  disabled={!draft?.categoria_id}
                  onChange={(e) => onSetSubcategoria?.(e.target.value)}
                  className={`${fieldCls} disabled:bg-gray-50`}
                  data-testid="artigo-subcategoria-select"
                >
                  <option value="">— Sem subcategoria —</option>
                  {subsDaCat.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              ) : (
                <InlineSelect
                  value={artigo?.subcategoria_id}
                  display={artigo?.subcategoria_nome}
                  canEdit={canEdit}
                  disabled={!artigo?.categoria_id}
                  options={subcategorias.filter((s) => s.categoria_id === artigo?.categoria_id).map((s) => ({ value: s.id, label: s.nome }))}
                  onSave={(v) => onSetSubcategoria?.(v)}
                  emptyLabel="— Sem subcategoria —"
                  testid="artigo-subcategoria"
                />
              )}
            </FieldRow>
          )}
          {show("cod_fornecedor") && (
            <FieldRow label="Cód. fornecedor" testid="ficha-cod-fornecedor">
              {editing ? (
                <input value={draft?.cod_fornecedor || ""} onChange={(e) => onChange?.({ cod_fornecedor: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.cod_fornecedor || ""} canEdit={canEdit} onSave={patchStr("cod_fornecedor")} testid="artigo-cod-fornecedor" />
              )}
            </FieldRow>
          )}
          {show("website") && (
            <FieldRow label="Website" testid="ficha-website">
              {editing ? (
                <input value={draft?.website || ""} onChange={(e) => onChange?.({ website: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.website || ""} canEdit={canEdit} onSave={patchStr("website")} testid="artigo-website" />
              )}
            </FieldRow>
          )}
          {show("ficha_produto") && (
            <FieldRow label="Ficha do produto" testid="ficha-ficha">
              {editing ? (
                <input value={draft?.ficha_produto || ""} onChange={(e) => onChange?.({ ficha_produto: e.target.value })} className={fieldCls} placeholder="URL ou referência" />
              ) : (
                <InlineField value={artigo?.ficha_produto || ""} canEdit={canEdit} onSave={patchStr("ficha_produto")} testid="artigo-ficha" />
              )}
            </FieldRow>
          )}
          {show("cod_fabricante") && (
            <FieldRow label="Cód. fabricante" testid="ficha-cod-fabricante">
              {editing ? (
                <input value={draft?.cod_fabricante || ""} onChange={(e) => onChange?.({ cod_fabricante: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.cod_fabricante || ""} canEdit={canEdit} onSave={patchStr("cod_fabricante")} testid="artigo-cod-fabricante" />
              )}
            </FieldRow>
          )}
          {show("plano_contas") && (
            <FieldRow label="Plano de contas" testid="ficha-plano">
              {editing ? (
                <input value={draft?.plano_contas || ""} onChange={(e) => onChange?.({ plano_contas: e.target.value })} className={fieldCls} />
              ) : (
                <InlineField value={artigo?.plano_contas || ""} canEdit={canEdit} onSave={patchStr("plano_contas")} testid="artigo-plano" />
              )}
            </FieldRow>
          )}
          {show("created_at") && (
            <FieldRow label="Data criação" testid="ficha-created">
              <span className="inline-flex items-center justify-end flex-wrap">
                <span className="tabular-nums font-medium">{artigo?.created_at ? dayjs(artigo.created_at).format("DD-MM-YYYY HH:mm:ss") : "—"}</span>
                <RelBadge iso={artigo?.created_at} />
              </span>
            </FieldRow>
          )}
          {show("created_by") && (
            <FieldRow label="Criado por" testid="ficha-created-by">
              <span className="font-medium">{artigo?.created_by_nome || "—"}</span>
            </FieldRow>
          )}
          {show("updated_at") && (
            <FieldRow label="Data modificação" testid="ficha-updated">
              <span className="inline-flex items-center justify-end flex-wrap">
                <span className="tabular-nums font-medium">{artigo?.updated_at ? dayjs(artigo.updated_at).format("DD-MM-YYYY HH:mm:ss") : "—"}</span>
                <RelBadge iso={artigo?.updated_at} />
              </span>
            </FieldRow>
          )}
        </FieldGrid>
        {editing && tipo === "ativo" && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500" data-testid="artigo-tipo-selector">
            Ao marcar «Produzido» aparecem os blocos de materiais e operações.
          </div>
        )}
      </div>
    );
  }

  if (blocoId === "dimensoes") {
    const dims = [
      { key: "comprimento_mm", unitKey: "comprimento_unidade", label: "Comprimento", units: UNIDADES_LINEAR, defaultUnit: "mm" },
      { key: "largura_mm", unitKey: "largura_unidade", label: "Largura", units: UNIDADES_LINEAR, defaultUnit: "mm" },
      { key: "espessura_mm", unitKey: "espessura_unidade", label: "Espessura", units: UNIDADES_LINEAR, defaultUnit: "mm" },
      { key: "peso_kg", unitKey: "peso_unidade", label: "Peso", units: UNIDADES_PESO, defaultUnit: "kg", step: "0.001" },
    ];
    return (
      <FieldGrid>
        {dims.map(({ key, unitKey, label, units, defaultUnit, step }) => {
          const unit = (editing ? draft?.[unitKey] : artigo?.[unitKey]) || defaultUnit;
          const editable = editing || canEdit;
          return (
            <FieldRow key={key} label={label} testid={`ficha-${key}`}>
              {editable ? (
                <div className="inline-flex items-center gap-1.5 justify-end">
                  {editing ? (
                    <input
                      type="number"
                      step={step}
                      value={draft?.[key] ?? 0}
                      onChange={(e) => onChange?.({ [key]: e.target.value })}
                      className={`${fitInputCls} text-right`}
                      style={{
                        width: contentWidthCh(draft?.[key] ?? 0, { min: 5, max: 16, pad: 2.5 }),
                        minWidth: "5ch",
                        maxWidth: "16ch",
                      }}
                    />
                  ) : (
                    <InlineField
                      value={artigo?.[key] ?? 0}
                      display={String(artigo?.[key] ?? 0)}
                      type="number"
                      canEdit={canEdit}
                      mono
                      fit
                      fitMin={5}
                      fitMax={16}
                      onSave={patchNum(key)}
                      testid={`artigo-${key}`}
                    />
                  )}
                  <select
                    value={unit}
                    onChange={(e) => {
                      const v = e.target.value || defaultUnit;
                      if (editing) onChange?.({ [unitKey]: v });
                      else onPatch?.({ [unitKey]: v });
                    }}
                    className={fitSelectCls}
                    style={{
                      width: contentWidthCh(unit, { min: 5.5, max: 7, pad: 3 }),
                      minWidth: "3.5rem",
                      maxWidth: "4.5rem",
                    }}
                    data-testid={`artigo-${unitKey}`}
                  >
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              ) : (
                <span className="tabular-nums font-medium">{artigo?.[key] ?? 0} {unit}</span>
              )}
            </FieldRow>
          );
        })}
      </FieldGrid>
    );
  }

  if (blocoId === "preco") {
    return (
      <FieldGrid>
        {show("preco_venda") && (
          <FieldRow label="Preço unitário (€)" testid="ficha-preco">
            <span className="tabular-nums font-medium text-emerald-700">{eur(precoVenda ?? artigo?.preco_venda)}</span>
          </FieldRow>
        )}
        {show("custo_artigo") && (
          <FieldRow label="Preço custo / compra" testid="ficha-custo">
            {editing ? (
              <input type="number" step="0.01" value={draft?.custo_artigo ?? 0} onChange={(e) => onChange?.({ custo_artigo: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.custo_artigo} display={eur(artigo?.custo_artigo)} type="number" canEdit={canEdit} mono onSave={patchNum("custo_artigo")} testid="artigo-custo" />
            )}
          </FieldRow>
        )}
        {show("margem") && (
          <FieldRow label="Margem %" testid="ficha-margem">
            {editing ? (
              <input type="number" value={draft?.margem ?? 0} onChange={(e) => onChange?.({ margem: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.margem} display={`${Number(artigo?.margem) || 0}%`} type="number" canEdit={canEdit} mono onSave={patchNum("margem")} testid="artigo-margem-ficha" />
            )}
          </FieldRow>
        )}
        {show("comissao_pct") && (
          <FieldRow label="Comissão %" testid="ficha-comissao">
            {editing ? (
              <input type="number" step="0.01" value={draft?.comissao_pct ?? 0} onChange={(e) => onChange?.({ comissao_pct: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <div className="inline-flex flex-col items-end gap-1 w-full">
                <InlineField value={artigo?.comissao_pct} display={`${Number(artigo?.comissao_pct) || 0}%`} type="number" canEdit={canEdit} mono onSave={patchNum("comissao_pct")} testid="artigo-comissao" />
                <div className="h-1 w-24 bg-gray-100 rounded-sm overflow-hidden">
                  <div className="h-full bg-gray-400" style={{ width: `${Math.min(100, Number(artigo?.comissao_pct) || 0)}%` }} />
                </div>
              </div>
            )}
          </FieldRow>
        )}
      </FieldGrid>
    );
  }

  if (blocoId === "stock") {
    return (
      <FieldGrid>
        {show("unidade") && (
          <FieldRow label="Unidade utilizada" testid="ficha-unidade">
            {editing ? (
              <select value={draft?.unidade || "un"} onChange={(e) => onChange?.({ unidade: e.target.value })} className={fieldCls}>
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            ) : (
              <InlineSelect
                value={artigo?.unidade || "un"}
                display={artigo?.unidade || "un"}
                canEdit={canEdit}
                allowEmpty={false}
                options={UNIDADES.map((u) => ({ value: u, label: u }))}
                onSave={(v) => onPatch?.({ unidade: v || "un" })}
                testid="artigo-unidade"
              />
            )}
          </FieldRow>
        )}
        {show("qtd_uni") && (
          <FieldRow label="Qtd. uni" testid="ficha-qtd-uni">
            {editing ? (
              <input type="number" value={draft?.qtd_uni ?? 1} onChange={(e) => onChange?.({ qtd_uni: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.qtd_uni ?? 1} type="number" canEdit={canEdit} mono onSave={patchNum("qtd_uni")} testid="artigo-qtd-uni" />
            )}
          </FieldRow>
        )}
        {show("qtd_stock") && (
          <FieldRow label="Qtd. stock" testid="ficha-qtd-stock">
            {editing ? (
              <input type="number" value={draft?.qtd_stock ?? 0} onChange={(e) => onChange?.({ qtd_stock: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.qtd_stock ?? 0} type="number" canEdit={canEdit} mono onSave={patchNum("qtd_stock")} testid="artigo-qtd-stock" />
            )}
          </FieldRow>
        )}
        {show("nivel_reabastecimento") && (
          <FieldRow label="Nível reabastecimento" testid="ficha-nivel">
            {editing ? (
              <input type="number" value={draft?.nivel_reabastecimento ?? 0} onChange={(e) => onChange?.({ nivel_reabastecimento: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.nivel_reabastecimento ?? 0} type="number" canEdit={canEdit} mono onSave={patchNum("nivel_reabastecimento")} testid="artigo-nivel" />
            )}
          </FieldRow>
        )}
        {show("responsavel") && (
          <FieldRow label="Responsável" testid="ficha-responsavel">
            {editing ? (
              <input value={draft?.responsavel || ""} onChange={(e) => onChange?.({ responsavel: e.target.value })} className={fieldCls} />
            ) : (
              <InlineField
                value={artigo?.responsavel || ""}
                display={artigo?.responsavel ? undefined : null}
                canEdit={canEdit}
                onSave={patchStr("responsavel")}
                testid="artigo-responsavel"
                className={artigo?.responsavel ? "inline-flex items-center rounded-sm bg-violet-100 text-violet-800 px-2 py-0.5 text-xs font-medium" : ""}
              />
            )}
          </FieldRow>
        )}
        {show("qtd_ultima_compra") && (
          <FieldRow label="Qtd. última compra" testid="ficha-qtd-compra">
            {editing ? (
              <input type="number" value={draft?.qtd_ultima_compra ?? 0} onChange={(e) => onChange?.({ qtd_ultima_compra: e.target.value })} className={`${fieldCls} tabular-nums`} />
            ) : (
              <InlineField value={artigo?.qtd_ultima_compra ?? 0} type="number" canEdit={canEdit} mono onSave={patchNum("qtd_ultima_compra")} testid="artigo-qtd-compra" />
            )}
          </FieldRow>
        )}
      </FieldGrid>
    );
  }

  return null;
}
