# Design system — Velocely

Referência visual e de UI para a equipa. Derivado das guidelines internas do produto.

## Filosofia

Interface objectiva, densa e funcional. Cor usada sobretudo para significado semântico (estados). A maior parte da UI é monocromática para reduzir carga cognitiva.

## Tipografia

| Uso | Fonte |
|-----|--------|
| Títulos | Chivo |
| Corpo | IBM Plex Sans |
| Mono / números técnicos | IBM Plex Mono |

- Títulos: `tracking-tight` acima de 24px
- Preços, IDs (ORC/OF), quantidades e datas: classe `tabular-nums`

### Hierarquia sugerida

- **h1:** `text-2xl sm:text-3xl font-bold tracking-tight text-gray-900`
- **h2:** `text-xl font-semibold tracking-tight text-gray-900`
- **Cabeçalhos de tabela:** `text-xs font-semibold uppercase tracking-[0.1em] text-gray-500`
- **Corpo:** `text-sm text-gray-700`
- **Secundário:** `text-xs text-gray-500`

## Cores

| Token | Valor |
|-------|--------|
| Fundo | `#F8F9FA` |
| Superfície | `#FFFFFF` |
| Texto | `#111827` |
| Borda | `#E5E7EB` |
| Acção primária | `#0A0A0A` |

### Estados (badges)

| Estado | Fundo | Texto |
|--------|-------|-------|
| Rascunho | `#F3F4F6` | `#374151` |
| Pendente | `#FEF3C7` | `#92400E` |
| Em produção | `#DBEAFE` | `#1E40AF` |
| Concluído / Aceite | `#D1FAE5` | `#065F46` |
| Enviado | `#E0E7FF` | `#3730A3` |
| Rejeitado | `#FEE2E2` | `#991B1B` |

## Layout

- Grelha densa (`gap-4` / `gap-6`)
- Bordas de 1px; cantos `rounded-sm`
- Evitar sombras suaves em excesso

## Componentes

- Tabelas com cabeçalhos sticky; valores numéricos alinhados à direita
- Inputs com foco preto (`ring-black/20`, `border-black`)
- Botão primário: fundo preto, texto branco
- Ícones: Lucide (já em uso no projeto)

## Testes de UI

Elementos interactivos devem incluir `data-testid` estáveis (kebab-case).
