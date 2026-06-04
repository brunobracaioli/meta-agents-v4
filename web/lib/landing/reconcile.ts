import type { ContentDoc } from "@b2tech/lp-render/content-doc";

// Dirty-set keys mirror the editor's debounce timer keys so a section/theme/settings
// the operator is actively editing is never clobbered by a remote reconcile.
export const sectionDirtyKey = (type: string): string => `section:${type}`;
export const THEME_DIRTY_KEY = "theme";
export const SETTINGS_DIRTY_KEY = "settings";

export type ReconcileInput = {
  localDoc: ContentDoc;
  localVersions: Record<string, number>;
  remoteDoc: ContentDoc;
  remoteVersions: Record<string, number>;
  /** Keys (sectionDirtyKey/THEME_DIRTY_KEY/SETTINGS_DIRTY_KEY) the operator is editing now. */
  dirty: ReadonlySet<string>;
};

export type ReconcileResult = {
  changed: boolean;
  doc: ContentDoc;
  versions: Record<string, number>;
};

/** Structural deep-equality for plain JSON values (objects/arrays/primitives). Used to
 * decide whether theme/settings actually changed, since those carry no per-field version. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const ar = a as unknown[];
    const br = b as unknown[];
    if (ar.length !== br.length) return false;
    return ar.every((v, i) => deepEqual(v, br[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * Merge a freshly-fetched remote draft into the operator's local editing state without
 * losing in-flight edits. "Local wins": any section/theme/settings the operator is
 * currently editing (in `dirty`) is left untouched and resolved at save time by the
 * existing version-guard (409) path.
 *
 * A section is taken from the remote only when its remote version is strictly newer than
 * the local one and it is not dirty. Theme/settings are taken when they differ by content
 * and are not dirty. Returns `changed: false` (and the original doc) when nothing applies,
 * so callers can skip a re-render / iframe postMessage.
 */
export function reconcile({
  localDoc,
  localVersions,
  remoteDoc,
  remoteVersions,
  dirty,
}: ReconcileInput): ReconcileResult {
  let changed = false;
  const nextVersions = { ...localVersions };
  const remoteByType = new Map(remoteDoc.sections.map((s) => [s.type, s]));

  const sections = localDoc.sections.map((local) => {
    const remote = remoteByType.get(local.type);
    if (!remote) return local;
    if (dirty.has(sectionDirtyKey(local.type))) return local;
    const localVersion = localVersions[local.type] ?? 0;
    const remoteVersion = remoteVersions[local.type] ?? 0;
    if (remoteVersion <= localVersion) return local;
    changed = true;
    nextVersions[local.type] = remoteVersion;
    return { ...local, fields: remote.fields, enabled: remote.enabled, position: remote.position };
  });

  let theme = localDoc.theme;
  if (!dirty.has(THEME_DIRTY_KEY) && !deepEqual(localDoc.theme, remoteDoc.theme)) {
    theme = remoteDoc.theme;
    changed = true;
  }

  let settings = localDoc.settings;
  if (!dirty.has(SETTINGS_DIRTY_KEY) && !deepEqual(localDoc.settings, remoteDoc.settings)) {
    settings = remoteDoc.settings;
    changed = true;
  }

  if (!changed) return { changed: false, doc: localDoc, versions: localVersions };
  return { changed: true, doc: { ...localDoc, sections, theme, settings }, versions: nextVersions };
}
