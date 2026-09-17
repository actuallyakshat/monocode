import { pathKey, prettyCwd, slash } from "./paths";

const KEY = "monocode.recentProjects";
const RAIL_ORDER_KEY = "monocode.projectRailOrder";
const RAIL_PINNED_KEY = "monocode.projectRailPinned";
const ARCHIVED_KEY = "monocode.archivedProjects";
const ARCHIVED_CHANGED = "monocode:archived-projects-changed";
const MAX = 20;

export type RecentProject = {
  path: string;
  openedAt: number;
};

export type ArchivedProject = {
  path: string;
  archivedAt: number;
};

export function normalizeProjectPath(path: string): string {
  return slash(path).replace(/\/+$/, "") || "/";
}

function normalize(path: string): string {
  return normalizeProjectPath(path);
}

export function sameProjectPath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Linked worktrees git reported this session. A worktree is another folder of
 *  a repository already in the rail, so recording it would list one project
 *  twice under two names. Read from git, never saved, so it cannot go stale. */
const LINKED_WORKTREES = new Set<string>();

/**
 * Linked worktrees from previous sessions. The memory set above is empty
 * after a reload, so without this a deleted worktree stored in recents would
 * restore on every launch. Persisted on every mark, capped below.
 */
const LINKED_PERSIST_KEY = "monocode.linkedWorktrees.v1";
const LINKED_PERSIST_MAX = 100;

