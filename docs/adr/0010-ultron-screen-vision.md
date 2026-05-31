# 10. Ultron enxerga a tela do operador (screen vision)

Date: 2026-05-31

## Status

Accepted

## Context

O Ultron responde só com base nos dados do Supabase (tools server-side). Ele não
sabe o que o operador está vendo na tela, então não consegue ajudar com perguntas
visuais ("que erro é esse?") nem identificar a campanha que o operador está olhando
para então consultar o banco. Queremos dar ao Ultron a habilidade de **ver** a tela.

Duas dimensões de decisão:

**(A) Como capturar a imagem.**
- *DOM→imagem* (html-to-image): sem seletor, mas enxerga só as páginas do próprio
  dashboard — não vê o Gerenciador de Anúncios da Meta nem outras abas/apps.
- *Screen Capture API* (`getDisplayMedia`): pixels reais de qualquer tela/janela/aba.
  Restrição: o navegador exige gesto do usuário + seletor; **não existe** screenshot
  silencioso na web.

**(B) Quando disparar a captura.**
- *Sempre anexa*: print em toda fala → custo de visão e latência em todas as voltas.
- *Heurística no cliente*: regex no texto decide anexar → barato, porém frágil.
- *Tool + resume*: Claude decide chamar `capture_screen`; servidor pausa e o cliente
  captura sob demanda → custo só quando preciso, encadeia captura→consulta de dados.

Restrição técnica que liga A e B: `getDisplayMedia` precisa de *transient activation*
(gesto). Numa volta de voz não há clique, então capturar sob demanda do Claude só é
viável a partir de um stream **já compartilhado**.

## Decision

- **(A)** Screen Capture API (`getDisplayMedia`) com **stream persistente**: o
  operador clica uma vez em "Ultron pode ver minha tela" (gesto → seletor), escolhe
  o que compartilhar, e o stream fica vivo pela sessão. As capturas seguintes pegam
  um quadro desse stream — silenciosas e instantâneas. Quadros são reduzidos a
  ≤1280px e enviados como JPEG base64.
- **(B)** **Tool + resume**: `capture_screen` é uma tool *client-side* (sem handler
  no servidor). O loop em `chat.ts` detecta a chamada, persiste o estado in-flight
  no Redis (`ultron:pending:*`, TTL 120 s) e devolve `need_capture`. O cliente
  captura e chama `POST /api/ultron/capture`; o servidor retoma o loop injetando a
  imagem como `tool_result` (suportado pelo Sonnet 4.6) e segue — podendo chamar uma
  tool de dados na sequência.

## Consequences

**Positivas**
- Enxerga qualquer aba/app (Meta Ads Manager incluso), com pixels reais.
- Custo de visão só quando o Claude realmente precisa ver.
- Encadeamento natural captura→dados no mesmo resume.
- Consentimento explícito e visível (aviso de compartilhamento do navegador).

**Negativas / trade-offs**
- O operador precisa compartilhar a tela uma vez por sessão (não é zero-fricção).
- Aviso de compartilhamento persistente enquanto durar.
- Protocolo de duas requisições + estado efêmero no Redis (mais complexo que
  request/response puro).
- A imagem pode conter dados de outras abas → tratado no threat model
  ([ultron-screen-vision](../security/threats/ultron-screen-vision.md)): consentimento,
  sem log, sem persistência em DB, TTL curto, e texto na tela tratado como conteúdo
  (anti prompt-injection visual). A visão é só leitura — não cria nem ativa nada.

## Alternatives considered

- *DOM→imagem*: descartado por não enxergar fora do dashboard (o caso principal é
  justamente ver o Meta Ads Manager).
- *Sempre anexa / heurística*: descartados — custo/latência por volta e fragilidade,
  e não modelam bem o "Ultron decide olhar" que o tool+resume captura.
