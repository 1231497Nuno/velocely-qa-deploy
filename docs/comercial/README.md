# Planos e subscrições — propostas comerciais

Documento de trabalho para definir **como vender o Velocely** (SaaS B2B de gestão de produção: orçamentos, encomendas, OF, catálogo e clientes).

Valores e limites abaixo são **propostas indicativas** — ajustar após validação com clientes-piloto e custos de infra.

---

## Posicionamento

| | |
|--|--|
| **Produto** | Velocely — gestão de orçamentos, encomendas e produção |
| **Cliente-alvo** | Oficinas / empresas de personalização, impressão, fabrico sob encomenda |
| **Modelo** | Subscrição mensal ou anual (desconto ~2 meses no anual) |
| **Unidade de faturação** | Por **organização** (tenant), com limite de utilizadores e volume |

---

## Resumo dos planos

| | **Essencial** | **Profissional** | **Empresa** | **Enterprise** |
|--|:---:|:---:|:---:|:---:|
| Preço mensal (proposta) | 49 € | 129 € | 299 € | Sob consulta |
| Preço anual (proposta) | 490 €/ano | 1 290 €/ano | 2 990 €/ano | Contrato |
| Utilizadores | 2 | 8 | 25 | Ilimitado* |
| Orçamentos / mês | 50 | 300 | Ilimitado | Ilimitado |
| Encomendas + OF | ✓ | ✓ | ✓ | ✓ |
| PDF + email ao cliente | ✓ | ✓ | ✓ | ✓ |
| Templates de email editáveis | — | ✓ | ✓ | ✓ |
| Excel import/export | — | ✓ | ✓ | ✓ |
| Branding (logo, PDF, login) | Básico | Completo | Completo | White-label |
| Analytics / rentabilidade | Básico | Completo | Completo | Completo + API |
| Histórico / auditoria | 90 dias | 1 ano | 3 anos | Personalizado |
| Suporte | Email (48h) | Email (24h) | Prioritário + call | CSM dedicado |
| Onboarding | Self-service | 1 sessão remota | Incluído | Projecto dedicado |

\*sujeito a fair use e capacidade acordada.

---

## Detalhe por plano

### 1. Essencial — entrada e validação

Para oficinas pequenas que querem deixar de orçamentar em Excel/WhatsApp.

**Inclui**
- Orçamentos com custeio e conversão em encomenda
- Encomendas e ordens de fabrico
- Catálogo (artigos, materiais, máquinas, mão de obra)
- Clientes
- 2 utilizadores (ex.: dono + colaborador)
- PDF de orçamento e envio por email
- Branding básico (logo da empresa)

**Limites**
- 50 orçamentos criados / mês
- 5 GB armazenamento (imagens / anexos)
- Sem Excel em massa; sem white-label

**Upsell natural** → Profissional quando passam de 2 pessoas ou precisam de Excel / mais volume.

---

### 2. Profissional — plano âncora (recomendado)

Para equipas que já operam diariamente com orçamentos e produção.

**Tudo do Essencial, mais**
- Até 8 utilizadores + perfis/RBAC
- Templates de email editáveis (orçamento, encomenda pronta, recuperação de password)
- Import/export Excel
- Branding completo (PDF, emails, ecrã de login)
- Analytics e rentabilidade por cliente
- Histórico 1 ano
- 1 sessão de onboarding remota

**Limites**
- 300 orçamentos / mês
- 25 GB armazenamento

**Porquê âncora:** cobre o fluxo completo do Velocely e é o sweet spot preço/valor para a maioria dos clientes-alvo.

---

### 3. Empresa — multi-equipa e escala

Para empresas com várias áreas (comercial + produção + gestão) e volume elevado.

**Tudo do Profissional, mais**
- Até 25 utilizadores
- Orçamentos ilimitados
- Auditoria alargada (3 anos)
- Suporte prioritário + call mensal opcional
- Onboarding incluído
- 100 GB armazenamento
- Opção de ambiente staging (proposta)

---

### 4. Enterprise — contrato à medida

Para grupos, multi-loja / multi-unidade, ou requisitos de compliance.

**Inclui (negociável)**
- Utilizadores e storage sob acordo
- White-label / domínio próprio
- SSO (quando existir), SLA, backups dedicados
- Integrações (ERP, faturação, e-commerce) via API / projecto
- CSM e formação presencial/remota
- Facturação anual / plurianual

---

## Add-ons (extras mensais)

| Add-on | Preço proposto | Notas |
|--------|----------------|-------|
| Utilizador extra | 12 € / utilizador | Nos planos Essencial e Profissional |
| Pack emails (+5 000/mês) | 19 € | Para quem envia muitos PDFs |
| Storage +50 GB | 15 € | Imagens de artigos / anexos |
| Onboarding alargado | 350 € one-shot | Workshop + migração de catálogo |
| Migração de dados | Sob orçamento | Excel/legado → Velocely |

---

## Trial e go-to-market

| Momento | Proposta |
|---------|----------|
| **Trial** | 14 dias no plano Profissional, sem cartão (ou cartão com cancelamento fácil) |
| **Seed demo** | Conta com dados de demonstração (catálogo + orçamentos) |
| **Garantia** | 30 dias money-back no 1.º pagamento anual |
| **Desconto anual** | ~2 meses grátis (pagamento anual = 10× mensal) |
| **Parceiros / agências** | 20% comissão recorrente nos primeiros 12 meses |

---

## Matriz de valor (o que comunicar na venda)

1. **Menos tempo a orçamentar** — custeio e margens no sistema, não em folhas soltas  
2. **Da proposta à fábrica** — orçamento → encomenda → OF sem reescrever  
3. **Imagem profissional** — PDF e emails com marca do cliente  
4. **Controlo** — utilizadores, perfis, histórico e alertas  
5. **Visibilidade** — o que está em curso, o que atrasa, o que rende  

---

## Métricas internas para rever preços (após 3–6 meses)

- CAC vs LTV (meta LTV ≥ 3× CAC)
- % de trials → pagos e plano médio escolhido
- Churn mensal (meta &lt; 3% em PME)
- Pedidos de upgrade Essencial → Profissional
- Custo médio de infra + suporte por tenant

---

## Próximos passos sugeridos

1. Validar limites (utilizadores / orçamentos) com 2–3 clientes-piloto  
2. Decidir se o Essencial entra no lançamento ou se se começa só com Profissional + Empresa  
3. Ligar planos a feature flags / quotas no produto (quando existir billing)  
4. Página pública de preços espelhando esta tabela (sem números internos de custo)

---

## Relacionado

- [Visão do produto](../../README.md)  
- [Arranque local](../guides/getting-started.md)  
- [Deploy](../guides/deployment.md)  
