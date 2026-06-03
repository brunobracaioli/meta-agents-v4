// Safe, voice-driven scalar edits for landing-page section `fields`. The Ultron edit tool
// targets a single existing leaf by dotted path (e.g. "headline", "items.0.title") and sets
// a new SCALAR value. This deliberately cannot create new keys, change structure, or set
// objects/arrays — those would be the dangerous degrees of freedom for a misheard command.
// Complex edits go through the dashboard editor (Wave 4). See SPEC-012 §6.

export type ScalarEditResult =
  | { ok: true; fields: Record<string, unknown>; applied: { from: unknown; to: unknown } }
  | { ok: false; error: string };

const TRUTHY = new Set(["true", "sim", "ativo", "ligado", "habilitado", "1"]);
const FALSY = new Set(["false", "não", "nao", "inativo", "desligado", "desabilitado", "0"]);

/** Apply a scalar edit at an EXISTING leaf path; returns a new fields object (no mutation). */
export function applyScalarEdit(
  fields: Record<string, unknown>,
  path: string,
  raw: string,
): ScalarEditResult {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "caminho do campo vazio" };

  const clone = structuredClone(fields) as Record<string, unknown>;

  // Walk to the leaf's container.
  let container: unknown = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (Array.isArray(container)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= container.length)
        return { ok: false, error: `índice '${key}' fora do alcance` };
      container = container[idx];
    } else if (container && typeof container === "object") {
      if (!(key in (container as Record<string, unknown>)))
        return { ok: false, error: `campo '${key}' não existe nessa seção` };
      container = (container as Record<string, unknown>)[key];
    } else {
      return { ok: false, error: `não é possível navegar em '${key}'` };
    }
  }

  const leaf = parts[parts.length - 1]!;
  let current: unknown;
  if (Array.isArray(container)) {
    const idx = Number(leaf);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length)
      return { ok: false, error: `índice '${leaf}' fora do alcance` };
    current = container[idx];
  } else if (container && typeof container === "object") {
    if (!(leaf in (container as Record<string, unknown>)))
      return { ok: false, error: `campo '${leaf}' não existe nessa seção` };
    current = (container as Record<string, unknown>)[leaf];
  } else {
    return { ok: false, error: "caminho de campo inválido" };
  }

  // Coerce the new value to the leaf's existing scalar type; reject non-scalar leaves.
  let next: unknown;
  if (typeof current === "string") {
    next = raw;
  } else if (typeof current === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: "esse campo é numérico; diga um número" };
    next = n;
  } else if (typeof current === "boolean") {
    const t = raw.trim().toLowerCase();
    if (TRUTHY.has(t)) next = true;
    else if (FALSY.has(t)) next = false;
    else return { ok: false, error: "esse campo é sim/não; diga sim ou não" };
  } else {
    return {
      ok: false,
      error: "esse campo é uma lista ou objeto e não é editável por voz; use o painel do editor",
    };
  }

  if (Array.isArray(container)) container[Number(leaf)] = next;
  else (container as Record<string, unknown>)[leaf] = next;

  return { ok: true, fields: clone, applied: { from: current, to: next } };
}
