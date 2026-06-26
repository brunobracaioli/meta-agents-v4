// SPEC-019 Wave B — pure layer state machine for the ARC "folder shell" (the clients panel).
//
// Models the navigation from the 3 reference screens: (1) a root row of 5 folders
// (Clientes / Funil / Pages / Configs / Ultron), (2) opening the "Clientes" folder collapses
// the row and reveals the scrolling client list. Kept framework-free (no React, no server-only)
// so the panel can drive it with `useReducer` AND it stays unit-testable in the node vitest env,
// mirroring `render-bus-reducer.ts`. Only the "clientes" folder is wired in Wave B; the others
// are declared but not yet ready ("em breve"), so opening them is a deliberate no-op.

export const FOLDER_IDS = ["clientes", "funil", "pages", "configs", "ultron"] as const;
export type FolderId = (typeof FOLDER_IDS)[number];

export type Folder = { id: FolderId; label: string; ready: boolean };

// The fixed shell. `ready:false` folders render as "em breve" and don't navigate (their real
// surfaces live behind other render-tools / future waves).
export const FOLDERS: readonly Folder[] = [
  { id: "clientes", label: "Clientes", ready: true },
  { id: "funil", label: "Funil", ready: false },
  { id: "pages", label: "Pages", ready: false },
  { id: "configs", label: "Configs", ready: false },
  { id: "ultron", label: "Ultron", ready: false },
] as const;

// view "folders" = the 5-folder root; view "list" = an opened (ready) folder's contents.
export type FolderLayer = { view: "folders" } | { view: "list"; folder: FolderId };

export const initialFolderLayer: FolderLayer = { view: "folders" };

export type FolderAction = { type: "open"; folder: FolderId } | { type: "back" };

function isReady(folder: FolderId): boolean {
  return FOLDERS.some((f) => f.id === folder && f.ready);
}

export function folderShellReducer(state: FolderLayer, action: FolderAction): FolderLayer {
  switch (action.type) {
    case "open":
      // Opening a not-yet-ready folder is a no-op (the chip shows "em breve").
      if (!isReady(action.folder)) return state;
      if (state.view === "list" && state.folder === action.folder) return state; // already there
      return { view: "list", folder: action.folder };
    case "back":
      if (state.view === "folders") return state; // no-op: already at the root
      return { view: "folders" };
    default:
      return state;
  }
}
