import { ChevronDown, ChevronRight, GitBranch, Plus } from "./icons";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  basename,
  gitAddWorktree,
  gitWorktrees,
  notifyGitChanged,
  type GitWorktree,
} from "../lib/fs";
import { prettyCwd, prettyParent } from "../lib/paths";
import {
  looksLikeProject,
  projectRailItems,
  sameProjectPath,
  type RecentProject,
} from "../lib/recents";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { NewWorktreeDialog } from "./NewWorktreeDialog";
import { Popover } from "./Popover";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { MOD } from "../lib/platform";

type Props = {
  cwd: string;
  recents: RecentProject[];
  /** Moving an item offers the full project rail in a single list. */
  mode?: "switch" | "move";
  /** Active app project, which can differ from the item's current project. */
  activeCwd?: string;
  renderProjectLabel?: (path: string) => ReactNode;
  projectLogoPath?: string | null;
  enabled?: boolean;
  placement?: "above" | "below";
  className?: string;
  buttonClassName?: string;
  /** Chevron on the trailing edge; flips when the menu is open. */
  chevron?: boolean;
  children?: ReactNode;
  onCwdChange: (path: string) => void;
  onNewTerminal?: () => void;
  onClose?: () => void;
};

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 360;
const SUBMENU_MAX_HEIGHT = 320;
const PREVIEW = 5;
const SUBMENU_GAP = 4;
const HOVER_CLOSE_MS = 100;
/* Both menus sit outside the trigger, so neither counts as a click-away. */
const SELF = "[data-cwd-picker],[data-cwd-submenu]";

type Row =
  | { kind: "worktree"; path: string }
  | { kind: "recent"; path: string }
  | { kind: "more" }
  | { kind: "new-worktree" }
  | { kind: "new-terminal" };

/** The main worktree is known by its folder, the others by their branch. */
function worktreeLabel(entry: GitWorktree): string {
  if (entry.main) return basename(entry.path);
  if (entry.branch) return entry.branch;
  return entry.detached ? "detached HEAD" : basename(entry.path);
}

