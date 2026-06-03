# How-to — Editar e publicar uma landing page

> Receita prática (Diátaxis). Pressupõe uma LP já criada (pela skill de geração ou pelo Ultron)
> e que você está autenticado no dashboard. Contexto/racional: SPEC-012, ADR 0015.

## Modelo mental em uma frase

Você edita o **rascunho** (vive no Supabase, reflete na hora no preview). O site público no
Cloudflare só muda quando você **Publicar** — edição não vai ao ar sozinha.

## A. Editar pelo painel (operador)

1. Vá em **Dashboard → Clientes → `<cliente>` → `<produto>` → a landing page**. URL:
   `/dashboard/clients/<slug>/<produto>/landing-page/<id>`.
2. À direita, o **preview em iframe** mostra a página real. Use o toggle **390px / 100%** para
   conferir mobile e desktop.
3. À esquerda, escolha a aba:
   - **Seção** — edite o texto de cada bloco (headline, bullets, itens, FAQ…). O editor é
     genérico: campos de texto, listas (adicionar/remover itens) e objetos aninhados.
   - **Tema** — cor (color-picker → hex), fonte (lista curada) e escala (slider 0.8–1.3).
   - **Config** — SEO (title/description), oferta (checkout, preço), carrinho fechado.
4. Cada mudança reflete **na hora** no iframe e é salva sozinha (debounce ~600ms). Se aparecer
   um aviso de conflito, é porque o Ultron (ou outra aba) editou a mesma seção — o editor
   reconcilia com a versão mais recente; basta reaplicar sua mudança.
5. Durante `generating`/`publishing` o editor fica **somente-leitura** e faz polling até liberar.

## B. Editar pela voz (Ultron)

1. Peça ao Ultron para **listar**: "Ultron, quais landing pages tem o cliente brunobracaioli?"
   → ele usa `list_landing_pages`.
2. Para descobrir os "endereços" editáveis: "me mostra os campos da landing page X" →
   `get_landing_page` devolve seções + chaves + valores (truncados).
3. Edite um campo: "modifique o headline da hero da landing page X". Se faltar seção/campo/valor,
   o Ultron pergunta. Ele **relê o de/para e pede confirmação** — só aplica após o seu "sim".
   - Edições de **texto** e **tema** são baratas e **síncronas** (vão direto pro rascunho).
   - O Ultron edita **um campo escalar existente** por vez (texto/número/sim-não). Reordenar
     blocos, adicionar/remover itens de lista ou trocar imagem → use o painel.
4. Toda edição/publish do Ultron fica registrada em `operation_logs` (trilha de auditoria).

## C. Publicar (vai ao ar)

1. Pelo painel: botão **Publicar**. Para **go-live indexável**, marque a opção de tirar o
   `noindex` (por padrão republica mantendo o estado atual, em preview).
2. Pela voz: "Ultron, publica a landing page X" (ou "publica indexável" para go-live). Confirma
   em 2 turnos.
3. O publish **enfileira** um job `landing_publish`: o runner Fly serializa o rascunho →
   `next build` → `wrangler deploy` em `<subdomínio>.b2tech.io`. Costuma levar ~1–2 min.
4. Acompanhe pelo dashboard (a LP fica `publishing` e volta a `ready` ao terminar) ou pergunte
   ao Ultron: "a publicação da landing page X terminou?".

## Erros comuns

| Sintoma | Causa | O que fazer |
|---|---|---|
| "já existe uma publicação em andamento" | dedup per-LP (1 publish ativo por LP) | espere o publish atual terminar |
| campo não salva / aviso de conflito | outra edição avançou a versão | reaplique; o editor já recarregou o estado |
| editor somente-leitura | a LP está `generating`/`publishing` | aguarde liberar |
| link rejeitado ao salvar footer | `href` não é http(s)/`#`/relativo | use um link seguro (sem `javascript:`) |
| cor recusada no tema | valor não é hex | use `#RRGGBB` (ex.: `#FF6B1A`) |
| `noindex` não mudou no site | `noindex` é build-time | **republicar** (não basta editar) |

## Notas

- O preview é fiel ao publicado porque ambos usam o mesmo pacote de render (`@b2tech/lp-render`).
- Subdomínio, pixels de tracking e `site_url` **não** são editáveis (definem identidade/deploy).
- Upload de imagem aceita só raster (jpeg/png/webp/avif), ≤ 5MB.
