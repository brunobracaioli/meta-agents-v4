# ADR 0017 — Pacote compartilhado `@b2tech/lp-render` (template + web) via `file:` dependency

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-03 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-012](../specs/SPEC-012-landing-page-editor.md) |
| Relacionado | [ADR 0013](0013-landing-page-design-system.md) (design system), [ADR 0015](0015-editable-landing-pages-supabase-draft.md) |
| Afeta | `packages/lp-render/`, `landing-pages/_template/`, `web/`, `Dockerfile` |

## Context

O editor WYSIWYG (SPEC-012) precisa renderizar um **preview fiel** da LP no dashboard,
idêntico ao que o Cloudflare serve. Hoje as 17 seções vivem em
`landing-pages/_template/components/sections/*` e leem o singleton `messages`
(`lib/content.ts`, import de JSON). Duas opções ruins:
- **Duplicar** as seções no `web/` — viola DRY; preview e produção divergem com o tempo.
- **Renderizar o site publicado** num iframe — não reflete o rascunho não-publicado.

Precisamos da **mesma árvore de componentes** nas duas superfícies (export estático do
template + preview live no web), dirigida por dados (ContentDoc) em vez do singleton.

Restrições de infra: **não há monorepo** (sem `package.json` raiz / workspaces). O template
e o web são apps Next separados, com aliases `@/` distintos. O `landing-pages/_template/
node_modules` é **pré-bakeado** na imagem Fly; o web builda na Vercel.

## Decision

**Extrair o rendering para `packages/lp-render` e consumi-lo nos dois apps via `file:`
dependency + `transpilePackages` — sem introduzir workspaces na raiz.**

- `packages/lp-render` é um pacote (`@b2tech/lp-render`, `private`) com: tipos de conteúdo
  (`content-types.ts`), o ContentDoc (`content-doc.ts`), o serializer puro (`serialize.ts`),
  as 17 seções + helpers (`CheckoutButton`/`FadeIn`/`Marquee`), `PageBody`, `globals.css`,
  e o `ContentProvider`/`useContent` (substitui o singleton).
- Cada app adiciona `"@b2tech/lp-render": "file:../../packages/lp-render"` (caminho relativo
  ao app) e `transpilePackages: ["@b2tech/lp-render"]` no `next.config`.
- O template vira casca fina: `<ContentProvider value={fromFiles()}><PageBody/></ContentProvider>`
  (zero mudança de output). O web monta o provider a partir do ContentDoc do Supabase.
- O serializer é **puro** e roda tanto no web quanto no runner Fly (publish), garantindo
  que preview e site publicado saiam do mesmo código.

`file:` dependency (em vez de npm workspaces) evita criar `package.json` raiz e mexer no
fluxo de build da Vercel/Fly: cada app resolve o pacote pelo caminho local, e o `npm ci`
pré-bakeado do template passa a incluí-lo.

## Consequences

- ✅ DRY real: uma fonte de rendering para produção e preview; não divergem.
- ✅ Serializer único (web + runner) → preview fiel ao publicado.
- ✅ Sem reestruturar o repo em workspaces; mudança localizada.
- ⚠️ As seções passam a ser **client components** (o `ContentProvider` usa context) —
  compatível com `output: 'export'` (hidratam), mas é uma mudança a validar no Wave 1 com
  rebuild byte-a-byte do `cca`.
- ⚠️ `Dockerfile` precisa `COPY packages/ ` antes do `npm ci` pré-bake do template, e o
  `file:` path deve resolver dentro da imagem. Ajuste no Wave 1.
- ⚠️ Dois `next.config` ganham `transpilePackages`; manter sincronizados.

## Implementação (Wave 1 — 2026-06-03)

Decisões concretas tomadas ao extrair o pacote, validadas por build:

