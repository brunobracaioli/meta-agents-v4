-- D1 (SQLite na borda). Banco de eventos do tagging server multi-tenant.
--   wrangler d1 execute lp-tracking --file=./schema.sql --remote
--
-- LEI: SEM PII crua. Só atribuição, flags de match e saúde do envio. PII pessoal (e-mail/
-- telefone) é hasheada no Worker e mandada à Meta; nunca persiste. `lp_id` é o tenant.

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT    NOT NULL,           -- mesmo do Pixel (dedup)
  lp_id        TEXT    NOT NULL,           -- tenant (landing_pages.id)
  event_name   TEXT    NOT NULL,
  event_time   INTEGER NOT NULL,           -- unix seconds
  source_url   TEXT,

  -- atribuição
  fbp          TEXT,
  fbc          TEXT,
  gclid        TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,

  -- borda
  ip           TEXT,
  country      TEXT,
  user_agent   TEXT,

  -- valor
  value        REAL,
  currency     TEXT,

  -- saúde do envio (status representativo por destino; 0 = skip)
  meta_status  INTEGER,
  ga_status    INTEGER,
  ads_status   INTEGER,
  pixels_count INTEGER NOT NULL DEFAULT 0,

  -- flags de matching (proxy de EMQ, sem expor PII)
  has_email    INTEGER NOT NULL DEFAULT 0,
  has_phone    INTEGER NOT NULL DEFAULT 0,

  created_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_eventid ON events(event_id);
CREATE INDEX IF NOT EXISTS idx_events_lp_time ON events(lp_id, event_time);
CREATE INDEX IF NOT EXISTS idx_events_name    ON events(event_name);
