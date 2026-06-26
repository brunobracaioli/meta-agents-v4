# 0031 — ARC: frontend holográfico do Ultron via Render Bus de UIIntents

- **Status:** accepted
- **Data:** 2026-06-26
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** [SPEC-019](../specs/SPEC-019-arc-holographic-ui.md),
  ADR 0010 (Ultron screen-vision), ADR 0011 (VAD AudioWorklet), ADR 0019 (Ultron autônomo),
  ADR 0020 (live review client-side), ADR 0026 (multi-tenant)

## Context

O dashboard é hoje uma UI clássica por páginas (`/funnel`, `/analyses`, `/clients-management`, ...). O
operador quer **romper com o modelo `pages/`**: uma interface onde a **fala do Ultron é a própria
interface** — comando por voz materializa painéis holográficos (funil, resumo, pastas/clientes, análises,
criativo, landing) que entram e saem sob demanda, estilo Tony Stark/JARVIS, com gestos por webcam numa fase
seguinte. Toda a infra de voz/STT/TTS/lip-sync, narração autônoma e screen-vision já existe e está validada
em produção. A questão é **como introduzir a camada visual dinâmica sem reescrever o pipeline nem arriscar o
dashboard atual**.

## Decision

### 1. Render Bus alimentado por UIIntents (não um router de páginas)

O estado visual é uma **pilha de painéis ativos** num Render Bus client-side (Context + reducer), empurrada
por **diretivas declarativas `UIIntent`** (`show`/`dismiss`/`focus`/`popout`) que o Ultron emite. Não há
navegação obrigatória por menu: a UI é derivada da intenção falada/narrada. Teto de painéis + TTL contêm o
estado. Mutação por evento preserva o lip-sync imperativo (`liveSignalRef`) sem re-render de alta frequência.

**Alternativas descartadas:** (a) novas rotas/páginas por elemento — é exatamente o modelo que se quer
romper; (b) o Ultron escrevendo HTML/markup livre — perde tipagem, validação e segurança; (c) state global
ad-hoc sem contrato — frágil e não auditável.

### 2. Render-tools reusam o mecanismo de tools já existente

As render-tools são uma **categoria irmã de `CLIENT_TOOLS`** no chat loop. São **read-only**: o handler
resolve dados **server-side** reusando os data services (`getLatestFunnel`, `getAnalysisRounds`,
`getDailySummary`, `list_clients`) sob o guard `operatorOwnsClient`, e devolve o `UIIntent` no payload —
espelhando o `agentTriggers` que já trafega hoje. Nenhuma mutação passa por render-tool; jobs continuam
exclusivamente nas tools `request_*` existentes (logadas em `operation_logs`/`agent_events`).

### 3. Frontend aditivo e opt-in (`/dashboard/arc`)

Nova rota fullscreen dentro do grupo `(app)` (reusa o `UltronProvider` já montado no layout). O dashboard
clássico fica **100% intacto** como rollback. Render espacial em **2.5D com framer-motion** (CSS
`perspective`/`backdrop-blur`/glow) — não react-three-fiber: mais leve, entrega rápida, sem re-bake de
textura, suficiente para "painéis flutuando sobre o avatar". Superfície padrão = overlay sobre o Ultron, com
**popout opcional** para 2ª janela via `BroadcastChannel("ARC_RENDER")` (padrão já usado no projeto).

### 4. Narração autônoma pode carregar render

Coluna aditiva `ultron_narrations.render jsonb` (nullable). Quando o Ultron fala uma narração com `render`,
empurra o intent no bus — o modo autônomo também materializa elementos. `null` preserva o comportamento atual.

### 5. Gestos por webcam adiados, projetados agora

`@mediapipe/tasks-vision` (já instalado, mesma lib do `use-face-tracking.ts`) fornece `HandLandmarker`/
`GestureRecognizer`. Os gestos (punho→palma, swipe, apontar) entram numa wave posterior para de-riscar a
entrega — voz+render primeiro. Atuam só no painel **em foco**, com debounce/histerese.

## Consequences

**Positivas:**
- Reuso total do pipeline de voz/narração/visão e dos data services — a feature é, em essência, uma camada
  de apresentação nova.
- Dashboard atual intacto: rollback trivial (não entrar em `/dashboard/arc`).
- Contrato `UIIntent` único (Zod) torna a superfície auditável e validável nas três bordas (tool, chat, bus).
- 1 dependência nova (`framer-motion`) e 1 coluna aditiva — sem tabela nova.

**Negativas / trade-offs:**
- 2.5D não tem profundidade/shaders reais de holograma 3D — aceito por custo/benefício; migrar para r3f no
  futuro é possível mantendo o mesmo Render Bus.
- Painéis 2.5D não integram com a iluminação da cena do avatar.
- Webcam/gestos adicionam superfície (getUserMedia) — opt-in explícito, igual à screen-share atual.
- A qualidade do mapeamento voz→intent depende do `ULTRON_SYSTEM_PROMPT` (gramática) — tuning iterativo.
