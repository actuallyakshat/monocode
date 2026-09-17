import { Check, FolderTree, Loader, Plus, Search, Trash2 } from "./icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  basename,
  gitAddWorktree,
  gitDiffStats,
  gitHistory,
  gitRemoveWorktree,
  notifyGitChanged,
  type GitWorktree,
} from "../lib/fs";
import { resolveWorktreeBaseDir } from "../lib/settings";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { markLinkedWorktrees } from "../lib/recents";
import {
  useProjectWorktrees,
  worktreeLabel,
} from "../hooks/useProjectWorktrees";
import { NewWorktreeDialog } from "./NewWorktreeDialog";
import { Popover } from "./Popover";

type Props = {
  cwd: string;
  enabled?: boolean;
  /** Switch this session's folder to the chosen worktree. */
  onCwdChange: (path: string) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 280;
/** A clean worktree counts as stale after this long without a commit. */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

type Row = { kind: "worktree"; entry: GitWorktree } | { kind: "create" };

export function WorktreePicker({
  cwd,
  enabled = true,
  onCwdChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [staleByPath, setStaleByPath] = useState<Record<string, boolean>>({});
  const [removeTarget, setRemoveTarget] = useState<GitWorktree | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const inProject = Boolean(cwd) && cwd !== "~";
  const { all, current, isRepo, refresh } = useProjectWorktrees(cwd, inProject);
  // The main worktree folder keys the per-project location setting, so the
  // choice stays stable when the chat runs inside a linked tree.
  const mainPath = all.find((entry) => entry.main)?.path ?? cwd;

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  useEffect(() => {
    // Popover measures itself off-screen behind `visibility: hidden` before
    // placing it; focusing during that pass is a no-op in real browsers, so
    // wait a frame for the popover to actually be visible.
    if (!open) return;
    const id = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Flag worktrees with no uncommitted changes and no recent commit, so the
  // menu names candidates for removal. Lookups run only while the menu is
  // open and never block switching.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStaleByPath({});
    const linked = all.filter((entry) => !entry.main);
    if (linked.length === 0) return;
    void (async () => {
      const flags = await Promise.all(
        linked.map(async (entry) => {
          try {
            const [stats, history] = await Promise.all([
              gitDiffStats(entry.path),
              gitHistory(entry.path, 1),
            ]);
            const clean =
              stats.files === 0 &&
              stats.additions === 0 &&
              stats.deletions === 0;
            const last = history.commits[0]?.timestamp ?? 0;
            const stale =
              clean &&
              last > 0 &&
              Date.now() - last * 1000 > STALE_AFTER_MS;
            return [entry.path, stale] as const;
          } catch {
            return [entry.path, false] as const;
          }
        }),
      );
      if (!cancelled) {
        setStaleByPath(Object.fromEntries(flags.filter(([, stale]) => stale)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, all]);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    setRemoveTarget(null);
    setRemoveError(null);
    if (restore) onCloseRef.current?.();
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((entry) => {
      const label = worktreeLabel(entry).toLowerCase();
      const folder = basename(entry.path).toLowerCase();
      const path = entry.path.toLowerCase();
      const branch = entry.branch?.toLowerCase() ?? "";
      return (
        label.includes(needle) ||
        folder.includes(needle) ||
        path.includes(needle) ||
        branch.includes(needle)
      );
    });
  }, [all, query]);

  const rows: Row[] = [
    ...filtered.map((entry): Row => ({ kind: "worktree", entry })),
    { kind: "create" },
  ];

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const pick = (row: Row) => {
    if (row.kind === "create") {
      // The dialog replaces the menu, so the menu closes without restoring
      // focus to the composer yet.
      dismiss(false);
      setCreateError(null);
      setCreateBusy(false);
      setCreating(true);
      return;
    }
    if (row.entry.current) {
      dismiss(true);
      return;
    }
    dismiss(true);
    // The chat moves to another folder of a repository the rail already
    // lists, so the folder is not a second project.
    markLinkedWorktrees([row.entry.path]);
    onCwdChange(row.entry.path);
  };

  const createWorktree = async (branch: string, baseDir: string | null) => {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      // The location setting already resolved in the dialog; fall back to the
      // stored per-project value when an older caller passes null.
      const resolved =
        baseDir ?? resolveWorktreeBaseDir(mainPath, mainPath);
      const path = await gitAddWorktree(cwd, branch, resolved);
      refresh();
      notifyGitChanged();
      setCreating(false);
      setCreateBusy(false);
      markLinkedWorktrees([path]);
      onCwdChange(path);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setCreateBusy(false);
    }
  };

  const removeWorktree = async (force: boolean) => {
    const target = removeTarget;
    if (!target || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await gitRemoveWorktree(cwd, target.path, force);
      setRemoveTarget(null);
      setRemoveBusy(false);
      refresh();
      notifyGitChanged();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
      setRemoveBusy(false);
    }
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row && !removeTarget) pick(row);
    }
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row && !removeTarget) pick(row);
    }
  };

  // Only a git repository has worktrees, and the branch chip beside this one
  // already says when a folder is not one.
  if (!isRepo) return null;

  const label = current ? worktreeLabel(current) : basename(cwd);

  return (
    <div ref={root} className="relative flex min-w-0 shrink items-center">
      <button
        type="button"
        title={`Worktree ${label}`}
        aria-label={`Worktree ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={`flex min-w-0 items-center gap-1.5 ${
          open ? "text-content" : "text-content/50 hover:text-content"
        } disabled:opacity-40 disabled:hover:text-content/50`}
      >
        <FolderTree className="size-3.5 shrink-0" strokeWidth={1.5} />
        <span className="truncate font-mono text-[12px]">{label}</span>
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={(reason) => dismiss(reason === "escape")}
          onKeyDown={onMenuKey}
          role="dialog"
          aria-label="Worktree picker"
          data-worktree-picker
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-stroke px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              ref={search}
              type="text"
              value={query}
              placeholder="Search worktrees..."
              aria-label="Search worktrees"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <WorktreeList
            entries={filtered}
            active={active}
            staleByPath={staleByPath}
            emptyLabel={query.trim() ? "No matching worktrees" : "No worktrees"}
            onActive={setActive}
            onPick={(entry) => pick({ kind: "worktree", entry })}
            onRemove={(entry) => {
              setRemoveTarget(entry);
              setRemoveError(null);
            }}
          />
          <div className="shrink-0 border-t border-stroke p-1.5">
            {removeTarget ? (
              <div
                role="alertdialog"
                aria-label={`Remove worktree ${worktreeLabel(removeTarget)}`}
                className="flex flex-col gap-2 rounded-md bg-content/5 p-2"
              >
                <p className="text-[12px] leading-snug text-content/80">
                  Remove “{worktreeLabel(removeTarget)}”? The folder will
                  be deleted; the branch is kept.
                </p>
                {removeError ? (
                  <p className="max-h-20 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-red-400/90">
                    {removeError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={removeBusy}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (removeBusy) return;
                      setRemoveTarget(null);
                      setRemoveError(null);
                    }}
                    className="rounded-md px-2 py-1 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={removeBusy}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void removeWorktree(false)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-content px-2 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
                  >
                    {removeBusy ? (
                      <Loader
                        className="size-3.5 animate-spin"
                        strokeWidth={1.75}
                      />
                    ) : null}
                    Remove
                  </button>
                  {removeError ? (
                    <button
                      type="button"
                      disabled={removeBusy}
                      title="Discard uncommitted changes and remove the folder"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void removeWorktree(true)}
                      className="rounded-md px-2 py-1 text-[12px] text-red-400/90 hover:bg-content/8 disabled:opacity-40"
                    >
                      Force
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={() => pick({ kind: "create" })}
                className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left ${
                  active === filtered.length
                    ? "bg-selection-hover text-content"
                    : "text-content/75 hover:bg-selection-hover hover:text-content"
                }`}
              >
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate text-[12px]">New worktree</span>
              </button>
            )}
          </div>
        </Popover>
      ) : null}
      {creating ? (
        <NewWorktreeDialog
          cwd={cwd}
          projectPath={mainPath}
          busy={createBusy}
          error={createError}
          onCreate={(branch, baseDir) => void createWorktree(branch, baseDir)}
          onCancel={() => {
            if (createBusy) return;
            setCreating(false);
            setCreateError(null);
            onCloseRef.current?.();
          }}
        />
      ) : null}
    </div>
  );
}

