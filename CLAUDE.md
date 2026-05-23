# Project: agents_team_meta_ads_v3


**Missão**: Criamos uma agência de tráfego para Meta Ads (Facebook Ads) 100% feita por IAs que opera 24/7.

**Importante**: A autentificação do usuário na Meta já foi feita no momento da vinculação do MCP da Meta. Sempre use apenas o MCP da Meta para criar campanhas. Caso tenha dúvidas sobre como fazer, verifique se o próprio MCP tem instruções de como prosseguir.

## Workflow

**Instruções gerais**:
- em ".claude\materiais-das-empresas" você encontrará informações adicionais sobre as empresas como "logo"(.claude\materiais-das-empresas\<nome-cliente>\logo\logo.png), imagem do infoprodutor (.claude\materiais-das-empresas\<nome-cliente>\logo\foto-do-infoprodutor\nome-do-cliente.jpg) e exemplos de anúncios que o infoprodutor já usou antes (.claude\materiais-das-empresas\<nome-cliente>\exemplo-de-ads\meta-ads-agents.png).
- em ".claude\skills\lista-de-clientes\SKILL.md" você encontrará informações sobre os clientes como número da BM, conta de anúncios, URL, regras de orçamento etc.

## Stack

- **Backend**: TypeScript 5.6 + Node 22 + Next.js 15 (App Router) + Hono em route handlers
- **Frontend**: Next.js 15 + React 19 + Tailwind 4 + shadcn/ui
- **DB**: Supabase Postgres 16 + Drizzle ORM 0.36
- **Auth**: Supabase Auth (magic-link)
- **Storage**: Supabase Storage (bucket privado `creatives`)
- **Cache**: Upstash Redis (free tier)
- **Queue / scheduler dinâmico**: Upstash QStash
- **Cron declarativo**: Vercel Cron (em `vercel.json`)
- **AI**: Anthropic SDK — `claude-opus-4-7` (decisão), `claude-sonnet` (tarefas simples), prompt cache obrigatório
- **MCP**: `meta-ads-mcp` como connector da Anthropic API (decision-engine LLM, Onda 3+)
- **IaC**: Supabase CLI (migrations) + `vercel.json`
- **CI/CD**: GitHub Actions (lint+test+typecheck) → Vercel deploy automático
- **Cloud**: Vercel (Edge + Serverless, region `gru1`) + Supabase (region `sa-east-1`) + **Fly.io machine** (region `gru`, Onda 2 cron host — ADR 0012)

**Banco de Dados**: as informações de cada campanha, conjuntos, anúncios, creativos, o que foi criado, edições etc. devem ser salvos no banco de dados do Supabase (sempre via integração do MCP).



