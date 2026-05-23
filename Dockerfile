# syntax=docker/dockerfile:1.7
#
# Fly.io Cron Runner — meta-agents-v3
# Hosts Claude Code CLI + supercronic for daily non-interactive campaign creation.
# See docs/specs/flyio-cron-campaign-runner.md
#
# Build: docker build -t meta-agents-v3:local .
# Deploy: fly deploy --remote-only

FROM node:22-bookworm-slim

ARG SUPERCRONIC_VERSION=0.2.30
ARG SUPERCRONIC_SHA1SUM=9f27ad28c5c57cd133325b2a66bba69ba2235799
ARG CLAUDE_CODE_VERSION=latest

ENV TZ=America/Sao_Paulo \
    DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash curl ca-certificates tini jq tzdata git \
 && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
 && echo "${TZ}" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

RUN useradd -m -u 1001 -s /bin/bash runner \
 && mkdir -p /app /var/log/runs /home/runner/.claude \
 && chown -R runner:runner /app /var/log/runs /home/runner/.claude

WORKDIR /app

COPY --chown=runner:runner .claude /app/.claude
COPY --chown=runner:runner docs /app/docs
COPY --chown=runner:runner CLAUDE.md /app/CLAUDE.md
COPY --chown=runner:runner scripts /app/scripts
COPY --chown=runner:runner crontab /app/crontab

RUN chmod +x /app/scripts/*.sh

USER runner

VOLUME ["/home/runner/.claude"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/scripts/entrypoint.sh"]
