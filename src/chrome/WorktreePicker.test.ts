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

import { WorktreePicker } from "./WorktreePicker";
import { forgetProjectWorktrees } from "../hooks/useProjectWorktrees";
import { isLinkedWorktree } from "../lib/recents";

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
  // The hook caches per folder across tests.
  forgetProjectWorktrees("/work/repo");
  worktrees.list.mockResolvedValue([MAIN, FEATURE]);
  worktrees.add.mockResolvedValue("/work/repo-feat-next");
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

async function render(onCwdChange: (path: string) => void) {
  act(() =>
    root.render(
      createElement(WorktreePicker, { cwd: "/work/repo", onCwdChange }),
    ),
  );
  await act(async () => {});
}

function chip(): HTMLButtonElement | null {
  return container.querySelector("button");
}

async function openMenu() {
  await act(async () => chip()!.click());
  await act(async () => {});
}

function option(label: string): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent?.includes(label));
}

it("shows the current worktree beside the branch and switches folders", async () => {
  const onCwdChange = vi.fn();
  await render(onCwdChange);

  // The main worktree is named by its folder, the others by their branch.
  expect(chip()!.textContent).toContain("repo");
  await openMenu();
  expect(option("feat/picker")).toBeDefined();

  await act(async () => option("feat/picker")!.click());
  expect(onCwdChange).toHaveBeenCalledWith("/work/repo-feat-picker");
  // The rail already lists the repository; the worktree is one of its folders,
  // not a second project.
  expect(isLinkedWorktree("/work/repo-feat-picker")).toBe(true);
});

it("does not switch when the current worktree is chosen again", async () => {
  const onCwdChange = vi.fn();
  await render(onCwdChange);
  await openMenu();

  await act(async () => option("repo")!.click());
  expect(onCwdChange).not.toHaveBeenCalled();
});

it("creates a worktree and moves the session into it", async () => {
  const onCwdChange = vi.fn();
  await render(onCwdChange);
  await openMenu();

  await act(async () => option("New worktree")!.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Branch name"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, "feat/next");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("Create worktree"))!;
  await act(async () => create.click());
  await act(async () => {});

  expect(worktrees.add).toHaveBeenCalledWith("/work/repo", "feat/next");
  expect(onCwdChange).toHaveBeenCalledWith("/work/repo-feat-next");
});

it("fills a pointed-at row differently from the one it is already in", async () => {
  await render(vi.fn());
  await openMenu();

  const selected = option("repo")!;
  const other = option("feat/picker")!;
  // Keyboard focus starts on the row we are in, so move it off before
  // comparing; otherwise both states land on the same row.
  await act(async () =>
    document.querySelector('[role="dialog"]')!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );

  expect(selected.className).toContain("bg-selection-subtle");
  expect(other.className).toContain("bg-selection-hover");
  expect(selected.className).not.toContain("bg-selection-hover");
});

it("renders nothing outside a git repository", async () => {
  worktrees.list.mockResolvedValue([]);
  const onCwdChange = vi.fn();
  await render(onCwdChange);

  // The branch chip beside it already reports "No repo"; two such labels in
  // one toolbar would read as two different problems.
  expect(container.querySelector("button")).toBeNull();
});
