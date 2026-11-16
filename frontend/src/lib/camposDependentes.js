/**
 * Campos dependentes (Definições → Campos): um campo só aparece consoante a resposta a outro,
 * e as opções de uma lista podem depender da opção escolhida noutra lista.
 * Mesma lógica que o backend (services/campos.py: campos_visiveis / opcao_disponivel).
 */

function vazio(v) {
  return v === null || v === undefined || (typeof v === "string" && !v.trim()) || v === false;
}

function condicao(dep, pai, valor) {
  const valores = dep.valores || [];
  if (pai.tipo === "sim_nao") return !!valor === ((valores[0] || "sim") === "sim");
  if (vazio(valor)) return false;
  if (pai.tipo === "lista" && valores.length) return valores.includes(String(valor));
  return true;
}

/** { key: visível? } para todos os campos (os inativos contam como escondidos). */
export function camposVisiveis(campos, valores) {
  const porKey = Object.fromEntries((campos || []).map((c) => [c.key, c]));
  const memo = {};
  const vis = (c, pilha) => {
    if (c.key in memo) return memo[c.key];
    if (c.ativo === false) return (memo[c.key] = false);
    const dep = c.depende_de;
    if (!dep?.campo) return (memo[c.key] = true);
    const pai = porKey[dep.campo];
    if (!pai || pilha.has(pai.key)) return (memo[c.key] = false);
    return (memo[c.key] = vis(pai, new Set([...pilha, c.key])) && condicao(dep, pai, (valores || {})[pai.key]));
  };
  const out = {};
  (campos || []).forEach((c) => { out[c.key] = vis(c, new Set()); });
  return out;
}

/** Opções de uma lista disponíveis para o valor atual do campo "pai". */
export function opcoesDisponiveis(campo, valores) {
  const pai = campo.depende_de?.campo;
  const atual = pai ? String((valores || {})[pai] ?? "") : "";
  return (campo.opcoes || []).filter((o) => !pai || !(o.pais || []).length || o.pais.includes(atual));
}

/** Limpa os valores de campos que ficaram escondidos ou com opção já não disponível (em cascata). */
export function limparDependentes(campos, valores) {
  let v = { ...(valores || {}) };
  for (let volta = 0; volta < 5; volta += 1) {
    const vis = camposVisiveis(campos, v);
    let mudou = false;
    for (const c of campos || []) {
      if (c.ativo === false || !c.depende_de?.campo) continue;
      const atual = v[c.key];
      if (!vis[c.key]) {
        const limpo = c.tipo === "sim_nao" ? false : null;
        if (!vazio(atual) && atual !== limpo) { v = { ...v, [c.key]: limpo }; mudou = true; }
      } else if (c.tipo === "lista" && !vazio(atual) && !opcoesDisponiveis(c, v).some((o) => o.valor === atual)) {
        v = { ...v, [c.key]: null };
        mudou = true;
      }
    }
    if (!mudou) break;
  }
  return v;
}

/** Igual ao _slug do backend: chave estável a partir do nome do campo. */
export function slugCampo(texto) {
  const s = String(texto || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return s.slice(0, 40) || "campo";
}
