#!/usr/bin/env node
/*
 * send-email.cjs — transactional email via Resend for Ultron's autonomous mode (ADR 0019 /
 * SPEC-013, Fase 3). The watch-tick skill calls this in the `notifying` phase to tell the
 * operator the landing page is live.
 *
 * Usage:
 *   node send-email.cjs --subject <subject> --body-file <path> [--to <addr>] [--from <addr>]
 *
 * Output (stdout, single line):
 *   { "ok": true, "id": "<resend id>" }
 *   { "ok": false, "error": "<reason>" }      (also exits non-zero)
 *
 * Security / design:
 *   - RESEND_API_KEY comes from the env (Fly secret), never the code/args.
 *   - The recipient and sender default to fixed, trusted values (env-overridable) and are NEVER
 *     derived from page content — this removes any spam/redirection surface from a poisoned watch.
 *     A passed --to must still pass a basic email shape check.
 *   - The body is read from a FILE (not a shell arg) so the skill can write a multi-line message
 *     without quoting hazards; only the URL/summary go in it (no PII).
 */

"use strict";

const fs = require("fs");

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TO = "bruno@b2tech.io";
const DEFAULT_FROM = "Ultron <ultron@b2tech.io>";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Extract a bare address from "Name <addr@x>" or "addr@x" for validation.
const ADDR_RE = /<([^>]+)>\s*$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--subject") out.subject = argv[++i];
    else if (a === "--body-file") out.bodyFile = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--from") out.from = argv[++i];
  }
  return out;
}

function fail(reason) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(reason) }) + "\n");
  process.exit(1);
}

function bareAddress(value) {
  const m = ADDR_RE.exec(value || "");
  return (m ? m[1] : value || "").trim();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) fail("missing_resend_key");

  const subject = (args.subject || "").trim();
  if (!subject) fail("missing_subject");

  if (!args.bodyFile) fail("missing_body_file");
  let body;
  try {
    body = fs.readFileSync(args.bodyFile, "utf8");
  } catch {
    fail("body_file_unreadable");
  }
  if (!body.trim()) fail("empty_body");

  const to = (args.to || process.env.AUTONOMOUS_NOTIFY_EMAIL || DEFAULT_TO).trim();
  if (!EMAIL_RE.test(bareAddress(to))) fail("invalid_to");

  const from = (args.from || process.env.AUTONOMOUS_FROM_EMAIL || DEFAULT_FROM).trim();
  if (!EMAIL_RE.test(bareAddress(from))) fail("invalid_from");

  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(
    body,
  ).replace(/\n/g, "<br>")}</div>`;

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text: body, html }),
    });
  } catch (err) {
    fail(`request_failed ${err && err.message ? err.message : err}`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    fail(`resend_${res.status} ${errBody.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => ({}));
  process.stdout.write(JSON.stringify({ ok: true, id: data.id || null }) + "\n");
}

main().catch((err) => fail(err && err.message ? err.message : err));