function WorktreeList({
  entries,
  active,
  staleByPath,
  emptyLabel,
  onActive,
  onPick,
  onRemove,
}: {
  entries: GitWorktree[];
  active: number;
  staleByPath: Record<string, boolean>;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (entry: GitWorktree) => void;
  onRemove: (entry: GitWorktree) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-content/50">{emptyLabel}</div>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Worktrees"
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-none p-1.5"
    >
      {entries.map((entry, index) => {
        const highlighted = index === active;
        const label = worktreeLabel(entry);
        const folder = basename(entry.path);
        // The label is already the folder for the main worktree, and a
        // worktree named after its branch repeats it in the path.
        const meta = entry.main ? null : folder === label ? null : folder;
        // The main tree and the folder this chat runs in stay: removing
        // either would delete the project itself or the session folder.
        const removable = !entry.main && !entry.current;
        const stale = Boolean(staleByPath[entry.path]);
        return (
          <button
            key={entry.path}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={entry.current}
            title={entry.path}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(entry)}
            // Pointing at a row and being in it are different states, so the
            // hover fill has to sit above the selected one, not equal it.
            className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
              highlighted
                ? "bg-selection-hover text-content"
                : entry.current
                  ? "bg-selection-subtle text-content"
                  : "text-content/75 hover:bg-selection-hover hover:text-content"
            }`}
          >
            <span className="grid size-3.5 shrink-0 place-items-center">
              {entry.current ? (
                <Check className="size-3.5" strokeWidth={1.75} />
              ) : (
                <FolderTree
                  className="size-3.5 text-content/45"
                  strokeWidth={1.75}
                />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
              {label}
            </span>
            {stale ? (
              <span
                title="No uncommitted changes and no recent commit"
                className="shrink-0 rounded-full border border-content/15 px-1.5 py-px text-[10px] text-content/45"
              >
                Stale
              </span>
            ) : null}
            {meta ? (
              <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-content/35">
                {meta}
              </span>
            ) : null}
            {removable ? (
              <span
                role="button"
                tabIndex={-1}
                title={`Remove worktree ${label}`}
                aria-label={`Remove worktree ${label}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove(entry);
                  }
                }}
                className="grid size-5 shrink-0 place-items-center rounded text-content/35 opacity-0 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
