#!/usr/bin/env node
/*
 * screenshot-page.cjs — server-side landing-page review screenshots for Ultron's autonomous
 * mode (ADR 0019 / SPEC-013, Fase 2).
 *
 * Opens a DEPLOYED landing page with headless Chromium, captures the page in N viewport-sized
 * scroll steps (so the watch-tick skill can opine section by section), uploads each JPEG to the
 * PRIVATE `ultron-review` Storage bucket, and prints a one-line JSON manifest to stdout.
 *
 * Usage:
 *   node screenshot-page.cjs --url <https url> --watch <uuid> [--steps N]
 *
 * Output (stdout, single line):
 *   { "ok": true, "shots": [{ "storage_path": "<watch>/0-000.jpg", "scroll_pct": 0 }, ...], "count": N }
 *   { "ok": false, "error": "<reason>" }     (also exits non-zero)
 *
 * Security:
 *   - SSRF guard: only https URLs whose host ends with `.b2tech.io` (the Cloudflare Pages domain
 *     for client landing pages) are allowed. No arbitrary navigation.
 *   - Runs headless with --no-sandbox (unprivileged container user) + --disable-dev-shm-usage.
 *   - Reads SUPABASE_URL / SUPABASE_SECRET_KEY from the env (service key bypasses RLS on the
 *     private bucket; same access model as the runner's other Storage writes).
 *
 * Module resolution: `playwright` is installed globally in the image; NODE_PATH points at the
 * global modules dir, which CommonJS `require` honors (this file is .cjs on purpose — ESM bare
 * specifiers do NOT consult NODE_PATH).
 */

"use strict";

const ALLOWED_HOST_SUFFIX = ".b2tech.io";
const BUCKET = "ultron-review";
const VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_STEPS = 4;
const MAX_STEPS = 6;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1200; // after load: let fonts/hero animations settle
const SCROLL_SETTLE_MS = 500; // after each scroll: let lazy content paint
const JPEG_QUALITY = 72;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
    else if (a === "--watch") out.watch = argv[++i];
    else if (a === "--steps") out.steps = argv[++i];
  }
  return out;
}

function fail(reason) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(reason) }) + "\n");
  process.exit(1);
}

function assertAllowedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail("invalid_url");
  }
  if (u.protocol !== "https:") fail("url_not_https");
  const host = u.hostname.toLowerCase();
  // Must be a subdomain of b2tech.io (e.g. promo.b2tech.io) — never the bare apex, never anything
  // else. Defends against SSRF to internal/arbitrary hosts.
  if (!host.endsWith(ALLOWED_HOST_SUFFIX) || host === ALLOWED_HOST_SUFFIX.slice(1)) {
    fail("url_host_not_allowed");
  }
  return u.toString();
}

function env(name, ...fallbacks) {
  for (const key of [name, ...fallbacks]) {
    const v = (process.env[key] || "").trim();
    if (v) return v;
  }
  return "";
}

async function ensureBucket(base, key) {
  // Idempotent: create the private bucket if it does not exist yet. Mirrors the best-effort
  // createBucket pattern used by the web asset upload. A 4xx (already exists) is fine.
  try {
    await fetch(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
  } catch {
    // Non-fatal: the upload below will surface a real error if the bucket truly is unusable.
  }
}

async function uploadObject(base, key, storagePath, buf) {
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upload_failed ${res.status} ${body.slice(0, 200)}`);
  }
}

function scrollOffsets(scrollHeight, viewportH, steps) {
  const span = scrollHeight - viewportH;
  if (span <= 0) return [0];
  const n = Math.min(steps, Math.max(1, Math.ceil(scrollHeight / viewportH)));
  if (n === 1) return [0];
  const offsets = [];
  for (let i = 0; i < n; i += 1) {
    offsets.push(Math.round((span * i) / (n - 1)));
  }
  return offsets;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = assertAllowedUrl(args.url || "");
  const watch = String(args.watch || "");
  if (!UUID_RE.test(watch)) fail("invalid_watch_id");

  let steps = Number.parseInt(args.steps || "", 10);
  if (!Number.isFinite(steps) || steps < 1) steps = DEFAULT_STEPS;
  steps = Math.min(steps, MAX_STEPS);

  const base = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) fail("missing_supabase_env");

  const { chromium } = require("playwright");

  await ensureBucket(base, key);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    } catch {
      // networkidle can time out on pages with long-polling/analytics; fall back to load.
      await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    }
    await page.waitForTimeout(SETTLE_MS);

    const scrollHeight = await page.evaluate(
      () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    );
    const offsets = scrollOffsets(scrollHeight, VIEWPORT.height, steps);
    const span = Math.max(1, scrollHeight - VIEWPORT.height);

    const shots = [];
    for (let i = 0; i < offsets.length; i += 1) {
      const y = offsets[i];
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(SCROLL_SETTLE_MS);
      const pct = Math.max(0, Math.min(100, Math.round((y / span) * 100)));
      const buf = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY });
      const storagePath = `${watch}/${i}-${String(pct).padStart(3, "0")}.jpg`;
      await uploadObject(base, key, storagePath, buf);
      shots.push({ storage_path: storagePath, scroll_pct: pct });
    }

    process.stdout.write(JSON.stringify({ ok: true, shots, count: shots.length }) + "\n");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((err) => fail(err && err.message ? err.message : err));
