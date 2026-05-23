---
name: image-generate
description: Gera 1+ imagens via OpenAI gpt-image-2 a partir de um prompt direto, arquivo de prompt, ou brief que precisa virar prompt. Use quando o operador pedir "gere imagem pra ...", "crie criativo visual", "regerar a imagem do ad X", "imagem 9:16 pra story", "novo banner 1.91:1", ou quando outra skill (ex.: /create-campaign Step 3) precisar de assets visuais. Aceita imagens de referência ou para serem inseridas na imagem gerada (logo, mascote, foto de produto) e devolve manifest JSON com paths dos arquivos gerados, prompt efetivo e custo estimado — pronto pra ser consumido por uploader, brand-guard, ou Meta Ads creative.
argument-hint: "prompt=<text>|prompt-file=<path>|brief=<text>|scrape-file=<path> aspect=<1:1|9:16|1.91:1|16:9> [refs=<p1,p2>] [variants=<N>] [out-dir=<path>] [out-name=<base>]"
allowed-tools: Bash, Read, Write, Agent
---

# Skill: /image-generate

Gera imagens fotorrealistas/ilustrativas via **OpenAI gpt-image-2** com
imagens de referência opcionais (logo, mascote, foto de produto).
**Standalone**: pode ser invocada direto pelo operador OU por outra skill
(`/create-campaign` chama em loop nas 3 placements; um humano pode chamar
pra refresh de criativo).

> **Versão: v1.1** (2026-05-10).
> Anterior v1.0 (2026-05-07): script `openai-image-gen.sh` aceitava
> apenas 1 ref (LOGO_PATH hardcoded como $3). Agora aceita 0..16 refs
> via `image[]=@` no multipart (limite da API gpt-image-2). Se nenhuma
> ref válida estiver disponível, roteia automaticamente para
> `/v1/images/generations` (text-only), sem fallback de mascote fixo.
>
> **BREAKING CHANGE no script**: assinatura mudou de
> `openai-image-gen.sh PROMPT SIZE LOGO OUTPUT`
> para
> `openai-image-gen.sh PROMPT SIZE OUTPUT [REF1 REF2 ...]`

---

## Quando invocar

Auto-detect de intent — invoque mesmo sem `/image-generate` explícito:

- "gere uma imagem ...", "crie criativo visual ...", "imagem nova pra ..."
- "regerar a imagem ...", "refazer banner ...", "tentar outra variante ..."
- "imagem 9:16 pra story", "1:1 pra feed", "1.91:1 pra link ad"
- "/image-generate ..." (slash explícito)
- **Chamada de outra skill**: quando `Skill(skill="image-generate", ...)` aparece
  numa orquestração — execute exatamente o contrato abaixo, sem perguntar.

---

## Argumentos

Formato `key=value`. Pelo menos UM de `prompt`/`prompt-file`/`brief`/`scrape-file`
é obrigatório. `aspect` sempre obrigatório.

| Argumento | Obrigatório | Default | Descrição |
|---|---|---|---|
| `prompt` | * | — | Prompt inline (string, sem aspas internas conflitantes) |
| `prompt-file` | * | — | Path pra arquivo `.txt` com o prompt |
| `brief` | * | — | Brief curto em pt-BR/en-US — vai pro subagent `image-prompt-generator` virar prompt profissional |
| `scrape-file` | * | — | Path pra `scrape.json` (output do `scrape-extractor`) — vai pro subagent gerar prompt baseado em landing |
| `aspect` | sim | — | `1:1` \| `9:16` \| `1.91:1` \| `16:9` (1.91:1 e 16:9 mapeiam pra mesmo size) |
| `refs` | não | — | Paths separados por vírgula. Até 16 imagens (limite da API). Validados via `validate-image-ref.sh` antes de ir pra API. Se omitido ou todas inválidas, gera sem referência via `/v1/images/generations`. |
| `variants` | não | `1` | Quantas imagens gerar com o MESMO prompt (1-4 razoável) |
| `out-dir` | não | `/tmp/img-gen-<unix_ts>` | Diretório onde os PNGs e o `manifest.json` ficam |
| `out-name` | não | `image` | Base do nome do arquivo: `<base>-<n>.png` |

(*) Exatamente um de `prompt`/`prompt-file`/`brief`/`scrape-file` deve vir.

### Mapeamento `aspect` → OpenAI `size`

