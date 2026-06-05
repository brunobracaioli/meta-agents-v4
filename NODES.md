# NODES — handoff pós-/compact

> **Leia este arquivo PRIMEIRO** se a conversa foi compactada. Captura o que foi
> descoberto/decidido/feito nas rodadas recentes. Frente viva agora:
> 1. **Geração autônoma de landing page — endurecimento da camada de render.** Um teste e2e
>    da criação de LP pelo **modo autônomo** (SPEC-013) expôs uma cadeia de 500s no
>    `/lp-preview`. Todos corrigidos, mergeados e **deployados**. Última peça: um **bug de
>    cache de build** que escondia a correção (ver §0 e ADR 0017).
> 2. **Pendências de gravação/infra** carry-over: Surface B do Live Review, take de teste,
>    `RESEND_API_KEY` no Fly, SPEC-013 Fase 4. (§7)
>
> Fontes de verdade: `docs/adr/0017-*` (lp-render + gotchas de build), `docs/specs/SPEC-012-*`
> (editor), `docs/specs/SPEC-014-*` + `docs/adr/0020-*` (Live Review), `docs/specs/SPEC-013-*`
> + `docs/adr/0019-*` (modo autônomo headless). Memória de projeto carrega sozinha.

---

## 0. TL;DR de estado

- **Git: `main` == `origin` (HEAD `4a1af97`).** Sem branches não-mergeadas. Tudo abaixo já
  está na `main` e **deployado** (Vercel auto-deploy no push).
- **Camada de render do lp-render = ENDURECIDA (3 correções + 1 de cache), tudo na `main`:**
  1. `dd45b76` **copy-key-drift** — o serializer (`serialize.ts`, `normalizeSectionFields`)
     normaliza drift de chave do LLM (`headline`→`heading`, card `body`→`desc`, bullets
     objeto→string) no **único boundary** de serialização. Não quebra mais com React #31.
  2. `6fa40d9` **copy-contract (write-time)** — a skill `create-landing-page` normaliza os
     `fields` (jq) **antes** de escrever no Supabase, espelhando o serializer. O DB não
     guarda mais shapes que quebram render. (Roda no **runner Fly**.)
  3. `deb3422` **guard-maps** — toda seção guarda `.map` com `(data.X ?? []).map(...)`
     (items/modules/rows/bonuses/payments/credentials/testimonials/bullets/faq/footer.links).
     LP renderiza a seção **sem** os itens em vez de 500 quando o LLM omite o array.
  4. `4a1af97` **cache-stale (este round)** — ver abaixo. Era o que mantinha a (3) invisível.
- **Bug de cache resolvido (`4a1af97`):** `/lp-preview` dava 500 **mesmo no commit certo** —
  o bundle deployado tinha o `footer.links.map` **sem guarda**. Causa: `resolve.symlinks=false`
  faz o webpack ver o `@b2tech/lp-render` como **managed path** (imutável, invalidado só por
  bump de versão) no cache persistente da Vercel → `file:` dep mudava sem bumpar → transpc­ile
  velho reusado. Fix: excluir o pacote dos `snapshot.managedPaths` (rastreio por conteúdo) +
  editar o `next.config` força invalidação total. **Verificado ao vivo: 200, footer renderiza.**
  Detalhe completo em **ADR 0017 §"Implementação (2026-06-05)"** + memória
  `lp-render-stale-webpack-cache`.
- **Ultron Live Review (Surface A) = MERGEADO e deployado** (`bde54a6`) + **auto-trigger na
  conclusão** (`f6d66da`): quando a LP fica pronta, o Live Review abre sozinho (tela já
  compartilhada) e roda o loop scroll→print→visão→voz. **Falta**: Surface B (cross-origin) e a
  take de gravação. Ver SPEC-014 §10 (1–4 ✅, 5–6 ⬜).
- **Painel 3D (Stage3D) = na `main` e deployado** (web Vercel + runner Fly). A geração
  autônoma provisiona `.glb` + logo + `settings.stage3d`.
- **Pendências carry-over**: `fly secrets set RESEND_API_KEY=re_... -a meta-agents-v4` +
  domínio Resend (sem isso o email do modo autônomo degrada gracioso); SPEC-013 Fase 4.

## 1. Contexto desta rodada (o bug do preview)

Teste e2e da criação de LP pelo **modo autônomo** gerou a `imersao-agencia`
(`70b5325f-…`). A página foi criada certa, mas o **visualizador de review** (`/lp-preview/[id]`,
embutido em iframe no dashboard) dava **500** (`Cannot read properties of undefined (reading
'map')`). O `footer` dessa LP só tem `{body}` (sem o array opcional `links`) e o `Footer`
**deployado** fazia `messages.footer.links.map(...)` sem guarda.

