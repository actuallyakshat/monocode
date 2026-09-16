import { useEffect, useState } from "react";
import { basename, gitWorktrees, type GitWorktree } from "../lib/fs";

/** Last list read per folder, so reopening a picker paints it on the first
 *  frame instead of growing once git answers. */
const CACHE = new Map<string, GitWorktree[]>();

/** Called after adding a worktree: the repository now has one more than the
 *  cached list knows. */
export function forgetProjectWorktrees(cwd: string) {
  CACHE.delete(cwd);
}

/** The main worktree is known by its folder, the others by their branch. */
export function worktreeLabel(entry: GitWorktree): string {
  if (entry.main) return basename(entry.path);
  if (entry.branch) return entry.branch;
  return entry.detached ? "detached HEAD" : basename(entry.path);
}

export type ProjectWorktrees = {
  /** Worktrees other than the one `cwd` is already inside. */
  others: GitWorktree[];
  /** Git answered with at least one worktree, so a worktree can be added. */
  isRepo: boolean;
};

const NONE: ProjectWorktrees = { others: [], isRepo: false };

/**
 * Worktrees of `cwd`. They are only needed while a picker is open, so they are
 * read on each open rather than kept in a subscription the way the branch list
 * is.
 */
export function useProjectWorktrees(
  cwd: string,
  enabled: boolean,
): ProjectWorktrees {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>(
    () => CACHE.get(cwd) ?? [],
  );

  useEffect(() => {
    setWorktrees(CACHE.get(cwd) ?? []);
  }, [cwd]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void gitWorktrees(cwd)
      .then((list) => {
        CACHE.set(cwd, list);
        if (!cancelled) setWorktrees(list);
      })
      .catch(() => {
        CACHE.delete(cwd);
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, enabled]);

  if (!enabled) return NONE;
  return {
    others: worktrees.filter((entry) => !entry.current),
    isRepo: worktrees.length > 0,
  };
}
