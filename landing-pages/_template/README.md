# b2tech LP template (Next.js static export → Cloudflare Pages)

Canonical landing-page template. Cloned per LP by
`.claude/skills/create-landing-page-brunobracaioli` into `landing-pages/<nome>/`.
See [ADR 0012](../../docs/adr/0012-landing-pages-on-cloudflare-pages.md) and
[SPEC-011](../../docs/specs/SPEC-011-landing-page-generation.md).

## Edit points

- `content-spec.json` — machine spec: subdomain, product, price, checkout, cart_state,
  tracking ids, section order, SEO. **No copy here.**
- `messages/pt.json` — ALL copy (filled by the `lp-copywriter` subagent).
- `public/og.png`, `public/hero.png` — generated assets (gpt-image-2 via `image-generate`).

## Local commands

```bash
npm install                      # first run (or npm ci with a lockfile)
npm run type-check               # tsc --noEmit, no `any`
npm run dev                      # http://localhost:3000
NEXT_PUBLIC_NOINDEX=1 npm run build   # → out/ (flat: index.html, sitemap.xml, robots.txt)
npm run preview                  # serve out/ locally
```

## Deploy (Cloudflare Pages)

Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env.

```bash
npx wrangler pages project create b2tech-<nome> --production-branch=main
npx wrangler pages deploy out --project-name=b2tech-<nome> --branch=main
# domain bind (auto-creates proxied CNAME — same Cloudflare account as b2tech.io):
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/b2tech-<nome>/domains" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" \
  --data '{"name":"<nome>.b2tech.io"}'
```

## Constraints (output: 'export')

No API routes, server actions, middleware, or ISR. `images.unoptimized: true` is
mandatory. Tracking (FB Pixel + GA4) is injected **only after consent**
(`localStorage["b2tech_consent_v1"]`) — never hardcode pixels in `layout.tsx`.

## Go-live

The page is born `noindex` (preview). To publish, rebuild + redeploy with
`NEXT_PUBLIC_NOINDEX=0`. This is the single go-live switch.
