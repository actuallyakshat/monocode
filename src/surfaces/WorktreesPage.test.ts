// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const worktreesState = vi.hoisted(() => ({
  entries: vi.fn(),
  refresh: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  remove: vi.fn(),
  reveal: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../hooks/useAllWorktrees", () => ({
  useAllWorktrees: () => ({
    entries: worktreesState.entries(),
    loading: false,
    refreshedAt: Date.now(),
    refresh: worktreesState.refresh,
  }),
}));

vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  gitRemoveWorktree: fsMocks.remove,
  revealPath: fsMocks.reveal,
  notifyGitChanged: fsMocks.notify,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { SettingsView } from "./SettingsView";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockLocalStorage();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  worktreesState.entries.mockReturnValue([
    {
      project: "/work/repo",
      projectName: "repo",
      path: "/work/repo-feat",
      branch: "feat",
      detached: false,
      current: false,
      clean: true,
      lastCommit: 1700000000,
      sizeBytes: 2048,
      sizeTruncated: false,
    },
  ]);
  worktreesState.refresh.mockClear();
  fsMocks.remove.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderWorktrees(onOpenWorktree: (path: string) => void) {
  await act(async () => {
    root.render(
      createElement(SettingsView, {
        section: "worktrees",
        cwd: "/work/repo",
        sessions: [],
        onClose: vi.fn(),
        onOpenSession: vi.fn(),
        onArchiveSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenWorktree,
        onOpenWhatsNew: vi.fn(),
      }),
    );
  });
}

it("shows one row per linked worktree with status, activity, and size", async () => {
  await renderWorktrees(vi.fn());
  const body = container.textContent ?? "";
  expect(body).toContain("repo");
  expect(body).toContain("feat");
  expect(body).toContain("Clean");
  expect(body).toContain("2.0 KB");
});

it("opens a worktree in the composer", async () => {
  const onOpenWorktree = vi.fn();
  await renderWorktrees(onOpenWorktree);
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open",
  )!;
  await act(async () => open.click());
  expect(onOpenWorktree).toHaveBeenCalledWith("/work/repo-feat");
});

it("removes a worktree after confirmation and rescans", async () => {
  await renderWorktrees(vi.fn());
  const remove = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Remove",
  )!;
  await act(async () => remove.click());
  const confirm = [
    ...document.querySelectorAll('[role="alertdialog"] button'),
  ].find((button) => button.textContent === "Remove")!;
  await act(async () => (confirm as HTMLButtonElement).click());
  await act(async () => {});
  expect(fsMocks.remove).toHaveBeenCalledWith(
    "/work/repo",
    "/work/repo-feat",
    false,
  );
  expect(worktreesState.refresh).toHaveBeenCalled();
});
