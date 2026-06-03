// serialize-cli — the headless entry point that turns a ContentDoc (the Supabase draft)
// into the exact files the static-export build consumes. It is the publish skill's bridge:
// the Fly runner reads the ContentDoc from Supabase (REST), writes it to a temp JSON file,
// and runs this CLI to emit messages/pt.json + content-spec.json + theme.css into the LP
// directory — then `next build` proceeds unchanged. See SPEC-012 §3 / ADR 0017.
//
// Run with tsx so the extensionless TypeScript imports in ./src/* resolve without a build
// step (Node's bare type-stripping does NOT resolve extensionless relative .ts imports):
//
//   node --import tsx packages/lp-render/serialize-cli.ts <contentDocJson> <outDir>
//
// It is a thin, deterministic wrapper around the pure contentDocToFiles() — no network,
// no Date.now(), no LLM in the loop — so a publish is reproducible from the draft alone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentDocToFiles } from "./src/serialize";
import type { ContentDoc } from "./src/content-doc";

function fail(message: string): never {
  process.stderr.write(`serialize-cli: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { docPath: string; outDir: string } {
  const [docPath, outDir] = argv;
  if (!docPath || !outDir) {
    fail("usage: serialize-cli.ts <contentDocJsonPath> <outDir>");
  }
  return { docPath, outDir };
}

function readDoc(docPath: string): ContentDoc {
  let raw: string;
  try {
    raw = readFileSync(docPath, "utf8");
  } catch (err) {
    return fail(`cannot read ContentDoc at ${docPath}: ${(err as Error).message}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return fail(`ContentDoc at ${docPath} is not valid JSON: ${(err as Error).message}`);
  }
  // Minimal structural guard — the serializer trusts the shape, so reject early with a
  // clear message instead of producing a half-broken build artifact.
  const d = doc as Partial<ContentDoc>;
  if (!d || typeof d !== "object") fail("ContentDoc must be a JSON object");
  if (!d.settings || typeof d.settings !== "object") fail("ContentDoc.settings is required");
  if (!Array.isArray(d.sections)) fail("ContentDoc.sections must be an array");
  if (!d.theme || typeof d.theme !== "object") fail("ContentDoc.theme is required (use {} for none)");
  return d as ContentDoc;
}

function writeFileEnsured(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function main(): void {
  const { docPath, outDir } = parseArgs(process.argv.slice(2));
  const doc = readDoc(docPath);
  const { messages, contentSpec, themeCss } = contentDocToFiles(doc);

  const messagesPath = join(outDir, "messages", "pt.json");
  const specPath = join(outDir, "content-spec.json");
  const themePath = join(outDir, "app", "theme.css");

  writeFileEnsured(messagesPath, `${JSON.stringify(messages, null, 2)}\n`);
  writeFileEnsured(specPath, `${JSON.stringify(contentSpec, null, 2)}\n`);
  // theme.css always written (empty when the theme has no overrides) so the cloned
  // layout can import it unconditionally. The :root block, if any, overrides the
  // package globals.css tokens for this LP only.
  writeFileEnsured(themePath, themeCss);

  process.stdout.write(
    `serialize-cli: wrote ${contentSpec.sections.length} sections → ${messagesPath}, ${specPath}` +
      `${themeCss ? `, ${themePath} (themed)` : `, ${themePath} (empty)`}\n`,
  );
}

main();
