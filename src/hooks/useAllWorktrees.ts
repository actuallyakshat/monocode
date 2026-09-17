import { useCallback, useEffect, useState } from "react";
import {
  dirSize,
  gitDiffStats,
  gitHistory,
  gitWorktrees,
} from "../lib/fs";
import { projectName } from "../lib/paths";

export type AllWorktreeEntry = {
  /** Main worktree folder of the repository this tree belongs to. */
  project: string;
  projectName: string;
  path: string;
  branch: string | null;
  detached: boolean;
  current: boolean;
  /** Null while the detail lookup fails. */
  clean: boolean | null;
  /** Last commit timestamp in seconds, or null when unknown. */
  lastCommit: number | null;
  /** Folder bytes, or null when the lookup fails. */
  sizeBytes: number | null;
  sizeTruncated: boolean;
};

/**
 * Aggregated linked worktrees across projects. The list is cached module-wide
 * and only rescanned on first use or an explicit refresh, so opening the view
 * never walks every checkout again.
 */
let CACHE: AllWorktreeEntry[] | null = null;
let REFRESHED_AT: number | null = null;
let IN_FLIGHT: Promise<AllWorktreeEntry[]> | null = null;

function detailFor(
  project: string,
  entry: { path: string; branch: string | null; detached: boolean; current: boolean },
): Promise<AllWorktreeEntry> {
  return Promise.all([
    gitDiffStats(entry.path)
      .then(
        (stats) =>
          stats.files === 0 && stats.additions === 0 && stats.deletions === 0,
      )
      .catch((): boolean | null => null),
    gitHistory(entry.path, 1)
      .then((history) => history.commits[0]?.timestamp ?? null)
      .catch((): number | null => null),
    dirSize(entry.path)
      .then((size) => ({ bytes: size.bytes, truncated: size.truncated }))
      .catch((): { bytes: null; truncated: false } => ({
        bytes: null,
        truncated: false,
      })),
  ]).then(([clean, lastCommit, size]) => ({
    project,
    projectName: projectName(project),
    path: entry.path,
    branch: entry.branch,
    detached: entry.detached,
    current: entry.current,
    clean,
    lastCommit,
    sizeBytes: size.bytes,
    sizeTruncated: size.truncated,
  }));
}

function scan(projects: string[]): Promise<AllWorktreeEntry[]> {
  if (IN_FLIGHT) return IN_FLIGHT;
  const next = (async () => {
    const perProject = await Promise.all(
      projects.map(async (project) => {
        const trees = await gitWorktrees(project).catch(() => []);
        const main =
          trees.find((entry) => entry.main)?.path ?? project;
        const linked = trees.filter((entry) => !entry.main);
        return Promise.all(
          linked.map((entry) => detailFor(main, entry)),
        );
      }),
    );
    const entries = perProject
      .flat()
      .sort((a, b) =>
        a.projectName.localeCompare(b.projectName) ||
        (a.branch ?? "").localeCompare(b.branch ?? "") ||
        a.path.localeCompare(b.path),
      );
    CACHE = entries;
    REFRESHED_AT = Date.now();
    return entries;
  })().finally(() => {
    IN_FLIGHT = null;
  });
  IN_FLIGHT = next;
  return next;
}

export function clearAllWorktreesCache() {
  CACHE = null;
  REFRESHED_AT = null;
}

export type AllWorktrees = {
  entries: AllWorktreeEntry[];
  loading: boolean;
  refreshedAt: number | null;
  refresh: () => void;
};

export function useAllWorktrees(
  projects: string[],
  enabled: boolean,
): AllWorktrees {
  const [entries, setEntries] = useState<AllWorktreeEntry[]>(
    () => CACHE ?? [],
  );
  const [refreshedAt, setRefreshedAt] = useState<number | null>(
    () => REFRESHED_AT,
  );
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const key = projects.join("\n");

  useEffect(() => {
    if (!enabled) return;
    // Serve the cached aggregate until the user asks for a rescan.
    if (CACHE && revision === 0) {
      setEntries(CACHE);
      setRefreshedAt(REFRESHED_AT);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void scan(key ? key.split("\n") : []).then((list) => {
      if (cancelled) return;
      setEntries(list);
      setRefreshedAt(REFRESHED_AT);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, revision]);

  const refresh = useCallback(() => {
    CACHE = null;
    setRevision((value) => value + 1);
  }, []);

  if (!enabled) {
    return { entries: [], loading: false, refreshedAt: null, refresh };
  }
  return { entries, loading, refreshedAt, refresh };
}
