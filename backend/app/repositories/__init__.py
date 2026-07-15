"""Camada de repositórios — isola totalmente o acesso a dados (MongoDB).

Toda a persistência passa por aqui. Para migrar para outra base de dados
(relacional, etc.) basta reescrever esta camada, sem tocar em serviços/rotas.
"""
from typing import Optional

from app.core.database import db


class Repository:
    def __init__(self, name: str):
        self.col = db[name]

    def _proj(self, projection: Optional[dict]) -> dict:
        p = {"_id": 0}
        if projection:
            p.update(projection)
        return p

    async def find(self, query: Optional[dict] = None, sort=None, limit: int = 1000, projection: Optional[dict] = None):
        cur = self.col.find(query or {}, self._proj(projection))
        if sort:
            cur = cur.sort(sort[0], sort[1])
        return await cur.to_list(limit)

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        return await self.col.find_one(query, self._proj(projection))

    async def get(self, _id: str, projection: Optional[dict] = None):
        return await self.col.find_one({"id": _id}, self._proj(projection))

    async def insert(self, doc: dict):
        await self.col.insert_one(doc)
        doc.pop("_id", None)
        return doc

    async def insert_many(self, docs: list):
        await self.col.insert_many(docs)

    async def update(self, _id: str, patch: dict, upsert: bool = False):
        await self.col.update_one({"id": _id}, {"$set": patch}, upsert=upsert)

    async def update_where(self, query: dict, patch: dict, upsert: bool = False):
        await self.col.update_one(query, {"$set": patch}, upsert=upsert)

    async def update_many(self, query: dict, patch: dict):
        await self.col.update_many(query, {"$set": patch})

    async def delete(self, query: dict):
        await self.col.delete_one(query)

    async def count(self, query: Optional[dict] = None) -> int:
        return await self.col.count_documents(query or {})

    async def create_index(self, field: str, unique: bool = False):
        await self.col.create_index(field, unique=unique)

    def cursor(self, query: Optional[dict] = None):
        return self.col.find(query or {})


maquinas_repo = Repository("maquinas")
consumiveis_repo = Repository("consumiveis")
mao_obra_repo = Repository("mao_obra")
artigos_repo = Repository("artigos")
tipos_repo = Repository("tipos_personalizacao")
orcamentos_repo = Repository("orcamentos")
ordens_repo = Repository("ordens_fabrico")
clientes_repo = Repository("clientes")
encomendas_repo = Repository("encomendas")
empresa_repo = Repository("empresa_settings")
pdf_templates_repo = Repository("pdf_templates")
users_repo = Repository("users")
perfis_repo = Repository("perfis")
historico_repo = Repository("historico")
