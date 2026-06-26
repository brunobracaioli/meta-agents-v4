import { describe, expect, it } from "vitest";
import {
  FOLDERS,
  folderShellReducer,
  initialFolderLayer,
  type FolderLayer,
} from "./arc-folders";

describe("folderShellReducer", () => {
  it("starts at the folder root", () => {
    expect(initialFolderLayer).toEqual({ view: "folders" });
  });

  it("opening the ready 'clientes' folder navigates to its list", () => {
    const state = folderShellReducer(initialFolderLayer, { type: "open", folder: "clientes" });
    expect(state).toEqual({ view: "list", folder: "clientes" });
  });

  it("opening a not-yet-ready folder is a no-op", () => {
    for (const folder of ["funil", "pages", "configs", "ultron"] as const) {
      expect(folderShellReducer(initialFolderLayer, { type: "open", folder })).toBe(initialFolderLayer);
    }
  });

  it("back from a list returns to the folder root", () => {
    const list: FolderLayer = { view: "list", folder: "clientes" };
    expect(folderShellReducer(list, { type: "back" })).toEqual({ view: "folders" });
  });

  it("back at the root is a no-op", () => {
    expect(folderShellReducer(initialFolderLayer, { type: "back" })).toBe(initialFolderLayer);
  });

  it("re-opening the folder it is already on is a no-op (stable reference)", () => {
    const list: FolderLayer = { view: "list", folder: "clientes" };
    expect(folderShellReducer(list, { type: "open", folder: "clientes" })).toBe(list);
  });

  it("exposes exactly one ready folder in the fixed shell (Clientes)", () => {
    const ready = FOLDERS.filter((f) => f.ready).map((f) => f.id);
    expect(ready).toEqual(["clientes"]);
    expect(FOLDERS).toHaveLength(5);
  });
});
