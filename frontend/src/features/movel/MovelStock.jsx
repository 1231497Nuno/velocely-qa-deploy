import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ArrowDown } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { useLocalizacoes } from "@/features/stock/StockLocais";
import { MovelHeader, Pagina, BotaoGrande, Quantidade, ArtigoPicker, ArtigoCartao, LocalPicker, num, erro, vibrar } from "./comum";

/** Stock do artigo por localização (GET /stock/artigos/{id}). */
function useStockArtigo(artigo) {
  const [s, setS] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    setS(null);
    if (!artigo) return;
    api.get(`/stock/artigos/${artigo.id}`).then(setS).catch((e) => erro(e, "Erro a carregar o stock"));
  }, [artigo, n]);
  return [s, () => setN((x) => x + 1)];
}

const porLocal = (s) => Object.fromEntries((s?.localizacoes || []).map((l) => [l.localizacao_id, l.quantidade]));

/** Transferir stock entre localizações. */
export function MovelTransferir() {
  const [locs] = useLocalizacoes();
  const [artigo, setArtigo] = useState(null);
  const [s] = useStockArtigo(artigo);
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const [qtd, setQtd] = useState("");
  const [busy, setBusy] = useState(false);
  const q = porLocal(s);
  const origens = (s?.localizacoes || []).filter((l) => l.quantidade > 0).map((l) => ({ id: l.localizacao_id, nome: l.nome }));
  useEffect(() => { if (s) { setDe(origens[0]?.id || ""); setPara(""); setQtd(""); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = async () => {
    if (!de || !para) { toast.error("Escolha a origem e o destino"); return; }
    if (de === para) { toast.error("A origem e o destino são iguais"); return; }
    if (!(Number(qtd) > 0)) { toast.error("Indique a quantidade"); return; }
    setBusy(true);
    try {
      await api.post("/stock/transferir", { artigo_id: artigo.id, de, para, quantidade: Number(qtd) });
      vibrar(40);
      toast.success(`${num(qtd)} ${s.unidade} de ${artigo.nome} → ${locs.find((l) => l.id === para)?.nome || ""}`);
      setArtigo(null);
    } catch (e) { erro(e, "Não foi possível transferir"); } finally { setBusy(false); }
  };

  return (
    <Pagina>
      <MovelHeader titulo="Transferir" />
      <div className="p-4 space-y-4">
        {!artigo ? <ArtigoPicker onEscolher={setArtigo} /> : (
          <ArtigoCartao artigo={artigo} onLimpar={() => setArtigo(null)}>
            {!s ? <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div> : !origens.length ? (
              <p className="mt-3 text-sm text-gray-600">Este artigo não tem stock em nenhuma localização.</p>
            ) : (
              <div className="mt-3 space-y-4">
                <LocalPicker value={de} onChange={setDe} titulo="De" opcoes={origens} quantidades={q} testid="movel-de" />
                <div className="flex justify-center text-gray-400"><ArrowDown className="w-6 h-6" /></div>
                <LocalPicker value={para} onChange={setPara} titulo="Para" opcoes={locs.filter((l) => l.id !== de && l.ativo !== false)} quantidades={q} testid="movel-para" />
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quantidade</span>
                    {de && <button type="button" className="text-xs font-semibold px-2 py-1 rounded bg-gray-200 active:bg-gray-300" onClick={() => setQtd(String(q[de] || 0))}>Tudo ({num(q[de])})</button>}
                  </div>
                  <Quantidade value={qtd} onChange={setQtd} unidade={s.unidade} />
                </div>
                <BotaoGrande variante="sucesso" onClick={gravar} disabled={busy} data-testid="movel-gravar-transferencia">{busy && <Loader2 className="animate-spin w-5 h-5" />} Transferir</BotaoGrande>
              </div>
            )}
          </ArtigoCartao>
        )}
      </div>
    </Pagina>
  );
}

const TIPO = { entrada: "Entrada", saida: "Saída", ajuste: "Acerto", consumo: "Consumo", transferencia: "Transferência", inventario: "Inventário" };

/** Consultar stock de um artigo: total, reservado, por localização e últimos movimentos. */
export function MovelConsultar() {
  const [artigo, setArtigo] = useState(null);
  const [s] = useStockArtigo(artigo);
  return (
    <Pagina>
      <MovelHeader titulo="Consultar stock" />
      <div className="p-4 space-y-4">
        <ArtigoPicker onEscolher={setArtigo} autoFocus={!artigo} />
        {artigo && (
          <ArtigoCartao artigo={artigo}>
            {!s ? <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div> : (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[["Em stock", s.total], ["Reservado", s.reservado], ["Disponível", s.disponivel]].map(([l, v]) => (
                    <div key={l} className="bg-gray-50 rounded-lg p-2">
                      <div className="text-[11px] text-gray-500">{l}</div>
                      <div className={`text-lg font-bold ${v < 0 ? "text-red-600" : ""}`}>{num(v)}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Onde está</h3>
                  {s.localizacoes.length === 0 ? <p className="text-sm text-gray-500">Sem stock.</p> : (
                    <ul className="divide-y border rounded-lg">
                      {s.localizacoes.map((l) => (
                        <li key={l.localizacao_id} className="px-3 py-2 flex justify-between text-sm">
                          <span>{l.nome}{l.codigo ? <span className="text-xs text-gray-500"> · {l.codigo}</span> : null}</span>
                          <b className={l.quantidade < 0 ? "text-red-600" : ""}>{num(l.quantidade)} {s.unidade}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {s.movimentos?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Últimos movimentos</h3>
                    <ul className="divide-y border rounded-lg text-sm">
                      {s.movimentos.slice(0, 8).map((m) => (
                        <li key={m.id} className="px-3 py-2 flex justify-between gap-2">
                          <span className="min-w-0 truncate">{TIPO[m.tipo] || m.tipo} <span className="text-xs text-gray-500">· {fmtDate(m.data || m.created_at)}{m.origem?.numero ? ` · ${m.origem.numero}` : ""}</span></span>
                          <b className={`whitespace-nowrap ${m.quantidade < 0 ? "text-red-600" : "text-emerald-700"}`}>{m.quantidade > 0 ? "+" : ""}{num(m.quantidade)}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </ArtigoCartao>
        )}
      </div>
    </Pagina>
  );
}

/** Acertar o stock de um artigo numa localização (fica um movimento de acerto). */
export function MovelAcertar() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [locs] = useLocalizacoes();
  const [artigo, setArtigo] = useState(null);
  const [s, recarregar] = useStockArtigo(artigo);
  const [loc, setLoc] = useState("");
  const [qtd, setQtd] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const q = porLocal(s);
  useEffect(() => { if (s) { setLoc(s.localizacoes[0]?.localizacao_id || s.localizacao_padrao_id || ""); setQtd(""); setMotivo(""); } }, [s?.total, artigo]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = async () => {
    if (qtd === "" || Number(qtd) < 0) { toast.error("Indique a quantidade real"); return; }
    if (!motivo.trim()) { toast.error("Indique o motivo (ex.: partido, contagem)"); return; }
    const atual = q[loc] || 0;
    const nomeLoc = locs.find((l) => l.id === loc)?.nome || "";
    if (!(await confirm({ title: "Acertar stock?", description: `${artigo.nome} em ${nomeLoc}: ${num(atual)} → ${num(qtd)} ${s.unidade}`, confirmLabel: "Acertar" }))) return;
    setBusy(true);
    try {
      await api.post("/stock/ajuste", { artigo_id: artigo.id, localizacao_id: loc, nova_quantidade: Number(qtd), motivo: motivo.trim() });
      vibrar(40);
      toast.success("Stock acertado");
      recarregar();
    } catch (e) { erro(e, "Não foi possível acertar"); } finally { setBusy(false); }
  };

  if (!can("artigos", "edit")) return <Pagina><MovelHeader titulo="Acertar stock" /><p className="p-6 text-gray-600">Sem permissão para alterar stock.</p></Pagina>;
  return (
    <Pagina>
      <MovelHeader titulo="Acertar stock" />
      <div className="p-4 space-y-4">
        {!artigo ? <ArtigoPicker onEscolher={setArtigo} /> : (
          <ArtigoCartao artigo={artigo} onLimpar={() => setArtigo(null)}>
            {!s ? <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div> : (
              <div className="mt-3 space-y-4">
                <LocalPicker value={loc} onChange={setLoc} titulo="Localização" quantidades={q} />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Quantidade real (agora: {num(q[loc] || 0)} {s.unidade})</div>
                  <Quantidade value={qtd} onChange={setQtd} unidade={s.unidade} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Partido / estragado", "Erro de contagem", "Amostra / oferta", "Consumo interno"].map((m) => (
                    <button key={m} type="button" onClick={() => setMotivo(m)} className={`px-3 py-2 rounded-xl border text-sm ${motivo === m ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-white border-gray-300"}`}>{m}</button>
                  ))}
                </div>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className="w-full h-12 rounded-xl border-2 border-gray-300 focus:border-[#0A0A0A] outline-none px-3 bg-white" />
                <BotaoGrande variante="sucesso" onClick={gravar} disabled={busy} data-testid="movel-gravar-acerto">{busy && <Loader2 className="animate-spin w-5 h-5" />} Acertar</BotaoGrande>
              </div>
            )}
          </ArtigoCartao>
        )}
      </div>
    </Pagina>
  );
}
