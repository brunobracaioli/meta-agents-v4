# SPEC-019 — ARC: interface holográfica dinâmica do Ultron ("Tony Stark Mode")

| Campo | Valor |
|---|---|
| Status | Em produção — Waves 0/A/B/C entregues e mergeadas na `main` (PRs #11/#13/#14/#15/#16, + fixes #12/#17); Wave E em andamento (painéis arrastáveis/redimensionáveis entregues + validados ao vivo, PR #19); D pendente |
| Data | 2026-06-26 |
| Autor | brunobracaioli |
| ADRs | [0031](../adr/0031-arc-holographic-render-bus.md) |
| Threat model | [docs/security/threats/arc.md](../security/threats/arc.md) |
| Depende de | [SPEC-016](SPEC-016-ultron-voice-chat.md) (voz/chat), [SPEC-013](SPEC-013-ultron-autonomous-mode.md) (narração autônoma), [SPEC-017](SPEC-017-multi-operator-multitenant.md) (multi-tenant) |
| Plano estrutural | `~/.claude/plans/poss-vel-criar-interface-floating-gizmo.md` (aprovado) |

> Este SPEC **detalha as waves de implementação**. O esqueleto estrutural (arquitetura do Render Bus,
> contratos, modelo de dados, STRIDE) está no plano aprovado; aqui cada wave ganha objetivo, contratos
> concretos, arquivos, edge cases, critérios de aceite e testes.

## 1. Objetivo

Entregar um **frontend paralelo opt-in** em `/dashboard/arc` onde a **fala do Ultron é a interface**:
o operador comanda por voz, o Ultron responde **e materializa painéis holográficos 2.5D** (funil, resumo
diário, pastas/clientes, análises, criativo, landing) que entram e saem sob comando. Reuso total do
pipeline de voz/narração/visão; dashboard clássico (`/dashboard/*`) **inalterado** como rollback. Gestos
por webcam entram numa wave posterior. Decisões fechadas com o operador: painéis 2.5D (framer-motion),
overlay sobre o Ultron + popout opcional, rota nova `/dashboard/arc`, voz antes de gestos.

## 2. Modelo conceitual

```
fala/narração ─> Ultron (chat loop / narração) ─emite─> UIIntent[] ─> Render Bus (cliente)
                                                                          │
                          ┌───────────────────────────────────────────────┤
                          ▼                                                 ▼
                 HoloPanel materializa (framer-motion)            BroadcastChannel("ARC_RENDER")
                 funil / resumo / pastas / análises / ...                   │
                          ▲                                                 ▼
                          └────────── foco / dismiss ◀── voz/gesto    Popout (2ª janela)
```

- **UIIntent** — diretiva declarativa (`show`/`dismiss`/`focus`/`popout`) com payload já resolvido
  server-side. Contrato único validado por Zod.
- **Render Bus** — Provider React (Context + reducer) que mantém a pilha de painéis ativos + foco; teto
  de 6 painéis; TTL opcional. Mutação por evento (não thrasha o lip-sync imperativo).
- **Render-tools** — nova categoria de tools do Ultron (irmã de `CLIENT_TOOLS`), **read-only**, que montam
  `UIIntent` reusando os data services existentes.

## 3. Contratos

### 3.1 `web/lib/ultron/render-intents.ts` (novo — fonte de verdade do contrato)

```ts
export const ANCHORS = ["center", "left", "right", "stack"] as const;
export type Anchor = (typeof ANCHORS)[number];

// Zod discriminated union. Os payloads reusam os tipos dos services (não redefinir).
export const UIIntentSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("show"), element: z.enum([
    "funnel","daily_summary","clients","client","analyses","creative","landing",
  ]), id: z.string().min(1), anchor: z.enum(ANCHORS).optional(), data: z.unknown() }),
  z.object({ op: z.literal("dismiss"), target: z.string().min(1) }),  // id ou "all"
  z.object({ op: z.literal("focus"),   target: z.string().min(1) }),
  z.object({ op: z.literal("popout"),  target: z.string().min(1) }),
]);
export type UIIntent = z.infer<typeof UIIntentSchema>;
export const MAX_ACTIVE_PANELS = 6;
```

> `data` é validado por painel no momento da montagem (cada panel tem seu próprio sub-schema reusando
> `FunnelData` de `web/lib/services/funnel.ts`, `AnalysisRound` de `analyses.ts` etc.). Mantém o contrato
> de transporte enxuto e empurra a validação rica pra borda que conhece o tipo.

### 3.2 Render-tools — `web/lib/ultron/tools.ts`

Tabela de tools (todas read-only; handler resolve dados e devolve `{ ui_intent: UIIntent }`):

| Tool | Input | Service reusado | Intent |
|---|---|---|---|
| `show_funnel` | `client_slug` | `getLatestFunnel` | `show/funnel` |
| `show_daily_summary` | `client_slug`, `date?` | `getDailySummary` | `show/daily_summary` |
| `show_clients` | — | `list_clients` | `show/clients` |
| `open_client` | `client_slug` | `clients`+`products`+`client_skills` | `show/client` |
| `show_analyses` | `client_slug?` | `getAnalysisRounds` | `show/analyses` |
| `show_creative` | `creative_id?`/`campaign_meta_id?` | manifest/asset URL | `show/creative` |
| `show_landing` | `landing_page_id?`/`nome?` | `landing_pages` | `show/landing` |
| `dismiss_element` | `target` | — | `dismiss` |
| `focus_element` | `target` | — | `focus` |
| `popout_element` | `target` | — | `popout` |

- Nova constante `RENDER_TOOLS: Set<string>` (irmã de `CLIENT_TOOLS`). O handler **server-side** resolve
  dados (guard `operatorOwnsClient` obrigatório antes de devolver dados de cliente) e retorna o intent.
- Função `uiIntentFromToolResult(toolName, result)` espelhando `agentTriggerFromToolResult` existente.

### 3.3 Chat loop — `web/lib/ultron/chat.ts`

- `runLoop` acumula `uiIntents: UIIntent[]` (idêntico ao padrão `agentTriggers`).
- Retorno `reply` ganha `uiIntents`. `POST /api/ultron/chat` repassa no JSON (não-bloqueante).
- `ULTRON_SYSTEM_PROMPT` ganha a gramática de voz (§8 do plano) + regra "após resumir, **oferecer**
  remover o elemento".

### 3.4 Narração autônoma — `ultron_narrations.render`

- Migration aditiva: `ALTER TABLE ultron_narrations ADD COLUMN render jsonb`.
- `GET /api/ultron/narrations` passa a retornar `render`; o cliente, ao falar a narração, empurra o intent
  no Render Bus se `render != null`. `null` = comportamento atual (compat retro).

## 4. Waves

### Wave 0 — Fundação (palco + contrato) ✅ entregue
**Objetivo:** rota e palco renderizando, contrato e bus vazios prontos.
**Entrega:**
- `web/app/(app)/dashboard/arc/page.tsx` + `layout.tsx` (fullscreen, sem chrome do dashboard, dentro do
  grupo `(app)` que já provê `UltronProvider`).
- `npm i framer-motion` em `web/`.
- `web/lib/ultron/render-intents.ts` (contrato Zod).
- `web/components/arc/render-bus.tsx` (Provider + reducer + `use-render-bus.ts`), `holo-panel.tsx` (painel
  base framer-motion: enter `scale .85→1 + blur 8px→0 + opacity`, exit inverso; moldura ciano reusando
  classes de `app/globals.css`).
- `web/components/arc/arc-stage.tsx`: avatar Ultron 3D (reusa `ultron-stage.tsx`/`neural-core-scene.tsx`)
  ao centro + slot do Render Bus por cima.
**Edge cases:** SSR — `arc-stage` é client component; webcam/getDisplayMedia não tocados aqui.
**Aceite:** abrir `/dashboard/arc` mostra o avatar Ultron falando (voz já funciona via provider), bus vazio,
zero regressão no dashboard clássico. `npm run build` verde.
**Testes:** unit do reducer do Render Bus (push/dismiss/focus/teto de 6/dismiss "all").

### Wave A — Voz → Render → Dismiss (MVP demonstrável) ✅ entregue + validado e2e
**Objetivo:** o ciclo central funcionando com 2 painéis reais.
**Entrega:**
- `tools.ts`: `show_funnel`, `show_daily_summary`, `dismiss_element` (+ `RENDER_TOOLS`,
  `uiIntentFromToolResult`).
- `chat.ts` + `route.ts`: propagar `uiIntents`. `ULTRON_SYSTEM_PROMPT`: gramática mínima + oferta de remover.
- `use-ultron-voice.ts`: ao receber resposta do chat, entregar `uiIntents` ao Render Bus.
- Painéis `funnel-panel.tsx` (base visual `funnel-view.tsx`) e `daily-summary-panel.tsx`.
**Edge cases:** cliente sem funil recente (`getLatestFunnel` null) → intent com estado "sem dados" + fala
explicando; múltiplos `show` na mesma resposta respeitam o teto (descarta o mais antigo + avisa).
**Aceite:** "como estão as campanhas do brunobracaioli?" → painel de funil materializa com dados reais, Ultron
resume por voz, "pode tirar" → some. "o que os agentes fizeram ontem?" → painel de resumo. Network mostra
`uiIntents` no retorno de `/api/ultron/chat`.
**Testes:** unit de `uiIntentFromToolResult`; integração da render-tool (guard de posse nega cliente alheio);
validação Zod rejeita intent malformado na borda cliente.

### Wave B — Shell de pastas + clientes (imagens 1–3) ✅ entregue + validado e2e
**Objetivo:** navegação espacial das pastas por voz.
**Entrega:**
- `tools.ts`: `show_clients`, `open_client`.
- `panels/clients-folder.tsx` com 3 camadas: (1) 5 pastas Clientes/Funil/Pages/configs/Ultron; (2) lista
  rolante de clientes; (3) card (avatar/Nome/Site/Produtos/Skills) reusando `products` + `client_skills`.
- Estado de navegação interno ao painel (camada atual + seleção), comandado por voz
  ("abrir clientes" → "abrir brunobracaioli" → "voltar").
**Edge cases:** operador sem clientes → estado vazio; pasta "Funil/Pages/configs/Ultron" mapeadas para os
respectivos `show_*` (atalho) ou estado "em breve" nas que não têm painel ainda.
**Aceite:** "abrir clientes" → pastas; "abrir brunobracaioli" → lista → card com produtos e skills reais.
**Testes:** integração `open_client` (RLS/posse); unit do state machine de camadas do painel.

### Wave C — Catálogo completo + popout + narração com render ✅ entregue (C.1 painéis + C.2a narração/migration + C.2b popout-espelho); landing preview corrigido p/ same-origin /lp-preview (PR #17). Decisão: popout = ESPELHO (não migra).
**Objetivo:** completar os painéis e a 2ª superfície.
**Entrega:**
- `tools.ts`: `show_analyses`, `show_creative`, `show_landing`, `focus_element`, `popout_element`.
- Painéis `analyses-panel.tsx` (base `analyses-table.tsx`), `creative-panel.tsx` (asset URL),
  `landing-preview-panel.tsx` (iframe `*.b2tech.io`).
- `popout/` — 2ª janela (`window.open` + `BroadcastChannel("ARC_RENDER")`); intent `popout` migra o painel.
- Migration `ultron_narrations.render` + leitura no poll + push no bus quando o Ultron narra.
**Edge cases:** popout bloqueado pelo browser → fallback (mantém overlay + avisa); iframe de domínio fora de
`*.b2tech.io` é rejeitado; narração `render` inválido é ignorado (não quebra a fala).
**Aceite:** "última análise do Bruno" → painel; "mostra a landing" → preview; "joga o funil pra segunda tela"
→ migra pro popout; um watch que escreve `render` materializa painel ao narrar.
**Testes:** integração da migration (coluna nullable, RLS herdada); validação de origem do iframe; sync
overlay↔popout via canal mockado.

### Wave D — Gestos por webcam ⏳ pendente (próxima)
**Objetivo:** comando por mãos no painel em foco.
**Entrega:**
- `components/arc/use-hand-tracking.ts` (template `use-face-tracking.ts`; `@mediapipe/tasks-vision` já
  instalado), `public/mediapipe/hand_landmarker.task`.
- Mapeamento gesto → bus: punho→palma = abrir/zoom (foco), swipe lateral = `dismiss` do foco, apontar =
  mover seleção na lista rolante, palma parada = hold.
- Debounce + histerese contra falso positivo; opt-in explícito (getUserMedia por gesto do usuário).
**Edge cases:** sem webcam/permissão negada → feature desligada silenciosamente (voz continua); 2 mãos →
prioriza a dominante.
**Aceite:** com webcam, punho→palma abre, swipe dispensa, apontar move foco — só no painel em foco.
**Testes:** unit do classificador de gesto (landmarks fixtures → ação esperada); histerese determinística.

### Wave E — Polish "surreal" 🔧 em andamento
**Objetivo:** acabamento Tony Stark.
**Entregue:**
- Largura única no HoloPanel (default/wide) + `prefers-reduced-motion` + indicador de foco (PR #18, `refactor/arc-panel-polish`).
- **Painéis flutuantes arrastáveis + redimensionáveis** (PR #19, `feat/arc-draggable-resizable-panels`) — **validado ao vivo 2026-06-26**: cada `HoloPanel` arrasta pelo header (framer `drag`+`dragControls`, só o header inicia), redimensiona pelo handle inferior-direito (w+h, min/máx, scroll interno), clique traz à frente (reusa `op:"focus"`), nasce em cascade preso à tela (`dragConstraints`), duplo-clique reseta. Geometria em motion values locais (fora do Render Bus, não thrasha o lip-sync — ADR 0031); math pura testável em `lib/ultron/arc-geometry.ts` (+9 testes). Não-objetivos: sem sync de geometria pro popout, sem persistência entre sessões.
**Pendente:** transições refinadas, scanlines/glow/parallax sutil, SFX de materialização, boot sequence do
ARC, tuning de UX. Sem novo contrato.
**Aceite:** revisão visual do operador (live review). `npm run build` verde.

## 5. Verificação E2E

Igual à §14 do plano aprovado: build/typecheck, MVP por voz (Wave A), resumo diário, pastas (B), popout +
narração com render (C), gestos (D), regressão do dashboard clássico, e segurança (posse + Zod).

## 6. Fora de escopo (v1)

- react-three-fiber / painéis no mundo 3D (decisão: 2.5D framer-motion).
- Escrita/mutação via render-tools (continuam só nas tools `request_*` existentes).
- Persistência de layout de painéis entre sessões.
