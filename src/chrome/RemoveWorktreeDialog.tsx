import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader } from "./icons";
import { LAYER } from "../lib/layers";

type Props = {
  name: string;
  pathPretty: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onForce: () => void;
};

/**
 * Confirm removing a linked worktree. The folder is deleted; the branch
 * itself is left alone.
 */
export function RemoveWorktreeDialog({
  name,
  pathPretty,
  busy,
  error,
  onCancel,
  onConfirm,
  onForce,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/40" onMouseDown={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Remove worktree ${name}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-[13px] font-medium leading-tight text-content" title={`Remove “${name}”?`}>
            Remove “{name}”?
          </h2>
          <p className="text-[12px] leading-snug text-content/55 [overflow-wrap:anywhere]">
            The folder at{" "}
            <span className="font-mono">{pathPretty}</span> will be deleted;
            the branch is kept.
          </p>
          {error ? (
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-red-400/90">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            Cancel
          </button>
          {error ? (
            <button
              type="button"
              disabled={busy}
              title="Discard uncommitted changes and remove the folder"
              onClick={onForce}
              className="rounded-md px-3 py-1.5 text-[12px] text-red-400/90 hover:bg-content/8 disabled:opacity-40"
            >
              Force
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