A pegadinha: a guarda **já existia** no commit em produção — mas o **bundle** não. Diagnóstico
decisivo foi baixar o chunk de produção e ver 0 `?? []`. Causa = cache de managed-path (acima).

## 2. Diagnóstico replicável (como confirmar de novo)

1. `git log` confirma que a correção está na `main` e a Vercel está nesse SHA
   (`mcp vercel list_deployments` → `meta.githubCommitSha`).
2. **Não confie no SHA**: baixe o chunk deployado e procure a correção:
   `curl -s ".../_next/static/chunks/694-*.js?dpl=<id>" | grep -c '??\[\]'`. Zero = bundle stale.
3. Se stale: o fix de `next.config` (managedPaths) já cobre; um novo deploy reconstrói limpo.
   Alternativa de emergência: Redeploy **without build cache** no painel da Vercel.

## 3. Reuso (não reinventar) — caminhos

- Render compartilhado: `packages/lp-render/src/` — `PageBody`, `sections/*`, `serialize.ts`
  (boundary único de normalização), `content-*.ts`. Consumido por `web/` (preview) e
  `landing-pages/_template/` (publish). **ADR 0017** é a fonte de verdade do pacote + build.
- Preview: `web/app/(preview)/lp-preview/[id]/` (`page.tsx` server + `preview-client.tsx`).
- Skill de criação: `.claude/skills/create-landing-page-brunobracaioli` (normalização
  write-time no Passo 4; provisiona `settings.stage3d` no Passo 6).
- Skill de publish: `.claude/skills/publish-landing-page-brunobracaioli` (serializer no Fly).
- Live Review: `web/lib/ultron/live-review.ts` + `live-review-stage.tsx` + `ReviewBridge`
  (lp-render) + `web/app/api/ultron/review-frame`.
- Modo autônomo: `.claude/skills/autonomous-watch-tick` + `scripts/poll-autonomous-watches.sh`.

## 4. Estado do sistema (o que está no ar)

- **Vercel (web/editor/preview)**: deploy `4a1af97` READY (produção, `meta-agents-v4.vercel.app`).
  - `resolve.symlinks=false` faz lp-render+three buildar no clean install — **não remover**.
  - `snapshot.managedPaths` exclui `@b2tech/lp-render` para não shipar bundle stale — **não remover**.
- **Fly runner `meta-agents-v4`** (machine `286501db9e7e78`, gru): imagem com skills de LP +
  lp-render + three + `.glb`. Redeploy via `fly deploy`. (Builda limpo, sem o cache da Vercel.)
- **Supabase**: LP `imersao-agencia` `70b5325f-…` existe e renderiza. `settings.stage3d
  {model,poster?,rain?,color?,logo?}` é o contrato do painel 3D.

## 5. Gotchas obrigatórios

- **lp-render é `file:` symlinkado.** Builds resolvem deps pelo **realpath** (sem node_modules
  no clean install). TS usa `preserveSymlinks`; webpack usa `resolve.symlinks=false`. Toda dep
  nova do lp-render tem que estar no **consumidor** (web + template).
- **Cache de managed-path (NOVO):** por causa do `symlinks=false`, o webpack trata o lp-render
  como pacote imutável no cache. O fix `snapshot.managedPaths` resolve, mas se a produção
  mostrar comportamento antigo **no commit certo**, é cache — confira o **chunk deployado**.
- **NUNCA** `git add .` cego aqui: já varreu um **OBS-Installer de 157MB** recusado pelo GitHub.
  Stagear **paths explícitos**.
- **WebGL headless é preto/instável** → Live Review (SPEC-014) roda no navegador real do
  operador. A revisão headless (SPEC-013) é p/ operador ausente.
- **Cross-origin**: dashboard (`vercel.app`) ≠ landing (`b2tech.io`). Surface B precisa do
  ReviewBridge + allowlist. Surface A (same-origin `/lp-preview`) evita isso.
- **Supabase headless = REST/curl** (MCP é OAuth-gated no runner). Padrão das skills.

## 6. Próximas ações concretas

1. (Gravação) Take de teste do fluxo autônomo completo: criar LP pelo Ultron → review (Surface A
   auto-trigger) → publicar → conferir painel 3D e email. (Custo: gpt-image-2 ~US$0,40; ~14 min.)
2. **SPEC-014 §10 passos 5–6**: Surface B (cross-origin) + hardening/e2e.
3. (Email autônomo) `fly secrets set RESEND_API_KEY=... -a meta-agents-v4` + domínio Resend.
4. SPEC-013 Fase 4 (carry-over do modo autônomo).
