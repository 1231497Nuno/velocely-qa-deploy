"""Serviço de auditoria / histórico (timeline de alterações).

Regista criação, edições, mudanças de estado, pagamentos e outras ações em
todos os módulos, com utilizador e timestamp. Tolerante a falhas: o registo
nunca deve quebrar o fluxo principal.
"""
from typing import Optional

from app.core.database import new_id, now_iso
from app.repositories import historico_repo

TIPO_LABELS = {
    "orcamento": "Orçamento",
    "encomenda": "Encomenda",
    "ordem_fabrico": "Ordem de Fabrico",
    "cliente": "Cliente",
    "artigo": "Artigo",
    "consumivel": "Material",
    "maquina": "Máquina",
    "mao_obra": "Mão de obra",
    "tipo_personalizacao": "Tipo de personalização",
}

ACAO_LABELS = {
    "criado": "Criado",
    "editado": "Editado",
    "eliminado": "Eliminado",
    "duplicado": "Duplicado",
    "convertido": "Convertido",
    "estado_alterado": "Estado alterado",
    "pagamento": "Pagamento registado",
    "producao_autorizada": "Produção autorizada",
    "prioridade": "Prioridade alterada",
    "concluido": "Concluída",
    "operacao": "Operação atualizada",
    "nota": "Nota atualizada",
    "email_enviado": "Email enviado",
}

CAMPO_LABELS = {
    "status": "Estado",
    "estado": "Estado",
    "cliente": "Cliente",
    "cliente_id": "Cliente",
    "descricao": "Descrição",
    "notas": "Notas",
    "valor_pago": "Valor pago",
    "valor_total": "Valor total",
    "valor_total_manual": "Valor total manual",
    "autorizada_producao": "Autorização de produção",
    "prazo_entrega": "Prazo de entrega",
    "prioritaria": "Prioritária",
    "margem": "Margem",
    "validade": "Validade",
    "data": "Data",
    "numero_encomenda": "Referência cliente",
    "categoria_id": "Categoria",
    "subcategoria_id": "Subcategoria",
    "codigo": "Código",
    "desconto_total": "Desconto total",
    "nome": "Nome",
    "custo_artigo": "Valor de compra",
    "custo_hora": "Custo/hora",
    "custo_unitario": "Custo unitário",
    "custo_amortizacao_hora": "Amortização/hora",
    "custo_energia_hora": "Energia/hora",
    "unidade": "Unidade",
    "valor": "Valor",
    "tempo": "Tempo",
    "morada": "Morada",
    "email": "Email",
    "nif": "NIF",
    "contacto": "Contacto",
    "cidade": "Cidade",
    "responsavel_personalizacoes": "Responsável personalizações",
}


def _fmt(v):
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if v is None or v == "":
        return "—"
    return str(v)


def user_meta(user: Optional[dict]) -> dict:
    if not user:
        return {"utilizador_id": None, "utilizador_login": "sistema", "utilizador_nome": "Sistema"}
    return {
        "utilizador_id": user.get("id"),
        "utilizador_login": user.get("login") or (user.get("email") or "").split("@")[0] or "?",
        "utilizador_nome": user.get("name") or user.get("login") or "Utilizador",
    }


def diff_campos(antes: dict, depois: dict, campos: list) -> list:
    """Devolve lista de alterações [{campo, label, de, para}] para os campos indicados."""
    alteracoes = []
    for c in campos:
        old = (antes or {}).get(c)
        new = (depois or {}).get(c)
        # normaliza números
        if isinstance(old, float) and isinstance(new, (int, float)):
            if round(old, 4) == round(float(new), 4):
                continue
        if old == new:
            continue
        alteracoes.append({
            "campo": c,
            "label": CAMPO_LABELS.get(c, c),
            "de": _fmt(old),
            "para": _fmt(new),
        })
    return alteracoes


async def registar(
    entidade_tipo: str,
    entidade_id: str,
    acao: str,
    user: Optional[dict] = None,
    descricao: str = "",
    entidade_numero: Optional[str] = None,
    alteracoes: Optional[list] = None,
):
    try:
        doc = {
            "id": new_id(),
            "entidade_tipo": entidade_tipo,
            "entidade_id": entidade_id,
            "entidade_numero": entidade_numero,
            "acao": acao,
            "acao_label": ACAO_LABELS.get(acao, acao),
            "tipo_label": TIPO_LABELS.get(entidade_tipo, entidade_tipo),
            "descricao": descricao,
            "alteracoes": alteracoes or [],
            "timestamp": now_iso(),
            **user_meta(user),
        }
        await historico_repo.insert(doc)
    except Exception:
        pass


async def historico(entidade_tipo: Optional[str] = None, entidade_id: Optional[str] = None, limit: int = 300):
    query = {}
    if entidade_tipo:
        query["entidade_tipo"] = entidade_tipo
    if entidade_id:
        query["entidade_id"] = entidade_id
    eventos = await historico_repo.find(query, sort=("timestamp", -1), limit=limit)
    return eventos
