"use client";

import { useRef, useState } from "react";

// A generic, recursive editor over a section's `fields` JSON. Rather than hand-coding a
// form for each of the 17 section shapes, it introspects the value: strings → text inputs,
// numbers → number inputs, booleans → checkboxes, string arrays → editable lists, object
// arrays → repeatable cards, nested objects → nested groups. Wave 6 can layer per-type Zod
// labels on top; this keeps the editor complete and maintainable for v1.

/** Section types → the `fields` keys that hold an image URL (mirrors content-types.ts).
 * Used so the editor always shows an upload slot for these, even when the key is absent. */
export const SECTION_IMAGE_KEYS: Record<string, string[]> = {
  hero: ["image"],
  problem: ["image"],
  solution: ["image"],
  features: ["image"],
  proof: ["image"],
  authority: ["image"],
};

/** Heuristic for image fields nested inside arrays/objects (e.g. an item with an `image`). */
function isImageKey(key: string): boolean {
  return /^(image|photo|picture|ogimage|avatar)/i.test(key);
}

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

export function ImageField({
  label,
  value,
  landingPageId,
  onChange,
}: {
  label: string;
  value: string;
  landingPageId: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/landing-pages/${landingPageId}/assets`, { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) throw new Error(json?.error ?? `HTTP ${res.status}`);
      onChange(json.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className={LABEL}>{label}</span>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="max-h-32 w-full rounded border border-white/10 object-cover" />
      ) : (
        <div className="grid h-20 place-items-center rounded border border-dashed border-white/10 text-xs text-white/30">
          sem imagem
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <button type="button" className={BTN} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "enviando…" : value ? "substituir" : "enviar imagem"}
        </button>
        {value ? (
          <button type="button" className={BTN} onClick={() => onChange("")}>
            remover
          </button>
        ) : null}
      </div>
      <input
        className={INPUT}
        value={value}
        placeholder="ou cole uma URL de imagem"
        onChange={(e) => onChange(e.target.value)}
      />
      {err ? <p className="text-xs text-rose-300/80">Falha no upload: {err}</p> : null}
    </div>
  );
}

function ArrayEditor({
  label,
  value,
  landingPageId,
  onChange,
}: {
  label: string;
  value: unknown[];
  landingPageId?: string | undefined;
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
            <FieldNode label="" value={item} landingPageId={landingPageId} onChange={(nv) => setAt(i, nv)} />
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
  fieldKey,
  landingPageId,
  onChange,
}: {
  label: string;
  value: unknown;
  fieldKey?: string | undefined;
  landingPageId?: string | undefined;
  onChange: (v: unknown) => void;
}) {
  if (typeof value === "string") {
    if (landingPageId && fieldKey && isImageKey(fieldKey)) {
      return <ImageField label={label} value={value} landingPageId={landingPageId} onChange={onChange} />;
    }
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
    return <ArrayEditor label={label} value={value} landingPageId={landingPageId} onChange={(v) => onChange(v)} />;
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
              fieldKey={k}
              landingPageId={landingPageId}
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

/** Top-level editor for a section's fields object. `imageKeys` are rendered as dedicated
 * upload slots (always shown, even when absent from `value`, so the operator can ADD an image
 * to a section that has none yet); the rest go through the recursive FieldNode. */
export function FieldEditor({
  value,
  landingPageId,
  imageKeys = [],
  onChange,
}: {
  value: Record<string, unknown>;
  landingPageId: string;
  imageKeys?: string[];
  onChange: (v: Record<string, unknown>) => void;
}) {
  const imgSet = new Set(imageKeys);
  const entries = Object.entries(value).filter(([k]) => !imgSet.has(k));
  const setKey = (k: string, v: string) => {
    const next = { ...value };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {imageKeys.map((k) => (
        <ImageField
          key={k}
          label={humanize(k)}
          value={typeof value[k] === "string" ? (value[k] as string) : ""}
          landingPageId={landingPageId}
          onChange={(v) => setKey(k, v)}
        />
      ))}
      {entries.map(([k, v]) => (
        <FieldNode
          key={k}
          label={humanize(k)}
          value={v}
          fieldKey={k}
          landingPageId={landingPageId}
          onChange={(nv) => onChange({ ...value, [k]: nv })}
        />
      ))}
      {entries.length === 0 && imageKeys.length === 0 && (
        <p className="text-xs text-white/30">Esta seção ainda não tem conteúdo.</p>
      )}
    </div>
  );
}