export function loadLinkedWorktrees(): string[] {
  try {
    const raw = localStorage.getItem(LINKED_PERSIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function saveLinkedWorktrees(paths: string[]) {
  try {
    localStorage.setItem(LINKED_PERSIST_KEY, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

/** Called with the linked worktrees of a repository, the main one excluded. */
export function markLinkedWorktrees(paths: string[]) {
  for (const path of paths) LINKED_WORKTREES.add(pathKey(normalize(path)));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const path of [...loadLinkedWorktrees(), ...paths.map(normalize)]) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(path);
  }
  saveLinkedWorktrees(next.slice(-LINKED_PERSIST_MAX));
}

export function isLinkedWorktree(path: string): boolean {
  const key = pathKey(normalize(path));
  if (LINKED_WORKTREES.has(key)) return true;
  return loadLinkedWorktrees().some((entry) => pathKey(entry) === key);
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; openedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const openedAt =
        typeof rec.openedAt === "number" && Number.isFinite(rec.openedAt)
          ? rec.openedAt
          : 0;
      out.push({ path: normalize(rec.path), openedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function save(next: RecentProject[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

export function rememberProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (normalized === "~") return loadRecents();
  // The worktree's repository is already listed; the composer chip names the
  // worktree the chat runs in.
  if (isLinkedWorktree(normalized)) return loadRecents();
  dropArchived(normalized);
  const prev = loadRecents().filter(
    (p) => !sameProjectPath(p.path, normalized),
  );
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev].slice(
    0,
    MAX,
  );
  save(next);
  return next;
}

/** Drops a project from the rail: its recent entry, saved order slot, and pin. */
function dropFromRail(path: string): RecentProject[] {
  const normalized = normalize(path);
  const next = loadRecents().filter(
    (item) => !sameProjectPath(item.path, normalized),
  );
  save(next);
  saveProjectRailOrder(
    loadProjectRailOrder().filter(
      (entry) => !sameProjectPath(entry, normalized),
    ),
  );
  savePinnedProjects(
    loadPinnedProjects().filter((entry) => !sameProjectPath(entry, normalized)),
  );
  return next;
}

/** Removes a project from the rail and from the archive (Delete). */
export function forgetProject(path: string): RecentProject[] {
  dropArchived(path);
  return dropFromRail(path);
}

/**
 * Drops one recents entry without touching pins, order, or archive. Used by
 * the launch sweep for folders that no longer exist: reopening the folder
 * re-adds it, so nothing the user still has is lost.
 */
export function dropRecentProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  const next = loadRecents().filter(
    (item) => !sameProjectPath(item.path, normalized),
  );
  save(next);
  return next;
}

/** Removes a project from the rail and files it in the archive (Archive). */
export function archiveProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (!looksLikeProject(normalized)) return loadRecents();
  const recents = dropFromRail(normalized);
  const rest = loadArchivedProjects().filter(
    (item) => !sameProjectPath(item.path, normalized),
  );
  saveArchived([{ path: normalized, archivedAt: Date.now() }, ...rest]);
  return recents;
}

export function loadArchivedProjects(): ArchivedProject[] {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ArchivedProject[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; archivedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const path = normalize(rec.path);
      const key = pathKey(path);
      if (seen.has(key) || !looksLikeProject(path)) continue;
      seen.add(key);
      const archivedAt =
        typeof rec.archivedAt === "number" && Number.isFinite(rec.archivedAt)
          ? rec.archivedAt
          : 0;
      out.push({ path, archivedAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function subscribeArchivedProjects(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ARCHIVED_CHANGED, onChange);
  return () => window.removeEventListener(ARCHIVED_CHANGED, onChange);
}

function saveArchived(next: ArchivedProject[]) {
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVED_CHANGED));
  }
}

function dropArchived(path: string) {
  const normalized = normalize(path);
  const prev = loadArchivedProjects();
  const next = prev.filter((item) => !sameProjectPath(item.path, normalized));
  if (next.length === prev.length) return;
  saveArchived(next);
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

export type ProjectRailSections = {
  pinned: RecentProject[];
  projects: RecentProject[];
};

function readPathList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      const normalized = pathKey(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function savePathList(key: string, paths: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailOrder(): string[] {
  return readPathList(RAIL_ORDER_KEY);
}

export function saveProjectRailOrder(order: string[]) {
  savePathList(RAIL_ORDER_KEY, order.map(normalize));
}

export function loadPinnedProjects(): string[] {
  return readPathList(RAIL_PINNED_KEY);
}

export function savePinnedProjects(pinned: string[]) {
  savePathList(RAIL_PINNED_KEY, pinned.map(normalize));
}

/** Every project path we still remember — rail, pins, saved order, archive. */
export function knownProjectPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const paths = [
    ...loadRecents().map((item) => item.path),
    ...loadProjectRailOrder(),
    ...loadPinnedProjects(),
    ...loadArchivedProjects().map((item) => item.path),
  ];
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalize(path));
  }
  return out;
}

/** All projects for the rail, keyed by normalized path. */
export function collectRailProjects(
  recents: RecentProject[],
  currentCwd: string,
): Map<string, RecentProject> {
  const map = new Map<string, RecentProject>();
  for (const item of recents) {
    if (!looksLikeProject(item.path)) continue;
    const path = normalize(item.path);
    map.set(pathKey(path), { path, openedAt: item.openedAt });
  }
  if (currentCwd && looksLikeProject(currentCwd)) {
    const path = normalize(currentCwd);
    const key = pathKey(path);
    if (!map.has(key)) {
      map.set(key, { path, openedAt: Date.now() });
    }
  }
  return map;
}

/** Append new projects to the saved order without moving existing entries. */
export function syncProjectRailOrder(
  order: string[],
  projects: Map<string, RecentProject>,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const key = pathKey(path);
    const project = projects.get(key);
    if (!project || seen.has(key)) continue;
    seen.add(key);
    next.push(project.path);
  }
  const newcomers = [...projects.entries()]
    .filter(([key]) => !seen.has(key))
    .sort(([, a], [, b]) => b.openedAt - a.openedAt)
    .map(([, project]) => project.path);
  return [...next, ...newcomers];
}

export function projectRailSections(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
): ProjectRailSections {
  const projects = collectRailProjects(recents, currentCwd);
  const syncedOrder = syncProjectRailOrder(order, projects);
  const pinnedSet = new Set(pinnedPaths.map(pathKey));
  const pinned: RecentProject[] = [];
  const unpinned: RecentProject[] = [];
  for (const path of syncedOrder) {
    const key = pathKey(path);
    const item = projects.get(key);
    if (!item) continue;
    if (pinnedSet.has(key)) pinned.push(item);
    else unpinned.push(item);
  }
  return { pinned, projects: unpinned };
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(
  recents: RecentProject[],
  currentCwd: string,
): RecentProject[] {
  const projects = collectRailProjects(recents, currentCwd);
  const order = syncProjectRailOrder(loadProjectRailOrder(), projects);
  const { pinned, projects: unpinned } = projectRailSections(
    recents,
    currentCwd,
    order,
    loadPinnedProjects(),
  );
  return [...pinned, ...unpinned];
}

/** True if this looks like a user project, not an app bundle or system root. */
export function looksLikeProject(path: string): boolean {
  if (!path || path === "/" || path === "~") return false;
  const normalized = slash(path).replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(normalized) || normalized === "/") return false;
  // Home itself arrives expanded (`/Users/me`), so the `~` check above misses
  // it. Indexing it walks `~/Library`, which trips the OS consent prompt.
  if (prettyCwd(path) === "~") return false;
  if (path.includes(".app/") || path.includes(".app\\")) return false;
  return true;
}