gpt-image-2 aceita 3 sizes; mapeie semântico → técnico:

| `aspect` | OpenAI `size` | Uso típico |
|---|---|---|
| `1:1` | `1024x1024` | Feed, post quadrado |
| `9:16` | `1024x1536` | Story, Reels |
| `1.91:1` ou `16:9` | `1536x1024` | Banner, link ad, desktop |

Qualquer outro `aspect` → falhar com `unsupported_aspect:<value>`.

---

## Pre-flight (passo 0)

Em UMA chamada Bash:

```bash
set -a && eval "$(tr -d '\r' < /mnt/c/agents_team_meta_ads_v2/.env.local)" && set +a
test -n "${OPENAI_API_KEY:-}" || { echo "MISSING_ENV: OPENAI_API_KEY"; exit 1; }
echo "Pre-flight OK"
```

> **Memória do cliente (relevante)**: a OpenAI exige org-verification pra
> habilitar `gpt-image-2`. Se a primeira chamada retornar
> `403 organization must be verified`, **não tente retry** — o gate é
> manual no console da OpenAI. Pare e avise: "OpenAI org-verification
> pendente — cliente precisa verificar a org no painel da OpenAI antes
> de gerar imagens."

Se a flag `WORKFLOW_LLM_BUDGET_USD_CAP` estiver setada e o
caller passou `cost-budget=<usd>` explícito, valide antes de prosseguir
(caller é responsável por trackar custo acumulado entre calls — esta
skill apenas reporta o custo da call atual).

---

## Resolução do prompt (passo 1)

Exatamente um caminho:

### 1.a — `prompt=<inline>`
Use direto. Salve em `<out-dir>/prompt.txt` pra auditoria.

### 1.b — `prompt-file=<path>`
`Read` o arquivo. Se vazio, falhar com `empty_prompt_file`. Copie pra
`<out-dir>/prompt.txt`.

### 1.c — `brief=<text>` ou `scrape-file=<path>`
Delegue ao subagent `image-prompt-generator`:

```
Agent(
  subagent_type="image-prompt-generator",
  description="Brief → prompt gpt-image-2",
  prompt='{
    "mode": "<brief|scrape>",
    "brief": "<TEXT>",                  // se mode=brief
    "scrape": <SCRAPE_JSON>,            // se mode=scrape
    "aspect": "<ASPECT>",
    "refs": ["<path1>", "<path2>"]      // mesmo set passado em refs=
  }'
)
```

O subagent retorna JSON com `{ prompt: "...", reasoning: "..." }`. Salve
o `prompt` em `<out-dir>/prompt.txt`. Se o subagent retornar erro, tente
**uma** retry com `general-purpose` propondo prompt curto baseado nos mesmos
inputs; se ainda falhar, aborte com `prompt_generation_failed`.

---

## Validação de refs (passo 2)

Pra cada path em `refs=`:

```bash
./.claude/skills/image-generate/scripts/validate-image-ref.sh "<PATH>"
```

- Retorno `OK <bytes> <mime>` → adicione à lista de refs efetivas.
- Retorno `SKIP <code> <detail>` → **descarte essa ref**, anote em
  `manifest.warnings`, e continue.

Se TODAS as refs falharem E o caller passou `require-refs=1`, aborte com
`all_refs_invalid`. Caso contrário, prossiga sem refs (o script roteará
automaticamente pra `/v1/images/generations`) e registre warning.

Não há mais fallback de mascote fixo — se não há refs válidas, gera
puramente por prompt. Se o caller quiser garantir uma ref de fallback,
deve passá-la explicitamente em `refs=`.

---

## Geração (passo 3)

Pra cada `i` em `1..variants`, chame o script com todas as refs válidas
expandidas como argumentos posicionais após OUTPUT_PATH:

```bash
./.claude/skills/image-generate/scripts/openai-image-gen.sh \
  "$(cat <out-dir>/prompt.txt)" \
  "<SIZE>" \
  "<out-dir>/<out-name>-<i>.png" \
  "${VALID_REFS[@]}"
```

O script decide internamente:
- **Com 1+ refs** → `/v1/images/edits` com `image[]=@<ref>` pra cada uma
- **Sem refs** → `/v1/images/generations` (text-only)

Todas as refs válidas são passadas. A API aceita até 16; o script descarta
o excedente com aviso se necessário.