export function CwdPicker({
  cwd,
  recents,
  mode = "switch",
  activeCwd,
  renderProjectLabel,
  projectLogoPath,
  enabled = true,
  placement = "above",
  className,
  buttonClassName,
  chevron = false,
  children,
  onCwdChange,
  onNewTerminal,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const closeMoreTimer = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const inProject = looksLikeProject(cwd);
  const label = prettyCwd(cwd);
  // Worktrees are only needed while the menu is open, so they are read on each
  // open rather than kept in a subscription the way the branch list is.
  const showWorktrees = mode === "switch" && inProject;
  useEffect(() => {
    if (!open || !showWorktrees) return;
    let cancelled = false;
    void gitWorktrees(cwd)
      .then((list) => {
        if (!cancelled) setWorktrees(list);
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, open, showWorktrees]);
  useEffect(() => {
    setWorktrees([]);
  }, [cwd]);
  // The current folder is the menu header, and a worktree opened earlier is
  // also a recent project; list each one once, under Worktrees.
  const otherWorktrees = showWorktrees
    ? worktrees.filter((entry) => !entry.current)
    : [];
  const isWorktreePath = (path: string) =>
    otherWorktrees.some((entry) => sameProjectPath(entry.path, path));
  // Read the saved rail order on opening, including changes made while Notes is open.
  const projects =
    mode === "move" ? projectRailItems(recents, activeCwd ?? "") : recents;
  const otherRecents = projects.filter(
    (item) =>
      (!inProject || !sameProjectPath(item.path, cwd)) &&
      !isWorktreePath(item.path),
  );
  const previewRecents =
    mode === "move" ? otherRecents : otherRecents.slice(0, PREVIEW);
  const overflowRecents = mode === "move" ? [] : otherRecents.slice(PREVIEW);
  const hasMore = overflowRecents.length > 0;

  useEffect(() => {
    if (mode === "move") activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, open, mode]);

  const canAddWorktree = showWorktrees && worktrees.length > 0;
  // Keyboard order has to match the rendered order: worktrees, recents, the
  // More submenu, then the footer actions.
  const rows: Row[] = [
    ...otherWorktrees.map((entry): Row => ({
      kind: "worktree",
      path: entry.path,
    })),
    ...previewRecents.map((item): Row => ({ kind: "recent", path: item.path })),
    ...(hasMore ? [{ kind: "more" } as Row] : []),
    ...(canAddWorktree ? [{ kind: "new-worktree" } as Row] : []),
    ...(onNewTerminal ? [{ kind: "new-terminal" } as Row] : []),
  ];

  const dismiss = (restore = false) => {
    setOpen(false);
    setMoreOpen(false);
    setActive(0);
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    if (restore) onCloseRef.current?.();
  };

  const openMore = () => {
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    setMoreOpen(true);
  };

  const scheduleCloseMore = () => {
    if (closeMoreTimer.current != null)
      window.clearTimeout(closeMoreTimer.current);
    closeMoreTimer.current = window.setTimeout(() => {
      closeMoreTimer.current = null;
      setMoreOpen(false);
    }, HOVER_CLOSE_MS);
  };

  const pick = (row: Row) => {
    if (row.kind === "more") return;
    if (row.kind === "new-worktree") {
      // The dialog replaces the menu, so the menu closes without restoring
      // focus to whatever opened it.
      dismiss(false);
      setCreateError(null);
      setCreateBusy(false);
      setCreating(true);
      return;
    }
    dismiss(true);
    if (row.kind === "new-terminal") {
      onNewTerminal?.();
      return;
    }
    onCwdChange(row.path);
  };

  const createWorktree = async (branch: string) => {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const path = await gitAddWorktree(cwd, branch);
      notifyGitChanged();
      setCreating(false);
      setCreateBusy(false);
      onCloseRef.current?.();
      onCwdChange(path);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setCreateBusy(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const row = rows[active + 1];
      if (row?.kind === "more") openMore();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (e.key === "ArrowRight") {
      const row = rows[active];
      if (row?.kind === "more") {
        e.preventDefault();
        openMore();
      }
    }
    if (e.key === "ArrowLeft") {
      if (moreOpen) {
        e.preventDefault();
        setMoreOpen(false);
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row?.kind === "more") {
        openMore();
        return;
      }
      if (row) pick(row);
    }
  };

  const recentsOffset = otherWorktrees.length;
  const moreIndex = hasMore ? recentsOffset + previewRecents.length : -1;
  const newWorktreeIndex = canAddWorktree
    ? recentsOffset + previewRecents.length + (hasMore ? 1 : 0)
    : -1;
  const newTerminalIndex = onNewTerminal ? rows.length - 1 : -1;

  return (
    <div
      ref={root}
      className={`relative flex h-full min-w-0${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        title={cwd}
        aria-label={`Project ${label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!enabled}
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={
          buttonClassName
            ? `${buttonClassName} ${
                open ? "bg-selection text-content" : "hover:bg-content/5"
              } disabled:opacity-40`
            : `flex min-w-0 items-center gap-1.5 ${
                open ? "text-content" : "text-content/50 hover:text-content"
              } disabled:opacity-40`
        }
      >
        {children ?? (
          <>
            <ProjectLogoIcon path={projectLogoPath} fallbackStrokeWidth={1.5} />
            <span className="truncate font-mono text-[12px]">{label}</span>
          </>
        )}
        {chevron ? (
          <ChevronDown
            className={`size-3 shrink-0 text-content/50 ${
              open ? "rotate-180" : ""
            }`}
            strokeWidth={1.75}
          />
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={root}
          side={placement === "below" ? "bottom" : "top"}
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          ignore={SELF}
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="menu"
          aria-label="Project picker"
          data-cwd-picker
          className="flex flex-col overflow-hidden"
        >
          <div
            ref={lockOverscroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1"
          >
            {inProject ? (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-content/50">
                  Current project
                </p>
                <div className="px-2.5 py-1.5 text-content/50">
                  <p className="truncate text-[13px] text-content">
                    {renderProjectLabel?.(cwd) ?? basename(cwd)}
                  </p>
                  <p className="truncate font-mono text-[11px]">
                    {prettyParent(cwd)}
                  </p>
                </div>
              </>
            ) : null}
            {otherWorktrees.length > 0 ? (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-content/50">
                  Worktrees
                </p>
                {otherWorktrees.map((entry, index) => (
                  <button
                    key={entry.path}
                    ref={active === index ? activeRef : undefined}
                    type="button"
                    role="menuitem"
                    title={entry.path}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      setMoreOpen(false);
                      setActive(index);
                    }}
                    onClick={() => pick({ kind: "worktree", path: entry.path })}
                    className={`flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left ${
                      active === index
                        ? "bg-selection text-content"
                        : "text-content/80 hover:bg-content/5"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <GitBranch
                        className="size-3.5 shrink-0 text-content/45"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 truncate text-[13px]">
                        {worktreeLabel(entry)}
                      </span>
                    </span>
                    <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-content/45">
                      {entry.main ? "main worktree" : basename(entry.path)}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {previewRecents.length > 0 || mode === "move" ? (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-content/50">
                  {mode === "move" ? "Move to project" : "Recent projects"}
                </p>
                {mode === "move" && previewRecents.length === 0 ? (
                  <p className="px-2.5 py-2 text-[13px] text-content/50">
                    No other projects
                  </p>
                ) : null}
                {previewRecents.map((item, offset) => (
                  <button
                    key={item.path}
                    ref={
                      active === recentsOffset + offset ? activeRef : undefined
                    }
                    type="button"
                    role="menuitem"
                    title={item.path}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      setMoreOpen(false);
                      setActive(recentsOffset + offset);
                    }}
                    onClick={() => pick({ kind: "recent", path: item.path })}
                    className={`flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left ${
                      active === recentsOffset + offset
                        ? "bg-selection text-content"
                        : "text-content/80 hover:bg-content/5"
                    }`}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      {renderProjectLabel?.(item.path) ?? basename(item.path)}
                    </span>
                    <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-content/45">
                      {prettyParent(item.path)}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {hasMore ? (
              <button
                ref={moreRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                onMouseLeave={scheduleCloseMore}
                onFocus={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                className={`flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left ${
                  active === moreIndex || moreOpen
                    ? "bg-selection text-content"
                    : "text-content/80 hover:bg-content/5"
                }`}
              >
                <span className="text-[13px]">More Projects</span>
                <ChevronRight
                  className="size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
              </button>
            ) : null}
          </div>
          {canAddWorktree || onNewTerminal ? (
            <div className="shrink-0 border-t border-stroke py-1">
              {canAddWorktree ? (
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    setMoreOpen(false);
                    setActive(newWorktreeIndex);
                  }}
                  onClick={() => pick({ kind: "new-worktree" })}
                  className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${
                    active === newWorktreeIndex
                      ? "bg-selection text-content"
                      : "text-content/80 hover:bg-content/5"
                  }`}
                >
                  <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="text-[13px]">New worktree</span>
                </button>
              ) : null}
              {onNewTerminal ? (
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    setMoreOpen(false);
                    setActive(newTerminalIndex);
                  }}
                  onClick={() => pick({ kind: "new-terminal" })}
                  className={`flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left ${
                    active === newTerminalIndex
                      ? "bg-selection text-content"
                      : "text-content/80 hover:bg-content/5"
                  }`}
                >
                  <span className="text-[13px]">New terminal</span>
                  <span className="shrink-0 font-mono text-[11px] text-content/45">
                    {MOD}`
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
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
      {open && moreOpen ? (
        <Popover
          anchor={moreRef}
          side="right"
          gap={SUBMENU_GAP}
          width={MENU_WIDTH}
          maxHeight={SUBMENU_MAX_HEIGHT}
          layer={LAYER.submenu}
          role="menu"
          aria-label="More projects"
          data-cwd-submenu
          className="overflow-y-auto overscroll-none py-1"
          onMouseEnter={openMore}
          onMouseLeave={scheduleCloseMore}
        >
          {overflowRecents.map((item) => (
            <button
              key={item.path}
              type="button"
              role="menuitem"
              title={item.path}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => pick({ kind: "recent", path: item.path })}
              className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left text-content/80 hover:bg-content/5 hover:text-content"
            >
              <span className="min-w-0 truncate text-[13px]">
                {renderProjectLabel?.(item.path) ?? basename(item.path)}
              </span>
              <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-content/45">
                {prettyParent(item.path)}
              </span>
            </button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
