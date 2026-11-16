import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Modo de edição das fichas: a ficha abre em modo de leitura e só fica
 * editável depois de carregar em "Editar".
 *
 * - `permitido`: o utilizador tem permissão de edição no módulo.
 * - `bloqueio`: texto com o motivo quando o documento está num estado final
 *   (ex.: "OF finalizada"). Com bloqueio, a ficha nunca fica editável.
 * - Se a navegação trouxer `state.edit` (documento acabado de criar), abre já em edição.
 * - `abrirEmEdicao`: abre em edição quando passa a verdadeiro (ex.: orçamento em rascunho).
 *
 * `ativo` é o que os campos devem usar para decidir se ficam editáveis.
 */
export function useModoEdicao({ permitido = true, bloqueio = "", abrirEmEdicao = false } = {}) {
  const location = useLocation();
  const [editando, setEditando] = useState(!!location.state?.edit);
  const autoAberto = useRef(false);

  // Mudar de documento (ex.: duplicar) repõe o modo: leitura, ou edição se vier de uma criação.
  useEffect(() => {
    setEditando(!!location.state?.edit);
    autoAberto.current = false;
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rascunhos podem abrir logo em edição (uma vez por documento).
  useEffect(() => {
    if (abrirEmEdicao && !autoAberto.current) {
      autoAberto.current = true;
      setEditando(true);
    }
  }, [abrirEmEdicao]);

  useEffect(() => {
    if (bloqueio) setEditando(false);
  }, [bloqueio]);

  const iniciar = useCallback(() => setEditando(true), []);
  const terminar = useCallback(() => setEditando(false), []);

  return {
    editando,
    ativo: editando && !!permitido && !bloqueio,
    permitido: !!permitido,
    bloqueio: bloqueio || "",
    iniciar,
    terminar,
  };
}

export default useModoEdicao;
