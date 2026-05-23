---
name: edicao-de-campanha-nome-do-cliente
description: Edita campanhas/adsets/ads do cliente nome do cliente (orçamento, status, targeting, creative). Headless-safe — opera via Meta Ads MCP sem perguntas, dentro dos limites duros do cliente.
allowed-tools: Read, Glob, Grep, Bash, Write
---

# Skill: editar campanhas — nome do cliente

## CONTRATO HEADLESS

- **NUNCA** chame `AskUserQuestion`. Receba o pedido de edição via prompt e execute.
- **NUNCA** exceda os limites duros (ver "Limites").
- **NUNCA** ative entidade sem que o pedido seja explícito (`"ativar"`, `"activate"`, `"resume"`, `"ON"`).
- **SEMPRE** escreva o manifest do passo final, mesmo em falha parcial.

## Cliente

| Campo | Valor |
|---|---|
| Business Manager | `772813643612039` (Nome empresa) |
| Ad Account | `225179730538661` |
| Facebook Page | `867347659802006` |
| Landing default | `https://claude-code.cliente-site.io` |
| Materiais | `.claude/materiais-das-empresas/<nome-cliente>/` |

## Limites duros (validação ANTES de chamar MCP)

| Regra | Valor |
|---|---|
| Aumento de orçamento por edição | Máximo +30% do valor atual |
| Cap absoluto de daily budget | R$ 50,00 (`5000` centavos) por campanha |
| Frequência mínima entre edições da mesma campanha | 24h (Meta penaliza otimização com mudanças frequentes) |

Exemplo: campanha atual em R$ 30/dia → aumento permitido até R$ 39/dia. Campanha em R$ 45/dia → aumento permitido até R$ 50/dia (cap, não R$ 58,50). Campanha em R$ 50/dia → não pode aumentar.

Se o pedido violar o limite, **não chame o MCP**. Escreva o manifest com `"rejected": true` e `"reason": "..."` e termine. Não tente "negociar" — apenas reporta.

## Operações suportadas

| Operação | Tool MCP |
|---|---|
| Ler estado atual | `ads_get_ad_entities` |
| Alterar orçamento, nome, targeting | `ads_update_entity` |
| Ativar (status PAUSED → ACTIVE) | `ads_activate_entity` |
| Pausar (ACTIVE → PAUSED) | `ads_update_entity` com `status=PAUSED` |
| Adicionar criativo novo a adset existente | `ads_create_ad` (não `update`) |

## Fluxo

### 1. Parse do pedido
Identifique:
- `target`: campaign | adset | ad
- `id`: ID Meta (15-20 dígitos)
- `change`: o que alterar (budget, status, name, targeting, etc.)
- `value`: novo valor

Se o usuário passou apenas o nome (não o ID), use `ads_get_ad_entities` com filtro `name CONTAINS` pra resolver.

### 2. Estado atual
`ads_get_ad_entities` no `target` específico — capture os campos relevantes (`daily_budget`, `status`, `name`, `targeting`).

### 3. Validação dos limites
Aplique as regras de "Limites duros". Se violar, pule pro passo 6 com `rejected: true`.

### 4. Histórico recente
Leia `tentativas-geracao-de-campanhas/*.json` ordenado por data. Se a entidade foi editada nas últimas 24h, recuse (a menos que o pedido seja explicitamente urgente — `"force": true`, `"urgente"`, `"emergência"`).

### 5. Execução
Chame `ads_update_entity` ou `ads_activate_entity` com os campos calculados. Se for múltiplas mudanças, agrupe em uma única chamada quando possível.

### 6. Verificação
Leia de novo via `ads_get_ad_entities` e confirme que o estado pós-edição bate com o esperado.

### 7. Manifest

Escreva em `tentativas-geracao-de-campanhas/YYYYMMDD-HHMM-edicao.json`:

```json
{
  "skill": "edicao-de-campanha-nome-do-cliente",
  "client": "<nome-cliente>",
  "editedAt": "2026-05-19T19:30:00-03:00",
  "target": { "level": "campaign", "id": "120245...", "name": "..." },
  "change": { "field": "daily_budget", "from": 3000, "to": 3900 },
  "rejected": false,
  "reason": null,
  "verified": true,
  "errors": []
}
```

Em falha/rejeição: `rejected: true`, `reason: "Aumento de 50% excede cap de 30%"`, sem chamada ao MCP.

### 8. Output
Tabela markdown enxuta com `target → change → resultado`. Sem perguntas.

## NUNCA

- ❌ Editar campanha de outro cliente que não `225179730538661`
- ❌ Aumentar orçamento mais que 30% ou acima de R$ 50/dia
- ❌ Ativar entidade sem pedido explícito
- ❌ Editar a mesma entidade duas vezes em 24h (sem flag `force`)
- ❌ Chamar `AskUserQuestion`
- ❌ Continuar sem escrever o manifest
