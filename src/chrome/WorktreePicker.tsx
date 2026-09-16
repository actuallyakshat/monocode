import { Check, FolderTree, Plus } from "./icons";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  basename,
  gitAddWorktree,
  notifyGitChanged,
  type GitWorktree,
} from "../lib/fs";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
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
const MENU_MIN_HEIGHT = 140;
const MENU_MAX_HEIGHT = 280;

type Row = { kind: "worktree"; entry: GitWorktree } | { kind: "create" };

export function WorktreePicker({
  cwd,
  enabled = true,
  onCwdChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const inProject = Boolean(cwd) && cwd !== "~";
  const { all, current, isRepo, refresh } = useProjectWorktrees(cwd, inProject);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open]);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setActive(0);
    if (restore) onCloseRef.current?.();
  };

  const rows: Row[] = [
    ...all.map((entry): Row => ({ kind: "worktree", entry })),
    { kind: "create" },
  ];

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
    onCwdChange(row.entry.path);
  };

  const createWorktree = async (branch: string) => {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const path = await gitAddWorktree(cwd, branch);
      refresh();
      notifyGitChanged();
      setCreating(false);
      setCreateBusy(false);
      onCwdChange(path);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setCreateBusy(false);
    }
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLElement>) => {
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
      if (row) pick(row);
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
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={(reason) => dismiss(reason === "escape")}
          onKeyDown={onMenuKey}
          role="dialog"
          aria-label="Worktree picker"
          data-worktree-picker
          className="flex flex-col overflow-hidden"
        >
          <WorktreeList
            rows={rows}
            active={active}
            onActive={setActive}
            onPick={pick}
          />
        </Popover>
      ) : null}
      {creating ? (
        <NewWorktreeDialog
          cwd={cwd}
          busy={createBusy}
          error={createError}
          onCreate={(branch) => void createWorktree(branch)}
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
  rows,
  active,
  onActive,
  onPick,
}: {
  rows: Row[];
  active: number;
  onActive: (index: number) => void;
  onPick: (row: Row) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Worktrees"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        const selected = row.kind === "worktree" && row.entry.current;
        return (
          <button
            key={row.kind === "create" ? "create" : row.entry.path}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={selected}
            title={row.kind === "create" ? undefined : row.entry.path}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(row)}
            className={
              row.kind === "create"
                ? `mt-1 flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left ${
                    highlighted
                      ? "bg-selection-hover text-content"
                      : "bg-selection text-content hover:bg-selection-hover"
                  }`
                : `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                    highlighted || selected
                      ? "bg-selection text-content"
                      : "text-content hover:bg-content/5"
                  }`
            }
          >
            {row.kind === "create" ? (
              <>
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate text-[12px]">
                  New worktree
                </span>
              </>
            ) : (
              <>
                {selected ? (
                  <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : (
                  <FolderTree
                    className="size-3.5 shrink-0 text-content/50"
                    strokeWidth={1.75}
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {worktreeLabel(row.entry)}
                </span>
                <span className="shrink-0 text-[10px] text-content/40">
                  {row.entry.main ? "main" : basename(row.entry.path)}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
