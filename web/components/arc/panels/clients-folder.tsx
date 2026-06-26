"use client";

// SPEC-019 Wave B — the "folder shell" panel (clients element). Renders the 3-screen flow:
// (1) a root grid of 5 folders; (2) opening the ready "Clientes" folder collapses the row to a
// compact top strip and reveals the scrolling client list. Navigation runs through the pure
// `folderShellReducer` so it is driven identically by click (here) and by voice (the Ultron can
// re-emit show_clients / open_client). `data` arrives opaque (the transport schema is element-
// agnostic), so we narrow defensively and degrade to a notice rather than crash the stage.
import { useReducer } from "react";
import {
  FOLDERS,
  folderShellReducer,
  initialFolderLayer,
  type FolderId,
} from "@/lib/ultron/arc-folders";

type ClientRow = { slug: string; name: string; site: string | null; currency: string | null };

function isClientRow(v: unknown): v is ClientRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.slug === "string" && typeof r.name === "string";
}

function extractClients(data: unknown): ClientRow[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>).clients;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isClientRow);
}

export function ClientsFolderPanel({ data }: { data: unknown }) {
  const clients = extractClients(data);
  const [layer, dispatch] = useReducer(folderShellReducer, initialFolderLayer);
  const compact = layer.view === "list";

  return (
    <div className="space-y-3">
      {/* Folder row — full grid at root, compact strip once a folder is open. */}
      <div className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-3 gap-2"}>
        {FOLDERS.map((folder) => {
          const active = layer.view === "list" && layer.folder === folder.id;
          return (
            <FolderChip
              key={folder.id}
              label={folder.label}
              ready={folder.ready}
              active={active}
              compact={compact}
              onOpen={() => dispatch({ type: "open", folder: folder.id as FolderId })}
            />
          );
        })}
      </div>

      {layer.view === "folders" ? (
        <p className="font-hud text-xs text-cyan-100/55">
          {clients.length > 0
            ? `Abra a pasta Clientes para ver ${clients.length} ${clients.length === 1 ? "cliente" : "clientes"}.`
            : "Nenhum cliente ainda."}
        </p>
      ) : (
        <ClientList clients={clients} onBack={() => dispatch({ type: "back" })} />
      )}
    </div>
  );
}

function FolderChip({
  label,
  ready,
  active,
  compact,
  onOpen,
}: {
  label: string;
  ready: boolean;
  active: boolean;
  compact: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={ready ? onOpen : undefined}
      disabled={!ready}
      aria-current={active ? "true" : undefined}
      className={[
        "hud-clip border font-hud transition",
        compact ? "px-2 py-1 text-[0.6rem]" : "flex flex-col items-center gap-1 px-2 py-3 text-xs",
        active
          ? "border-cyan-200/70 bg-cyan-300/15 text-cyan-50 shadow-[0_0_18px_rgba(103,232,249,0.3)]"
          : ready
            ? "border-cyan-300/25 text-cyan-100/80 hover:border-cyan-200/55 hover:text-cyan-50"
            : "cursor-not-allowed border-cyan-300/10 text-cyan-100/30",
      ].join(" ")}
    >
      {!compact ? <span aria-hidden className="text-base leading-none text-cyan-200/70">▣</span> : null}
      <span className="uppercase tracking-[0.16em]">{label}</span>
      {!ready && !compact ? (
        <span className="text-[0.55rem] uppercase tracking-[0.12em] text-cyan-100/30">em breve</span>
      ) : null}
    </button>
  );
}

function ClientList({ clients, onBack }: { clients: ClientRow[]; onBack: () => void }) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="font-hud text-[0.65rem] uppercase tracking-[0.16em] text-cyan-100/55 transition hover:text-cyan-50"
      >
        ‹ voltar às pastas
      </button>
      {clients.length === 0 ? (
        <p className="font-hud text-xs text-cyan-100/55">Nenhum cliente ainda.</p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-auto pr-1">
          {clients.map((c) => (
            <li
              key={c.slug}
              className="hud-clip flex items-center gap-3 border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cyan-300/30 font-hud text-sm text-cyan-100/80">
                {c.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-hud text-sm text-cyan-50">{c.name}</span>
                <span className="block truncate font-hud text-[0.65rem] uppercase tracking-[0.14em] text-cyan-100/40">
                  {c.slug}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