- **Regressão zero confirmada.** Rebuild do `cca` com o template refatorado → o
  `<main>` (markup visível) e o `<head>` saem **byte-a-byte idênticos** ao baseline
  pré-refactor (11.486 bytes), assim como `robots.txt`/`sitemap.xml`. As únicas diferenças
  são o `buildId` aleatório por build e a contagem de `<script>` do payload RSC de
  hidratação (esperado: as seções viraram client components) — nada visível muda.
- **Type-check/lint do build per-LP desligados** (`typescript.ignoreBuildErrors` +
  `eslint.ignoreDuringBuilds` no `next.config` do template). O template é um **artefato
  gerado**, clonado e buildado headless no Fly N vezes, onde só o JSON muda — o TypeScript
  (casca + pacote) é fixo. Os tipos são **gateados na fonte** (`npm run type-check` no
  template e no pacote, em dev/CI), não em cada build headless. Isso também evita ter que
  embarcar o `node_modules` do pacote na imagem Fly só para resolver os tipos de React.
- **Resolução de React no type-check da fonte.** O `tsc` que checa os arquivos do pacote
  (programa do consumidor) precisa resolver `react` a partir da localização real do pacote
  (fora do `node_modules` do template, via symlink `file:`). Solução: o pacote declara
  `@types/react`/`@types/react-dom` como **devDependencies** e marca os peers `react`/
  `react-dom` como **optional** (`peerDependenciesMeta`) para o npm **não** instalar o
  runtime de React no `node_modules` do pacote. Resultado: o `type-check` standalone do
  pacote resolve os tipos com `@types` apenas, e o **runtime** de React vem sempre do
  consumidor (template/web) — uma única cópia, sem risco de "Invalid hook call". O
  `node_modules` do pacote é gitignored e excluído da imagem (`.dockerignore`), então em
  produção o React resolve só pelo consumidor.
- **Subpath React-free preservado.** O barrel `.` agora reexporta também os client
  components; o runner de publish (Wave 2) deve importar o serializer pelo subpath
  `@b2tech/lp-render/serialize` (não pelo barrel) para não puxar JSX/React no Node.
- **Wiring do `web` adiado para a Wave 4.** O `web` só passa a importar o pacote na rota
  de preview (`/lp-preview/[id]`). Adicionar o `file:` dep + `transpilePackages` agora,
  sem uso, tocaria o lockfile do `web` à toa — então o segundo `next.config`/dep entra
  junto com o primeiro import real, na Wave 4.

## Implementação (Wave 2 — 2026-06-03) — invocação do serializer no runner

A skill de publish (`publish-landing-page-brunobracaioli`) roda o serializer **puro** no
runner Fly, headless, sem etapa de build. Decisões validadas por build local:

- **`serialize-cli.ts` (raiz do pacote)** é o entry de publish: lê o ContentDoc (JSON que a
  skill montou do Supabase) e escreve `messages/pt.json` + `content-spec.json` +
  `app/theme.css` no diretório da LP. É um wrapper fino e determinístico sobre
  `contentDocToFiles` (sem rede, sem `Date.now()`) → publish reproduzível só a partir do
  rascunho. É type-checado na fonte (`include: ["src","serialize-cli.ts"]`; o pacote ganhou
  `@types/node` em devDeps para `node:fs`/`process`).
- **Rodar com `tsx`, não `node` puro.** O type-stripping nativo do Node 22.18+ **não**
  resolve os imports relativos `.ts` *sem extensão* do pacote (`import "./content-types"`
  → `ERR_MODULE_NOT_FOUND`) — confirmado empiricamente. Duas saídas foram comparadas:
  (a) pôr extensão `.ts` explícita em todos os imports da cadeia do serializer — funciona
  com `node` puro, mas força `allowImportingTsExtensions` em **todo** consumidor do pacote
  (template hoje, `web` na Wave 4) e deixa os imports não-idiomáticos; (b) **`tsx`** como
  devDep do `_template` (pré-bakeado na imagem Fly), rodando
  `node --import tsx packages/lp-render/serialize-cli.ts` — resolve o subpath
  `@b2tech/lp-render/serialize` e a cadeia extensionless contra a fonte **inalterada**.
  Escolhemos **(b)**: isola a preocupação "rodar TS direto" na ferramenta de publish e
  mantém o serializer compartilhado limpo. O `tsx` é resolvido a partir do `node_modules` do
  `_template` (sempre presente; rodamos o serializer com `cwd` no `_template`).
