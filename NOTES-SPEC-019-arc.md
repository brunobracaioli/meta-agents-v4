# NOTES — SPEC-019 / ARC: interface holográfica do Ultron ("Tony Stark Mode")

> Status: **Waves 0/A/B/C entregues e MERGEADAS na `main`** (PRs #11/#13/#14/#15/#16 + fixes #12/#17);
> **Wave E em andamento** — painéis arrastáveis/redimensionáveis entregues + **validados ao vivo 2026-06-26** (PR #19 aberto, `feat/arc-draggable-resizable-panels`), além do polish do PR #18. **Próxima = Wave D (gestos webcam)**. Deploys automáticos na Vercel.
> Última atualização: 2026-06-26 · Documento de trabalho (status + achados + receita executável).
> **LER ISTO PRIMEIRO** ao retomar a feature. NÃO confundir com `NOTES.md` (raiz) que é da feature multi-tenant.

## 0. Onde está o spec-driven development (fonte formal)

| Doc | Caminho |
|---|---|
| Plano estrutural (aprovado) | `~/.claude/plans/poss-vel-criar-interface-floating-gizmo.md` |
| SDD de waves (detalhado) | `docs/specs/SPEC-019-arc-holographic-ui.md` |
| ADR | `docs/adr/0031-arc-holographic-render-bus.md` |
| Threat model (STRIDE) | `docs/security/threats/arc.md` |
| Memória de projeto | `…/memory/spec019-arc-holographic-ui.md` |

## 1. Objetivo

Frontend **paralelo e opt-in** em `/dashboard/arc` onde **a fala do Ultron é a interface**: comando por voz
→ o Ultron responde **e materializa painéis holográficos 2.5D** (funil, resumo diário, pastas/clientes,
análises, criativo, landing) que entram e somem sob comando. Reuso TOTAL do pipeline de voz/narração/visão
existente. Dashboard clássico (`/dashboard/*`) **intacto** como rollback. Gestos por webcam = wave posterior.

## 2. Decisões travadas (com o usuário — via AskUserQuestion)

1. **Render espacial:** painéis **2.5D com framer-motion** + CSS `perspective`/`backdrop-blur`/glow ciano.
   **NÃO** react-three-fiber nesta fase.
2. **Superfície:** **overlay sobre o avatar** (padrão) **+ popout opcional** (2ª janela via BroadcastChannel).
3. **Acesso:** nova rota fullscreen **`/dashboard/arc`**; clássico inalterado.
4. **Gestos (webcam):** **adiados** — voz+render primeiro.

## 3. Arquitetura — Render Bus de UIIntents (CRÍTICO)

O Ultron emite **`UIIntent`** (`show`/`dismiss`/`focus`/`popout`) pelo **MESMO mecanismo** que ele já usa
para `agentTriggers`/`landingEdits`/`liveReviews`: a tool roda no servidor, resolve dados, e o resultado
carrega o intent, que é coletado e devolvido no reply. O cliente publica via CustomEvent + BroadcastChannel;
a aba ARC escuta e despacha no Render Bus (reducer puro). Mutação por evento → **não** thrasha o lip-sync
imperativo (`liveSignalRef`).

```
voz → /api/ultron/chat → runChat/runLoop → render-tool (server, read-only) resolve dados
   → result {ui_intent} → coletado em uiIntents[] → reply.uiIntents
   → use-ultron-voice publica (CustomEvent ARC_RENDER + BroadcastChannel)
   → <ArcBridge> (na aba /dashboard/arc) escuta → dispatchMany() no Render Bus → HoloPanel materializa
```

### ⚠️ Gotcha de integração nº1 (a coisa mais importante p/ a Wave A)
`UltronProvider` (a voz) é montado em `app/(app)/dashboard/layout.tsx` — **ACIMA** da página `/arc`.
O `RenderBusProvider` vive **DENTRO** de `components/arc/arc-stage.tsx` — **ABAIXO**. Logo o hook de voz
**NÃO consegue** chamar `useRenderBus()` diretamente (provider fora de escopo). A ponte é o
**CustomEvent + BroadcastChannel `ARC_RENDER`** (idêntico ao padrão `AGENT_TRIGGER`). Bônus: isso já entrega
o sync overlay↔popout da Wave C de graça.

## 4. Estado da implementação

### ✅ Wave 0 — Fundação — DONE + verde (test/typecheck/build)
Arquivos **criados**:
- `web/lib/ultron/render-intents.ts` — contrato Zod (`UIIntentSchema`, `parseUIIntents`, `MAX_ACTIVE_PANELS=6`, `RENDER_ELEMENTS`, `Anchor`).
- `web/lib/ultron/render-bus-reducer.ts` — reducer puro (`renderBusReducer`, `initialRenderBusState`, tipos `Panel`/`RenderBusState`).
- `web/lib/ultron/render-bus-reducer.test.ts` — 11 testes (push/replace+topo/teto/dismiss/focus/popout/parser).
- `web/components/arc/render-bus.tsx` — `RenderBusProvider` + `useRenderBusContext` (useReducer).
- `web/components/arc/use-render-bus.ts` — re-exporta `useRenderBus`.
- `web/components/arc/holo-panel.tsx` — painel base framer-motion (scale+blur+glow; classes `hud-*` do globals.css).
- `web/components/arc/panel-layer.tsx` — lê o bus + `AnimatePresence`; **body genérico JSON** (Waves A+ trocam pelo switch real em `panel.element`).
- `web/components/arc/arc-stage.tsx` — overlay `fixed inset-0 z-30`; reusa `<UltronStage/>` + RenderBusProvider + PanelLayer + topo (ARC · Sair).
- `web/app/(app)/dashboard/arc/page.tsx` — shell server (`dynamic="force-dynamic"`).

Arquivos **alterados** (aditivo): `web/app/(app)/dashboard/layout.tsx` (link **ARC** no nav), `web/package.json` + `web/package-lock.json` (framer-motion@^12).

### ✅ Wave A — Voz→Render→Dismiss (MVP demonstrável) — DONE + verde (16 testes/typecheck/build)
Implementado (tudo aditivo, espelhando o padrão agentTriggers/landingEdits):
- `render-intents.ts` — **nova fn pura** `uiIntentFromToolResult(result)` (lê `result.ui_intent`, valida com `UIIntentSchema`); mantida aqui (sem deps server-only) p/ ser testável no env node.
- `agent-trigger.ts` — `ARC_RENDER_CHANNEL`/`ARC_RENDER_EVENT = "ultron-arc-render"`. Payload = **array** de UIIntent (revalidado por `parseUIIntents` no cliente).
- `pending.ts` — `PendingTurn.uiIntents?: UIIntent[]` (resume pós-captura preserva os intents).
- `chat.ts` — `ChatReply`/`ChatNeedCapture` ganham `uiIntents`; `pushUiIntent` (dedup por op+element/id ou op+target); `runLoop` threada `uiIntents` (param novo, **6º**) e coleta após `runTool`; todos os returns + `savePending` + `runChat`([], +1 arg) + `resumeChat`(`pending.uiIntents ?? []`).
- `tools.ts` — 3 render-tools no objeto `tools` (entram em `toolSpecs`/`runTool` automaticamente, **NÃO** em CLIENT_TOOLS): `show_funnel(client_slug)` (guard `operatorOwnsClient` → `getLatestFunnel({clientId})`), `show_daily_summary(client_slug, date?)` (guard → tabela `daily_summaries`), `dismiss_element(target)`. Cada uma devolve `{ ui_intent: {...} }`. **ids singleton** = nome do elemento ("funnel"/"daily_summary") → dismiss por nome é natural.
- `route.ts` — `uiIntents` nos 4 `c.json` (chat reply/need_capture + capture reply/need_capture).
- `use-ultron-voice.ts` — `UltronApiResponse.uiIntents?`; `publishUiIntents` (parse → CustomEvent array + BroadcastChannel array, sem dedup pois reducer é idempotente); chamado nos 2 pontos (reply @~528 + resume @~545) + dep.
- `components/arc/arc-bridge.tsx` (NOVO) — dentro do RenderBusProvider, escuta `ARC_RENDER_EVENT`+`BroadcastChannel`, `dispatchMany(parseUIIntents(...))`. Montado em `arc-stage.tsx` ao lado do PanelLayer.
- `components/arc/panels/funnel-panel.tsx` + `daily-summary-panel.tsx` (NOVOS) — narrowing defensivo de `data:unknown`; funnel-panel usa **`import type { FunnelData }`** (type-only → o `import "server-only"` do service é apagado, não quebra o client). `panel-layer.tsx` agora faz switch em `panel.element` (funnel/daily_summary reais; resto cai no JSON genérico).
- `prompt.ts` — seção "INTERFACE HOLOGRÁFICA (MODO ARC)": gramática de voz + regra "resuma e ofereça tirar"; render-tools NÃO usam confirm em dois passos.

**Aceite Wave A** (validar ao vivo): `/dashboard/arc` → "como estão as campanhas do brunobracaioli?" → painel de funil materializa, Ultron resume, "pode tirar" → some. `uiIntents` no retorno de `/api/ultron/chat`.

### ✅ Wave B — Shell de pastas + clientes (imagens 1–3) — DONE, na main (PR #13)
`show_clients` (lista escopada por `operator_id`) + `open_client` (card nome/site/produtos/skills via
products+client_skills, guard `operatorOwnsClient`); painéis `clients-folder.tsx` (5 pastas → lista rolante,
clicável) + `client-card.tsx`; state machine PURA `lib/ultron/arc-folders.ts` (`folderShellReducer`, só
"clientes" ready, +7 testes). Validado e2e ao vivo.

### ✅ Wave C — Análises/criativo/landing + popout + narração com `render` — DONE, na main (PRs #14/#15/#16 + fix #17)
- **C.1** (PR #14): `show_analyses`/`show_creative`/`show_landing`/`focus_element` + painéis. Guard de iframe
  `lib/ultron/arc-url.ts#isB2TechUrl` (PURO, testado), validado nos 2 lados.
- **C.2a** (PR #15): migration `ultron_narrations.render jsonb` **aplicada em prod** + `getPendingNarrations`
  seleciona render + `pollNarrations` faz `publishUiIntents(next.render)` antes do speak.
- **C.2b** (PR #16): popout = **ESPELHO** (decisão do operador). `popout_element` + botão "⧉ 2ª tela" abrem
  `/arc-popout` (FORA de /dashboard p/ não duplicar voz; auth-gate no middleware); canal `ARC_POPOUT_CHANNEL`
  faz hello/sync (catch-up dos painéis já abertos).
- **fix #17:** landing preview embedava `*.b2tech.io` → bloqueado pelo CSP `frame-src 'self'`. Corrigido p/
  embedar a rota MESMA-ORIGEM `/lp-preview/<id>` (o que o editor + live-review já usam); URL pública vira só
  link ↗. Também: prompt mapeia palavra falada→id (focus/dismiss) e prefere show_* a get_* no ARC.

### 🔧 Wave E (em andamento) — Polish
**PR #18 (`refactor/arc-panel-polish`, mergeado):** HoloPanel virou **fonte única de largura** (`size`
default/wide; landing/creative/analyses = wide), os painéis deixaram de fixar largura própria;
+`prefers-reduced-motion` (fade simples); indicador de foco mais claro (header tint + dot); layer com
`overflow-y-auto`.

**PR #19 (`feat/arc-draggable-resizable-panels`, aberto) — painéis flutuantes, VALIDADO AO VIVO 2026-06-26:**
cada `HoloPanel` virou janela: **arrasta pelo header** (framer `drag`+`dragControls`+`dragListener=false` → só
o cabeçalho inicia, corpo continua clicável/rolável), **redimensiona** pelo handle inferior-direito (w+h, min/máx,
scroll interno quando menor que o conteúdo), **clique traz à frente** (reusa `op:"focus"` do reducer; layer
mapeia índice→zIndex), nasce em **cascade** preso à tela (`dragConstraints` = a layer, agora `absolute inset-0`
no lugar do flex-wrap), **duplo-clique no header reseta**. Geometria (x/y/w/h) é estado LOCAL em **motion values**
(fora do Render Bus — drag/resize são alta-freq e não podem thrashar o lip-sync, ADR 0031; motion values dirigem
o DOM, então re-render não sobrescreve o layout do usuário). Height fica `auto` até redimensionar. Math pura
testável `lib/ultron/arc-geometry.ts` (clamp/cascade, +9 testes) usando `PanelSize` de `holo-panel.types.ts` (pra
não puxar framer pro teste node). Verde: tsc, 204/204, build. Não-objetivos: sem sync de geometria pro popout
(espelho de conteúdo só) nem persistência entre sessões.

**Pendente da Wave E:** SFX de materialização, boot sequence, parallax, transições refinadas.

> **Gotcha de worktree compartilhado:** `/mnt/c` é UM worktree usado por sessões concorrentes. Outra sessão
> deu `git checkout` e TROCOU O HEAD debaixo desta — um `git commit` caiu na branch errada. Sempre conferir
> `git branch --show-current` antes de commitar, stage só os arquivos do escopo (nunca `git add -A`), e fazer
> push por **refspec** (sem checkout). Para commitar docs sem mexer na árvore alheia, usar `git worktree add`.

### ⬜ Wave D — Gestos por webcam (MediaPipe HandLandmarker) — PRÓXIMA

## 5. RECEITA EXECUTÁVEL da Wave A (com caminhos e âncoras reais)

Tudo espelha o padrão `agentTriggers`/`landingEdits` que JÁ existe — **copiar, não inventar**.

1. **`web/lib/ultron/agent-trigger.ts`** — adicionar `ARC_RENDER_CHANNEL = "ultron-arc-render"` + `ARC_RENDER_EVENT`
   (ao lado de `AGENT_TRIGGER_CHANNEL` etc.). Guard de runtime = reusar `parseUIIntents` de `render-intents.ts`.

2. **`web/lib/ultron/chat.ts`**:
   - `ChatReply` (linha ~30) e `ChatNeedCapture` (linha ~38): adicionar `uiIntents: UIIntent[]`.
   - Criar `uiIntentFromToolResult(toolName, result)` (espelhar `agentTriggerFromToolResult` @75 / `landingEditFromToolResult` @102) — lê `result.ui_intent` e valida com `UIIntentSchema`.
   - Criar `pushUiIntent` (espelhar `pushAgentTrigger` @97).
   - `runLoop` (@~152): threadar `uiIntents` como param + após `runTool` (@185) chamar `pushUiIntent(...)`; incluir `uiIntents` nos 3 returns (`kind:"reply"` @168 e @218; `need_capture` @211) e em `resumeChat`.
   - **render-tools são tools de SERVIDOR** (em `toolSpecs`/`runTool`), **NÃO** entram em `CLIENT_TOOLS` (essas pausam p/ captura de tela). O intent vai no result, igual aos triggers.

3. **`web/lib/ultron/tools.ts`**: adicionar specs+handlers `show_funnel`, `show_daily_summary`, `dismiss_element`.
   - `show_funnel(client_slug)` → `getLatestFunnel(...)` de `lib/services/funnel.ts` → `{ ui_intent: {op:"show", element:"funnel", id, data} }`. **Guard `operatorOwnsClient` ANTES** de devolver dados (já usado nas tools existentes).
   - `show_daily_summary(client_slug, date?)` → reusar o caminho de dados do tool `get_daily_summary` já existente (tabela `daily_summaries`).
   - `dismiss_element(target)` → `{ ui_intent: {op:"dismiss", target} }` (sem dados, sem guard).

4. **`web/app/api/[[...route]]/route.ts`**: no handler `POST /api/ultron/chat` (procurar `runChat(`), incluir `uiIntents` no `c.json(...)` ao lado de `agentTriggers`/`landingEdits`/`liveReviews`.

5. **`web/components/ultron/use-ultron-voice.ts`**:
   - tipo da resposta (linhas ~77-79): adicionar `uiIntents?: unknown[]`.
   - criar `publishUiIntents()` (espelhar `publishAgentTriggers` @~165): `parseUIIntents` → CustomEvent `ARC_RENDER_EVENT` (same-window) + `BroadcastChannel(ARC_RENDER_CHANNEL)` (cross-tab/popout).
   - chamar `publishUiIntents(data.uiIntents)` nos DOIS pontos: reply normal (@~522) e resume pós-capture (@~539-541).
   - **Mesmo caminho serve à narração autônoma** (Wave C): quando `pollNarrations` falar uma narração com `render`, publicar pelo mesmo canal.

6. **`web/components/arc/arc-bridge.tsx`** (NOVO, "use client"): dentro do `RenderBusProvider`, `useEffect` que escuta `ARC_RENDER_EVENT` (window) + `BroadcastChannel(ARC_RENDER_CHANNEL)` e faz `dispatchMany(parseUIIntents(payload))`. Montar dentro de `arc-stage.tsx` ao lado de `<PanelLayer/>`.

7. **`web/components/arc/panel-layer.tsx`**: trocar `renderBody` genérico por switch em `panel.element` → painéis reais `funnel-panel.tsx` (base visual `components/funnel/funnel-view.tsx`) e `daily-summary-panel.tsx`. Cada painel revalida seu `data` com sub-schema reusando os tipos dos services.

8. **`web/lib/ultron/prompt.ts`** (`ULTRON_SYSTEM_PROMPT`): adicionar gramática de voz (§8 do plano) + regra "após resumir, OFERECER remover o elemento ('Posso tirar o funil?')".

**Critério de aceite Wave A:** abrir `/dashboard/arc`, falar "como estão as campanhas do brunobracaioli?" →
painel de funil materializa (dados reais), Ultron resume, "pode tirar" → some. Network mostra `uiIntents` no
retorno de `/api/ultron/chat`. Testes: `uiIntentFromToolResult` (unit) + render-tool nega cliente alheio (integração).

## 6. Contratos-chave (resumo; fonte = render-intents.ts)

```
UIIntent =
  | {op:"show", element:"funnel"|"daily_summary"|"clients"|"client"|"analyses"|"creative"|"landing", id, anchor?, data}
  | {op:"dismiss", target}   // id ou "all"
  | {op:"focus", target}
  | {op:"popout", target}
```
`data` trafega como `unknown`; validação rica é por-painel no mount. `parseUIIntents` nunca lança.

## 7. Reuso confirmado (assinaturas reais — não recriar)

| Quero | Onde | Nota |
|---|---|---|
| Voz/STT/TTS/lip-sync | `UltronProvider` em `dashboard/layout.tsx`; hook `components/ultron/use-ultron-voice.ts` | já montado p/ a aba arc |
| `useUltron()` | `components/ultron/ultron-provider.tsx` | contexto da voz |
| Avatar 3D | `components/ultron-3d/ultron-stage.tsx` — `export function UltronStage()` **sem props** | usa altura própria `h-[calc(100vh-9rem)]` |
| Funil | `lib/services/funnel.ts` → `getLatestFunnel`/`getFunnelDirectory`, tipo `FunnelData`; visual `components/funnel/funnel-view.tsx` | |
| Análises | `lib/services/analyses.ts` → `getAnalysisRounds`, tipo `AnalysisRound`; visual `components/analyses/analyses-table.tsx` | |
| Resumo diário | tabela `daily_summaries` / caminho do tool `get_daily_summary` em `tools.ts` | |
| Clientes | tool `list_clients` em `tools.ts` (+ `products`/`client_skills` do SPEC-018 p/ Wave B) | |
| Canais Broadcast | `lib/ultron/agent-trigger.ts` (constantes + guards) | adicionar ARC_RENDER aqui |
| Guard de posse | `operatorOwnsClient` (usado nas tools) | obrigatório nas render-tools de cliente |
| Classes HUD | `app/globals.css` (`hud-clip`, `hud-frame`, `hud-frame-bg`, `hud-scanlines`, `hud-chip`, `--font-hud`) | já reusadas no HoloPanel |

## 8. Achados / GOTCHAS

- **`noUncheckedIndexedAccess: true`** (tsconfig strict): acesso por índice é `T|undefined`. Usar guards no
  código e `!` em testes. (Pegou no reducer e no test da Wave 0.)
- **framer-motion@^12** instalado (compat React 19). Lockfile mudou — commitar junto.
- **z-index:** overlay ARC = `z-30` (cobre header `z-10`); console de voz flutuante = `z-50` → **fica acima**
  do overlay, então o microfone continua clicável no modo ARC. Não subir o overlay acima de 49.
- **`UltronStage`** fixa a própria altura (`h-[calc(100vh-9rem)]`); **não editei** pra não acoplar com
  `/dashboard/ultron`. Fullscreen "de verdade" (sem margem) fica pra Wave E (talvez prop opcional de sizing).
- **Páginas usam** `export const dynamic = "force-dynamic"` + `import "@fontsource/share-tech-mono"`.
- **Vitest** roda em env `node`; alias `@/*`→root e stub `server-only`→`test/stubs/empty.ts` (`vitest.config.ts`).
  Por isso o reducer é **puro** (sem React) — testável direto.
- **Anchoring por painel** (left/right/center/stack) está no modelo de dados mas o `panel-layer` ainda só
  centraliza (flex-wrap). Posicionamento real = Wave E.
- **render-tools NÃO são CLIENT_TOOLS.** CLIENT_TOOLS pausam o loop p/ captura de tela; render-tools rodam
  no servidor e devolvem o intent no result (padrão agentTriggers).

## 9. Verificação (rodar em `web/`)

```bash
npx vitest run lib/ultron/render-bus-reducer.test.ts   # unit do bus (e novos da Wave A)
npm run typecheck                                      # tsc --noEmit (strict)
npm run build                                          # Next 15 — rota /dashboard/arc deve aparecer
npm run dev                                            # validar visual: /dashboard/arc
```
Wave 0: 11 testes ✓, typecheck ✓, build ✓ (rota `/dashboard/arc` 56 kB / 348 kB First Load — three.js+framer).
Wave A: 16 testes ✓ (11 reducer + 5 `uiIntentFromToolResult`), typecheck ✓, build ✓ (`/dashboard/arc` 44.6 kB / 350 kB).

## 10. Higiene / estado git

- **Nada commitado ainda** (aguardando decisão do operador). Branch `feat/spec-019-arc-holographic-ui`.
- Branch **empilhada** sobre `feat/spec-018-…` (Wave B usa products+skills do SPEC-018). Quando spec-018
  fizer merge na main, rebasear spec-019 na main.
- Untracked pré-existentes (NÃO são desta feature): `.claude/materiais-das-empresas/.../generated-ads/…`,
  `tentativas-geracao-de-campanhas/*.json`. Não incluir nos commits da ARC.
- Antes de commitar: rodar os 3 comandos de verificação; conferir que não há segredo no diff; commits
  atômicos por wave (Conventional Commits `feat(arc): …`).
```
