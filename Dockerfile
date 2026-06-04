# syntax=docker/dockerfile:1.7
#
# Fly.io Cron Runner — meta-agents-v4
# Hosts Claude Code CLI + supercronic for daily non-interactive campaign creation.
# See docs/specs/flyio-cron-campaign-runner.md
#
# Build: docker build -t meta-agents-v4:local .
# Deploy: fly deploy --remote-only

FROM node:22-bookworm-slim

ARG SUPERCRONIC_VERSION=0.2.30
ARG SUPERCRONIC_SHA1SUM=9f27ad28c5c57cd133325b2a66bba69ba2235799
ARG CLAUDE_CODE_VERSION=latest
# Cloudflare Pages deploy CLI for the create-landing-page-* skill (ADR 0012). Pinned.
ARG WRANGLER_VERSION=4.97.0
# Playwright (Chromium) for server-side landing-page review screenshots (ADR 0019 Fase 2). Pinned.
ARG PLAYWRIGHT_VERSION=1.49.1

ENV TZ=America/Sao_Paulo \
    DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    # CommonJS require resolves globally-installed modules (playwright) from here.
    NODE_PATH=/usr/local/lib/node_modules \
    # Shared, world-readable browser cache so the unprivileged `runner` user can launch Chromium.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash curl ca-certificates tini jq tzdata git python3 \
 && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
 && echo "${TZ}" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "wrangler@${WRANGLER_VERSION}" \
 && npm cache clean --force

# Playwright + Chromium for the autonomous-mode visual review (ADR 0019 Fase 2). Installed as
# root so `--with-deps` can apt-get the system libraries; the browser lands in the shared
# PLAYWRIGHT_BROWSERS_PATH and is made world-readable so the `runner` user can launch it.
RUN apt-get update \
 && npm install -g "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps chromium \
 && chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}" \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 -s /bin/bash runner \
 && mkdir -p /app /var/log/runs /home/runner/.claude \
 && chown -R runner:runner /app /var/log/runs /home/runner/.claude

WORKDIR /app

COPY --chown=runner:runner .claude /app/.claude
COPY --chown=runner:runner docs /app/docs
COPY --chown=runner:runner CLAUDE.md /app/CLAUDE.md
COPY --chown=runner:runner .mcp.json /app/.mcp.json
COPY --chown=runner:runner scripts /app/scripts
COPY --chown=runner:runner crontab /app/crontab
# Shared landing-page render package — the template depends on it via a file: path
# (../../packages/lp-render), so it must be present before the prebake npm ci. See ADR 0017.
COPY --chown=runner:runner packages /app/packages
# Landing-page template + any committed generated LPs. node_modules/out/.next are
# excluded via .dockerignore; deps are pre-baked below so the skill skips install at run.
COPY --chown=runner:runner landing-pages /app/landing-pages

RUN chmod +x /app/scripts/*.sh

USER runner

# Pre-bake the template's node_modules (incl. devDeps — next build + tsc need them even
# under NODE_ENV=production) so the skill copies them per LP instead of running a slow,
# flaky `npm ci` inside the 1500s job timeout. See ADR 0012 / SPEC-011.
RUN cd /app/landing-pages/_template \
 && npm ci --include=dev \
 && npm cache clean --force

VOLUME ["/home/runner/.claude"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/scripts/entrypoint.sh"]