- **`theme.css` só no CLONE.** O serializer escreve `app/theme.css` (overrides `:root` por
  LP, vazio quando não há tema). O `_template` **não** importa `theme.css` (preserva a
  identidade byte-a-byte do build do template — ADR/Wave 1); a skill insere
  `import "./theme.css";` (após o `globals.css`) **apenas no layout do clone**, idempotente.
  Validado por build local: o override `--orange` do tema entra no CSS final do `out/`.
- **Distinção de guarda de deploy.** `create-landing-page` recusa sobrescrever um projeto CF
  vivo (um `nome` arbitrário poderia colidir). A skill de publish faz o oposto: a LP é
  carregada de `landing_pages` por id/subdomínio → **é dona** do subdomínio → republish é a
  função; sem guarda anti-clobber.

## Implementação (2026-06-05) — cache stale do webpack com `file:` dep symlinkado

Bug em produção: `/lp-preview/[id]` retornava **500** (`Cannot read properties of undefined
(reading 'map')`) mesmo com a produção rodando o commit que **já continha** a correção
(guarda `(messages.footer.links ?? []).map(...)`). O chunk **deployado** ainda tinha o
código antigo sem guarda — confirmado baixando o `694-*.js` de produção (0 ocorrências de
`?? []`). O dado e o código mergeado estavam corretos; o **bundle** estava velho.

**Causa raiz — interação entre dois ajustes deste ADR.** A Wave 1 usou `resolve.symlinks =
false` no `next.config` (web + template) para o `three/examples/jsm/*` do Stage3D resolver
a partir do `node_modules` do consumidor no clean install. Efeito colateral: com symlinks
desligados, o webpack enxerga `@b2tech/lp-render` pelo **caminho de symlink em
`node_modules/`**, então o **cache persistente do webpack do Next** (`.next/cache`,
restaurado entre builds pela Vercel) o trata como **managed path** — pacote imutável,
invalidado **só por bump de versão**, nunca por conteúdo. Como é um `file:` dep que muda a
cada commit sem bumpar `0.1.0`, os módulos transpc­ilados em cache foram reusados e as
correções em `packages/lp-render/src` **nunca chegaram ao bundle deployado**.

Sintoma assimétrico (pista de diagnóstico): correções de lp-render que rodam no **runner
Fly** (ex.: normalização *write-time* da copy, fix/landing-copy-contract) funcionavam — o
Fly builda limpo, sem o cache da Vercel. Só as correções **puras de render** (transpc­iladas
pelo webpack da Vercel) ficavam presas no cache.

**Decisão:** manter `resolve.symlinks = false` (é o que faz o `three` resolver) e
**excluir `@b2tech/lp-render` dos `managedPaths`** do snapshot do webpack, para o pacote ser
rastreado por **conteúdo** e rebuildar a cada mudança de fonte:

```js
config.snapshot = {
  ...(config.snapshot ?? {}),
  managedPaths: [/^(.+?[\\/]node_modules[\\/](?!@b2tech[\\/]lp-render))/],
};
```

Editar o `next.config` (que é uma *build dependency* do cache do webpack) também força uma
invalidação total do cache no deploy seguinte, então as guardas já mergeadas finalmente
subiram. Commit `4a1af97` (branch `fix/lp-render-cache-stale`). **Verificado ao vivo:**
`/lp-preview/…` voltou a 200, com o `footer` (sem `links`) renderizando limpo.

Regra de diagnóstico (memória `lp-render-stale-webpack-cache`): se após mexer em
`packages/lp-render/` a produção continuar com comportamento antigo **no commit certo**,
suspeite do cache de managed-path — confira o chunk **deployado** (não confie no SHA do
deploy).
