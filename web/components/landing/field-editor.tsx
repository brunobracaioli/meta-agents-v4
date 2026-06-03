"use client";

// A generic, recursive editor over a section's `fields` JSON. Rather than hand-coding a
// form for each of the 17 section shapes, it introspects the value: strings → text inputs,
// numbers → number inputs, booleans → checkboxes, string arrays → editable lists, object
// arrays → repeatable cards, nested objects → nested groups. Wave 6 can layer per-type Zod
// labels on top; this keeps the editor complete and maintainable for v1.

const INPUT =
  "w-full rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-white/90 outline-none transition focus:border-cyan-200/40";
const LABEL = "block font-mono text-[10px] uppercase tracking-[0.14em] text-white/40";
const BTN =
  "rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/60 transition hover:border-cyan-200/30 hover:text-white";

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** A blank value with the same shape as `sample` — used when adding an array item. */
function emptyLike(sample: unknown): unknown {
  if (typeof sample === "string") return "";
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sample)) out[k] = emptyLike(v);
    return out;
  }
  return "";
}

function StringField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const multiline = value.length > 80 || value.includes("\n");
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {multiline ? (
        <textarea
          className={`${INPUT} min-h-[72px] resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function ArrayEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const template = value.length > 0 ? value[0] : "";
  const add = () => onChange([...value, emptyLike(template)]);
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const setAt = (i: number, nv: unknown) => onChange(value.map((item, idx) => (idx === i ? nv : item)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <button type="button" className={BTN} onClick={add}>
          + adicionar
        </button>
      </div>
      <div className="space-y-2">
        {value.map((item, i) => (
          <div key={i} className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] text-white/30">#{i + 1}</span>
              <button type="button" className={BTN} onClick={() => removeAt(i)}>
                remover
              </button>
            </div>
            <FieldNode label="" value={item} onChange={(nv) => setAt(i, nv)} />
          </div>
        ))}
        {value.length === 0 && <p className="text-xs text-white/30">Lista vazia.</p>}
      </div>
    </div>
  );
}

export function FieldNode({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (typeof value === "string") {
    return <StringField label={label} value={value} onChange={onChange} />;
  }
  if (typeof value === "number") {
    return (
      <label className="block space-y-1">
        <span className={LABEL}>{label}</span>
        <input
          type="number"
          className={INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      </label>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="flex items-center gap-2 py-1">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className={LABEL}>{label}</span>
      </label>
    );
  }
  if (Array.isArray(value)) {
    return <ArrayEditor label={label} value={value} onChange={(v) => onChange(v)} />;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      <div className="space-y-2">
        {label && <span className={LABEL}>{label}</span>}
        <div className="space-y-3 border-l border-white/8 pl-3">
          {Object.entries(obj).map(([k, v]) => (
            <FieldNode
              key={k}
              label={humanize(k)}
              value={v}
              onChange={(nv) => onChange({ ...obj, [k]: nv })}
            />
          ))}
        </div>
      </div>
    );
  }
  // null/undefined → editable as text (becomes a string on edit).
  return <StringField label={label} value="" onChange={onChange} />;
}

/** Top-level editor for a section's fields object. */
export function FieldEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(value).map(([k, v]) => (
        <FieldNode key={k} label={humanize(k)} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} />
      ))}
      {Object.keys(value).length === 0 && (
        <p className="text-xs text-white/30">Esta seção ainda não tem conteúdo.</p>
      )}
    </div>
  );
}
