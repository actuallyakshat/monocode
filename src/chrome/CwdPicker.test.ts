// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitWorktree } from "../lib/fs";

const worktrees = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn() }));

vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  gitWorktrees: worktrees.list,
  gitAddWorktree: worktrees.add,
  notifyGitChanged: vi.fn(),
}));

import { CwdPicker } from "./CwdPicker";

const MAIN: GitWorktree = {
  path: "/work/repo",
  branch: "main",
  detached: false,
  main: true,
  current: true,
};
const FEATURE: GitWorktree = {
  path: "/work/repo-feat-picker",
  branch: "feat/picker",
  detached: false,
  main: false,
  current: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  worktrees.list.mockResolvedValue([MAIN, FEATURE]);
  worktrees.add.mockResolvedValue("/work/repo-feat-next");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPicker(onCwdChange: (path: string) => void) {
  act(() =>
    root.render(
      createElement(CwdPicker, {
        cwd: "/work/repo",
        recents: [
          { path: "/work/repo", openedAt: 2 },
          { path: "/work/repo-feat-picker", openedAt: 1 },
        ],
        onCwdChange,
      }),
    ),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {});
}

// Use the native setter so React sees a user change, not its own value write.
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function menuItem(label: string): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes(label));
}

it("lists the other worktrees and switches the folder to the picked one", async () => {
  const onCwdChange = vi.fn();
  await openPicker(onCwdChange);

  expect(worktrees.list).toHaveBeenCalledWith("/work/repo");
  const row = menuItem("feat/picker");
  expect(row).toBeDefined();
  // The worktree is also a recent project; listing it twice would read as two
  // different folders.
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].filter((item) =>
      item.getAttribute("title")?.includes("repo-feat-picker"),
    ),
  ).toHaveLength(1);

  await act(async () => row!.click());
  expect(onCwdChange).toHaveBeenCalledWith("/work/repo-feat-picker");
});

it("adds a worktree and moves the folder into it", async () => {
  const onCwdChange = vi.fn();
  await openPicker(onCwdChange);

  await act(async () => menuItem("New worktree")!.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Branch name"]',
  );
  expect(input).not.toBeNull();

  await act(async () => typeInto(input!, "feat/next"));
  const create = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("Create worktree"));
  await act(async () => create!.click());
  await act(async () => {});

  expect(worktrees.add).toHaveBeenCalledWith("/work/repo", "feat/next");
  expect(onCwdChange).toHaveBeenCalledWith("/work/repo-feat-next");
});

it("keeps the dialog open and shows why git refused the worktree", async () => {
  worktrees.add.mockRejectedValue(
    new Error("fatal: 'feat/next' is already used by worktree at '/work/x'"),
  );
  const onCwdChange = vi.fn();
  await openPicker(onCwdChange);

  await act(async () => menuItem("New worktree")!.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Branch name"]',
  )!;
  await act(async () => typeInto(input, "feat/next"));
  const create = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("Create worktree"))!;
  await act(async () => create.click());
  await act(async () => {});

  expect(onCwdChange).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("already used by worktree");
});