Em falha numa variante: retry 1× com mesmo prompt. Se ainda falhar,
registre essa variante como `failed` no manifest mas continue gerando as
outras (best-effort).

---

## Manifest (passo 4)

Escreva `<out-dir>/manifest.json` no formato:

```json
{
  "ok": true,
  "model": "gpt-image-2",
  "aspect": "1:1",
  "size": "1024x1024",
  "prompt_source": "inline|file|brief|scrape",
  "prompt_path": "/tmp/img-gen-.../prompt.txt",
  "refs_requested": ["/path/logo.png", "/path/mascot.png"],
  "refs_used": ["/path/logo.png", "/path/mascot.png"],
  "refs_skipped": [
    { "path": "/path/bad.txt", "code": "reference_skipped_invalid_magic:text/plain" }
  ],
  "generation_mode": "edits",
  "images": [
    { "n": 1, "path": "/tmp/img-gen-.../image-1.png", "bytes": 1456789, "status": "succeeded" },
    { "n": 2, "path": "/tmp/img-gen-.../image-2.png", "bytes": 0, "status": "failed", "error": "..." }
  ],
  "cost_usd_estimate": 0.40,
  "duration_ms": 12345,
  "warnings": []
}
```

Novo campo `generation_mode`: `"edits"` se foram passadas refs, `"generations"` se text-only.

Imprima em **stdout** (e SOMENTE em stdout, na última linha do output):

```
MANIFEST: <absolute path to manifest.json>
```

Isso é o contrato com callers — eles parseiam essa linha pra achar o JSON.

> Se nenhuma imagem foi gerada com sucesso, `ok: false` e exit code não-zero
> do passo final. Caller decide se aborta ou não.

---

## Exemplos de uso

### Direto pelo operador — 2 refs (logo + foto do infoprodutor)
```
/image-generate prompt-file=/tmp/prompt-story.txt aspect=9:16 refs=/tmp/logo.png,/tmp/foto-produtor.jpg out-dir=/tmp/refresh
```

### Via outra skill (create-campaign Step 3, 1 placement por vez)
```
Skill(
  skill="image-generate",
  args="scrape-file=/tmp/scrape.json aspect=1:1 refs=/tmp/logo.png out-dir=/tmp/wf-<id>/feed out-name=feed"
)
```

### Sem refs — geração puramente por prompt
```
/image-generate brief="curso de IA pra desenvolvedores, vibe técnica e clean" aspect=1:1 variants=4
```

### Com 3 refs — logo + mascote + foto de produto
```
/image-generate prompt="Banner promocional do curso com logo, mascote e screenshot do produto" aspect=1.91:1 refs=/tmp/logo.png,/tmp/mascote.png,/tmp/screenshot.jpg out-dir=/tmp/banner
```

---

## Anti-padrões

- ❌ Aceitar prompt vazio ou de < 20 chars sem warning — gpt-image-2 retorna
  imagens genéricas que vão ser reprovadas pelo brand-guard.
- ❌ Pular `validate-image-ref.sh`. Já tivemos incidente: a Vision API mata a call
  inteira com `400 Could not process image` se um arquivo de ref for inválido.
- ❌ Tentar retry em `403 organization must be verified` — gate manual.
- ❌ Acumular cost na env var. Esta skill reporta custo POR call. Caller
  é dono do cap acumulado.
- ❌ Hardcodar `1024x1024` etc. no caller. O caller fala `aspect=1:1`;
  só esta skill conhece o mapeamento OpenAI.
- ❌ Passar mais de 16 refs — o script descarta o excedente, mas é desperdício.
  Curadoria das refs é responsabilidade do caller.

---

## Output contract (resumo pra callers)

Se você está chamando esta skill de outra orquestração:

1. Sempre passe `out-dir=` explícito (default usa `/tmp/img-gen-<ts>` que pode
   colidir em chamadas concorrentes).
2. Parseie a última linha de stdout: `MANIFEST: <path>`.
3. Leia `<path>` (JSON), use `images[].path` pra os assets gerados.
4. Use `generation_mode` pra saber se a call usou refs ou text-only.
5. Em falha (exit code != 0 OU `manifest.ok == false`), trate conforme sua
   política — esta skill **não decide** se aborta o workflow do caller.

---

## Tabelas que esta skill usa

Nenhuma direta. Persistência de geração de imagem (registro em
`generated_images`) é responsabilidade do caller (`/create-campaign`
chama `persist.sh image` após receber o manifest).