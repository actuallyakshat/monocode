import { useCallback, useEffect, useState } from "react";
import { basename, gitWorktrees, type GitWorktree } from "../lib/fs";
import { markLinkedWorktrees } from "../lib/recents";

/** Last list read per folder, so a second pane on the same project paints it
 *  on the first frame instead of growing once git answers. */
const CACHE = new Map<string, GitWorktree[]>();
/** One `git worktree list` per folder, however many panes ask at once. */
const IN_FLIGHT = new Map<string, Promise<GitWorktree[]>>();

/** Called after adding a worktree: the repository now has one more than the
 *  cached list knows. */
export function forgetProjectWorktrees(cwd: string) {
  CACHE.delete(cwd);
  IN_FLIGHT.delete(cwd);
}

/** The main worktree is known by its folder, the others by their branch. */
export function worktreeLabel(entry: GitWorktree): string {
  if (entry.main) return basename(entry.path);
  if (entry.branch) return entry.branch;
  return entry.detached ? "detached HEAD" : basename(entry.path);
}

function read(cwd: string): Promise<GitWorktree[]> {
  const pending = IN_FLIGHT.get(cwd);
  if (pending) return pending;
  const next = gitWorktrees(cwd)
    .then((list) => {
      CACHE.set(cwd, list);
      // Keep the repository's other folders out of the project rail.
      markLinkedWorktrees(
        list.filter((entry) => !entry.main).map((entry) => entry.path),
      );
      return list;
    })
    .catch(() => {
      CACHE.delete(cwd);
      return [];
    })
    .finally(() => {
      IN_FLIGHT.delete(cwd);
    });
  IN_FLIGHT.set(cwd, next);
  return next;
}

export type ProjectWorktrees = {
  /** Every working tree of this repository, the main one first. */
  all: GitWorktree[];
  /** The working tree `cwd` is inside, when git reported one. */
  current: GitWorktree | null;
  /** Git answered with at least one worktree, so this folder is a repository. */
  isRepo: boolean;
  /** Reload after adding a worktree elsewhere. */
  refresh: () => void;
};

/**
 * Worktrees of `cwd`. Git is asked once per folder and the answer is cached, so
 * several panes on one project share a single lookup.
 */
export function useProjectWorktrees(
  cwd: string,
  enabled: boolean,
): ProjectWorktrees {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>(
    () => CACHE.get(cwd) ?? [],
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setWorktrees(CACHE.get(cwd) ?? []);
  }, [cwd]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void read(cwd).then((list) => {
      if (!cancelled) setWorktrees(list);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, enabled, revision]);

  const refresh = useCallback(() => {
    forgetProjectWorktrees(cwd);
    setRevision((value) => value + 1);
  }, [cwd]);

  if (!enabled) {
    return { all: [], current: null, isRepo: false, refresh };
  }
  return {
    all: worktrees,
    current: worktrees.find((entry) => entry.current) ?? null,
    isRepo: worktrees.length > 0,
    refresh,
  };
}
