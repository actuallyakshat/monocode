import { Loader } from "./icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { basename } from "../lib/fs";
import {
  loadWorktreeLocation,
  resolveWorktreeBaseDir,
  saveWorktreeLocation,
  worktreeProjectStem,
  type WorktreeLocationMode,
} from "../lib/settings";
import { LAYER } from "../lib/layers";

type Props = {
  /** Folder the worktree is added from; only its repository matters. */
  cwd: string;
  /** Main worktree folder: the settings key and the central-base name source. */
  projectPath: string;
  busy: boolean;
  error?: string | null;
  onCreate: (branch: string, baseDir: string | null) => void;
  onCancel: () => void;
};

export function NewWorktreeDialog({
  cwd,
  projectPath,
  busy,
  error,
  onCreate,
  onCancel,
}: Props) {
  const [branch, setBranch] = useState("");
  const [mode, setMode] = useState<WorktreeLocationMode>(
    () => loadWorktreeLocation(projectPath).mode,
  );
  const [customDir, setCustomDir] = useState(
    () => loadWorktreeLocation(projectPath).customDir ?? "",
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = branch.trim();
  const customTrimmed = customDir.trim();
  const canCreate = trimmed.length > 0 && !busy && (mode !== "custom" || customTrimmed.length > 0);

  const pickMode = (next: WorktreeLocationMode) => {
    setMode(next);
    saveWorktreeLocation(projectPath, {
      mode: next,
      customDir: next === "custom" ? customTrimmed || undefined : undefined,
    });
  };

  const changeCustomDir = (value: string) => {
    setCustomDir(value);
    if (mode === "custom" && value.trim()) {
      saveWorktreeLocation(projectPath, { mode, customDir: value.trim() });
    }
  };

  const baseDir = resolveWorktreeBaseDir(
    projectPath,
    projectPath,
    mode === "custom"
      ? { mode, customDir: customTrimmed || undefined }
      : { mode },
  );
  const centralPreview = `~/worktrees/${worktreeProjectStem(projectPath)}/`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="absolute inset-0 bg-black/30"
        onMouseDown={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-label="New worktree"
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            New worktree
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            Git checks the branch out in a folder beside “{basename(cwd)}”, so
            this chat works there without moving the other chats.
          </p>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={branch}
          placeholder="Branch name"
          aria-label="Branch name"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={busy}
          className="w-full rounded-md bg-content/10 px-2 py-1 font-mono text-[13px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40"
          onChange={(event) => setBranch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canCreate) {
              event.preventDefault();
              onCreate(trimmed, baseDir);
            }
          }}
        />

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="pb-1 text-[12px] font-medium text-content/80">
            Location for this project
          </legend>
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[12px] text-content/75">
            <input
              type="radio"
              name="worktree-location"
              checked={mode === "sibling"}
              disabled={busy}
              onChange={() => pickMode("sibling")}
              className="shrink-0 accent-current"
            />
            <span className="min-w-0 flex-1 truncate">
              Beside the repo (default)
            </span>
          </label>
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[12px] text-content/75">
            <input
              type="radio"
              name="worktree-location"
              checked={mode === "central"}
              disabled={busy}
              onChange={() => pickMode("central")}
              className="shrink-0 accent-current"
            />
            <span className="min-w-0 flex-1 truncate" title={`In ${centralPreview}`}>
              In <span className="font-mono">{centralPreview}</span>
            </span>
          </label>
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[12px] text-content/75">
            <input
              type="radio"
              name="worktree-location"
              checked={mode === "custom"}
              disabled={busy}
              onChange={() => pickMode("custom")}
              className="shrink-0 accent-current"
            />
            <span className="min-w-0 flex-1 truncate">Custom folder</span>
          </label>
          {mode === "custom" ? (
            <input
              type="text"
              value={customDir}
              placeholder="~/worktrees or /Volumes/data/worktrees"
              aria-label="Custom worktree folder"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              className="w-full rounded-md bg-content/10 px-2 py-1 font-mono text-[12px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40"
              onChange={(event) => changeCustomDir(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canCreate) {
                  event.preventDefault();
                  onCreate(trimmed, baseDir);
                }
              }}
            />
          ) : null}
          <p
            className="truncate font-mono text-[11px] leading-4 text-content/40"
            title={baseDir ? `Folder goes in ${baseDir}/` : "Folder goes beside the repo"}
          >
            {baseDir ? `Folder goes in ${baseDir}/` : "Folder goes beside the repo"}
          </p>
        </fieldset>

        {error ? (
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(trimmed, baseDir)}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            Create worktree
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
