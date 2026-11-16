import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Server } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const AJUDA = {
  smtp: (
    <ol className="list-decimal ml-4 space-y-1">
      <li>No Render, abra o serviço do <b>backend</b> → <b>Environment</b>.</li>
      <li>Adicione: <code>SMTP_HOST</code> (ex.: o servidor de email do vosso alojamento cPanel, como <code>mail.famarte.pt</code>), <code>SMTP_PORT</code> = 587, <code>SMTP_USER</code> = a conta (ex.: geral@…), <code>SMTP_PASSWORD</code> = a password dessa conta, <code>SMTP_FROM</code> = o mesmo email, <code>SMTP_TLS</code> = true.</li>
      <li>Guarde (o Render reinicia sozinho) e volte aqui: deve aparecer verde. Teste enviando um orçamento para si próprio.</li>
    </ol>
  ),
  frontend_url: (
    <ol className="list-decimal ml-4 space-y-1">
      <li>Copie o endereço com que abre o Velocely no browser (só até ao domínio, ex.: <code>https://velocely-qa.onrender.com</code>).</li>
      <li>No Render, serviço do <b>backend</b> → <b>Environment</b> → <code>FRONTEND_URL</code> = esse endereço (sem barra no fim).</li>
    </ol>
  ),
  jwt: <p>No Render, backend → Environment → <code>JWT_SECRET</code> = um texto aleatório com 40+ caracteres (pode gerar num gestor de passwords). Ao mudar, todos voltam a iniciar sessão.</p>,
  storage: <p>No Render, backend → Environment → <code>STORAGE_BACKEND</code> = <code>gridfs</code>. Os ficheiros passam a ficar na base de dados e não se perdem nos deploys.</p>,
  push: <p>Fica disponível depois do próximo deploy (instala as dependências novas). Depois, cada pessoa ativa em «A minha conta» → «Alertas neste aparelho».</p>,
};

/** O que falta configurar no servidor (Render), com instruções passo a passo. */
export default function EstadoServidorCard() {
  const { isAdmin } = useAuth();
  const [d, setD] = useState(null);
  const [aberto, setAberto] = useState("");
  useEffect(() => { if (isAdmin) api.get("/admin/estado-configuracao").then(setD).catch(() => {}); }, [isAdmin]);
  if (!d) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-sm mb-5" data-testid="estado-servidor">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Server size={16} />
        <span className="font-semibold text-sm flex-1">Configuração do servidor</span>
        <span className={`text-xs font-medium ${d.pendentes ? "text-amber-700" : "text-emerald-700"}`}>{d.pendentes ? `${d.pendentes} por configurar` : "Tudo configurado"}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {d.itens.map((i) => (
          <li key={i.chave} className="px-4 py-2.5 text-sm">
            <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setAberto(aberto === i.chave ? "" : i.chave)}>
              {i.ok ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0" /> : <AlertTriangle size={16} className="text-amber-600 shrink-0" />}
              <span className="flex-1"><span className="font-medium">{i.titulo}</span>{i.detalhe ? <span className="text-gray-500"> · {i.detalhe}</span> : null}</span>
              {aberto === i.chave ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {aberto === i.chave && (
              <div className="mt-2 ml-6 text-xs text-gray-600 space-y-2">
                <p>{i.porque}</p>
                {!i.ok && AJUDA[i.chave]}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
