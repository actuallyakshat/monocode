import { Loader } from "./icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { basename } from "../lib/fs";
import { LAYER } from "../lib/layers";

type Props = {
  /** Folder the worktree is added from; only its repository matters. */
  cwd: string;
  busy: boolean;
  error?: string | null;
  onCreate: (branch: string) => void;
  onCancel: () => void;
};

export function NewWorktreeDialog({
  cwd,
  busy,
  error,
  onCreate,
  onCancel,
}: Props) {
  const [branch, setBranch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = branch.trim();
  const canCreate = trimmed.length > 0 && !busy;

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
              onCreate(trimmed);
            }
          }}
        />

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
            onClick={() => onCreate(trimmed)}
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
