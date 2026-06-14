# 0025 — Funnel analytics via mcp-meta-ads-b2tech connector

- Status: accepted
- Date: 2026-06-14
- Supersedes (operationally): the data layer of ADR 0024 (daily all-campaigns analysis)
- Related: ADR 0004 (performance-analysis schema), ADR 0024 (daily cadence), SPEC `docs/specs/meta-ads-funnel-analytics.md`

## Context

The daily performance analysis (`analytic-traffic-brunobracaioli-campaign`, ADR 0024)
reads metrics through the official Meta MCP. That connector has real friction for
funnel analysis:

- It does **not** expose a generic `actions` field; conversions (LPV, purchases,
  checkouts) had to be scraped from `results.all_conversion_types` strings and only
  at the **campaign** level.
- Values come **localized** (`"R$16,12 BRL"`, `"4,84%"`) and need fragile parsing.
- Mid-funnel events (`view_content`, `add_to_cart`, `initiate_checkout`) and revenue
  (`action_values`, `purchase_roas`) were effectively unavailable.

A new self-hosted connector, **`mcp-meta-ads-b2tech`** (built by the operator), wraps
the Graph Insights API and returns the **full conversion funnel** with clean numeric
values: `actions[]`, `action_values[]`, `purchase_roas[]`, `cost_per_action_type[]` —
including `view_content`, `add_to_cart`, `initiate_checkout`, `purchase`.

We want this richer data both for sharper diagnostics and to power a **visual event
funnel in the web dashboard**.

## Decision

1. Introduce a new skill **`funnel-analytics-brunobracaioli-campaign`** that replaces
   `analytic-traffic-brunobracaioli-campaign` as the daily analysis. It reads via the
   `mcp-meta-ads-b2tech` connector (read-only), extracts the full funnel per entity,
   keeps the relational diagnostic engine (never a single isolated metric), and
   persists everything to Supabase.
2. Add a normalized read model **`public.funnel_events`** (migration
   `20260614000001_add_funnel_events.sql`): one row per `(analysis, entity, funnel
   step)` with `count`, `value_cents`, `cost_per_event_cents`, `cvr_from_prev`,
   `cvr_from_top`. This is the table the frontend funnel chart queries directly.
3. Keep `analyses` / `metric_snapshots` / `analysis_findings` unchanged
   (backward-compatible). `metric_snapshots.raw.funnel` also carries the funnel map for
   convenience; `funnel_events` is the canonical, queryable source for the UI.
4. The old skill is **deprecated, not deleted** (kept for rollback). The daily Fly cron
   and the Ultron `request_analysis` allowlist (`web/lib/ultron/tools.ts`) are
   repointed to the new skill.

### Canonical funnel (step_order)

`impression(1) → link_click(2) → landing_page_view(3) → view_content(4) →
add_to_cart(5) → initiate_checkout(6) → purchase(7)`.

Action-type mapping prefers the plain pixel event, falling back to omni/offsite/onsite
variants (see the skill, §3). Money is stored as integer **cents** (BRL).

## Consequences

- **Positive**: full-funnel data, revenue + ROAS, per-step cost — no localized parsing;
  a clean read model for the dashboard funnel; diagnostics can now reason about *where*
  in the funnel the money leaks (e.g. the IC→Purchase drop).
- **Negative / risks**:
  - Two Meta connectors now exist. The new skill standardizes on b2tech; the official
    MCP remains only for benchmark/auction context tools (optional, "no data" tolerant).
  - `get_insights` at `object_id=account, level=campaign` **blows past the token limit**
    (~all 89 historical campaigns). Mitigation: enumerate **active** campaigns via
    `list_campaigns` and request insights per campaign id — small payloads. Documented
    as a hard gotcha in the skill.
  - Cron/tools.ts repoint requires a **Fly image rebake + Vercel deploy** to take
    effect; until then the old skill keeps running (safe).
- **Token health**: the b2tech connector depends on a Meta token stored in Supabase
  (`meta_token_status` → `source:"supabase"`); if it expires, `meta_refresh_token` /
  `meta_login` are the recovery path (the skill records the limitation, never blocks).
