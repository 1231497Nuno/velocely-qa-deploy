import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Camera, Check, MapPin, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { enviarOuGuardar } from "@/lib/filaOffline";
import { MovelHeader, Pagina, BotaoGrande, Scanner, num, erro, vibrar } from "./comum";

const fmt = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");

/** Picking: separar no armazém o material de cada OF (ler o código de barras de cada artigo e confirmar a quantidade). */
export default function MovelPicking() {
  const { id } = useParams();
  const nav = useNavigate();
  const [lista, setLista] = useState(null);
  const [qtd, setQtd] = useState({});
  const [lidos, setLidos] = useState({});
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const carregar = () => api.get("/movel/picking").then(setLista).catch((e) => { erro(e, "Não foi possível carregar"); setLista([]); });
  useEffect(() => { carregar(); }, []);
  const of = id ? (lista || []).find((o) => o.id === id) : null;
  useEffect(() => {
    if (!of) return;
    setQtd(Object.fromEntries(of.linhas.map((l) => [`${l.item_id}|${l.id}`, l.falta])));
    setLidos({});
  }, [of?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lido = (codigo) => {
    setScan(false);
    const c = String(codigo || "").trim().toLowerCase();
    const l = of?.linhas.find((x) => [x.codigo, x.codigo_produto].some((v) => v && v.toLowerCase() === c));
    if (!l) { toast.error(`O código ${codigo} não é material desta OF`); return; }
    vibrar(40);
    setLidos((x) => ({ ...x, [`${l.item_id}|${l.id}`]: true }));
    toast.success(`${l.nome} ✓`);
  };
  const confirmar = async () => {
    const separados = of.linhas.map((l) => ({ item_id: l.item_id, id: l.id, quantidade: Number(qtd[`${l.item_id}|${l.id}`]) || 0 })).filter((x) => x.quantidade > 0);
    if (!separados.length) { toast.error("Indique pelo menos uma quantidade"); return; }
    setBusy(true);
    try {
      const r = await enviarOuGuardar(`/movel/picking/${of.id}`, { separados }, `Picking OF ${of.numero}`);
      vibrar(60);
      toast.success(r?.offline ? "Sem rede: guardado no telemóvel, é enviado quando a rede voltar" : `Material da OF ${of.numero} separado`);
      nav("/m/picking", { replace: true });
      carregar();
    } catch (e) { erro(e, "Não foi possível registar"); } finally { setBusy(false); }
  };

  if (!lista) return <Pagina><MovelHeader titulo="Separar material" /><div className="p-6 text-center text-gray-500"><Loader2 className="animate-spin inline" /></div></Pagina>;

  if (!of) {
    return (
      <Pagina>
        <MovelHeader titulo="Separar material" />
        <div className="p-4 space-y-3" data-testid="movel-picking">
          {!lista.length && <p className="text-sm text-gray-500 text-center py-8">Não há material por separar nas OF abertas.</p>}
          {lista.map((o) => (
            <button key={o.id} type="button" onClick={() => nav(`/m/picking/${o.id}`)} className={`w-full text-left bg-white rounded-2xl border p-4 active:bg-gray-100 ${o.prioritaria ? "border-amber-400" : ""}`}>
              <div className="flex items-baseline justify-between"><span className="font-bold text-lg">{o.numero}</span><span className="text-sm text-gray-500">{fmt(o.prazo)}</span></div>
              <div className="text-sm text-gray-600 truncate">{o.cliente}</div>
              <div className="text-xs text-gray-500 mt-1">{o.por_separar} material(ais) por separar</div>
            </button>
          ))}
        </div>
      </Pagina>
    );
  }

  return (
    <Pagina>
      <MovelHeader titulo={`Separar · ${of.numero}`} voltar="/m/picking" />
      {scan && <Scanner onLido={lido} onFechar={() => setScan(false)} />}
      <div className="p-4 space-y-3">
        <BotaoGrande onClick={() => setScan(true)}><Camera className="w-5 h-5" /> Ler código do artigo</BotaoGrande>
        {of.linhas.map((l) => {
          const k = `${l.item_id}|${l.id}`;
          return (
            <div key={k} className={`bg-white rounded-2xl border p-4 ${lidos[k] ? "border-emerald-500" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{l.nome}</div>
                  <div className="text-xs text-gray-500">{l.codigo} · para {l.para}</div>
                </div>
                {lidos[k] && <Check className="w-6 h-6 text-emerald-600 shrink-0" />}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {l.locais.length ? l.locais.map((x) => (
                  <span key={x.id} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-800 rounded-full px-2 py-0.5"><MapPin className="w-3 h-3" />{x.nome}: {num(x.quantidade)}</span>
                )) : <span className="text-xs text-red-600">Sem stock em armazém</span>}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm text-gray-600 flex-1">Precisa {num(l.falta)} {l.unidade}{l.separada ? ` (já separado ${num(l.separada)})` : ""}</span>
                <input type="number" inputMode="decimal" min="0" step="any" className="w-24 border-2 border-gray-300 rounded-xl px-3 py-2 text-lg text-right" value={qtd[k] ?? ""} onChange={(e) => setQtd({ ...qtd, [k]: e.target.value })} />
              </div>
            </div>
          );
        })}
        <BotaoGrande onClick={confirmar} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check className="w-5 h-5" />} Confirmar separação</BotaoGrande>
      </div>
    </Pagina>
  );
}
