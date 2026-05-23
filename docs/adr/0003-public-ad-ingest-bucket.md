# ADR 0003 — Bucket público de ingestão para imagens de anúncio do Meta

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-23 |
| Decidido por | brunobracaioli |
| Relacionado | [ADR 0002](0002-supabase-meta-ads-persistence-schema.md) |

## Context

O CLAUDE.md define o Storage como **bucket privado `creatives`**. Mas o creative de
um link ad no Meta precisa de imagem ou via `image_hash` (upload em
`POST /act_X/adimages`) ou via `link_data.picture` (URL que o Meta baixa e hasheia).

Restrições reais encontradas:

1. O **MCP do Meta não expõe upload de imagem** — não há como obter `image_hash`
   sem um token de Marketing API fora do MCP.
2. O **fetcher do Meta não consegue baixar a signed URL privada do Supabase**
   (erro `Image Wasn't Downloaded`, subcode 3858258) — o endpoint `/object/sign`
   com JWT em query, atrás do Cloudflare, é bloqueado para o crawler do Meta.
   `curl` baixa (200), mas o Meta não.

Logo, sem token, a única forma de anexar a imagem via MCP é uma **URL pública**
que o Meta consiga baixar.

## Decision

Criamos um bucket **público** dedicado `ad-ingest` (separado do `creatives` privado),
com paths randomizados (`<cliente>/<data>/<rand-hex>/`), e atualizamos os creatives
via `ads_update_entity` usando `link_data.picture` apontando para a URL pública.

## Por que isso não é uma regressão de segurança relevante

- **Imagem de anúncio é pública por natureza**: assim que o ad roda, o Meta serve a
  imagem publicamente para a audiência. Não há segredo no asset.
- O **master privado** continua no bucket `creatives` (ADR 0002). O `ad-ingest` é só
  cópia de ingestão para o Meta baixar.
- Paths com sufixo aleatório + endpoint de **list** exigindo auth reduzem enumeração.

## Consequences

### Positivas
- Imagens anexadas aos 3 ads da campanha CCA 100% via MCP, sem token externo.
- Mantém o `creatives` privado como fonte canônica.

### Negativas / dívidas
- Existe agora um bucket público no projeto — escopo limitado a imagens de anúncio.
- Cada `ads_update_entity` com creative inline **cria um novo creative** no Meta; os
  creatives antigos (sem imagem) ficam órfãos na biblioteca do ad account (inertes).
- Alternativa mais "limpa" (token → `image_hash`, tudo privado) fica registrada como
  opção caso se queira eliminar o bucket público no futuro.
