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

import { SearchableProjectPicker } from "./SearchableProjectPicker";

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPicker(onSelectProject: (path: string) => void) {
  act(() =>
    root.render(
      createElement(SearchableProjectPicker, {
        cwd: "/work/repo",
        recents: [
          { path: "/work/repo", openedAt: 3 },
          { path: "/work/other", openedAt: 2 },
          { path: "/work/repo-feat-picker", openedAt: 1 },
        ],
        onSelectProject,
      }),
    ),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {});
}

function rowTitles(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
  ]
    .map((button) => button.getAttribute("title") ?? "")
    .filter(Boolean);
}

function press(key: string) {
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

it("lists worktrees below the projects and never twice", async () => {
  const onSelectProject = vi.fn();
  await openPicker(onSelectProject);

  const titles = rowTitles();
  expect(titles).toEqual([
    "/work/repo",
    "/work/other",
    "/work/repo-feat-picker",
  ]);
  expect(document.body.textContent).toContain("feat/picker");

  const worktreeRow = document.querySelector<HTMLButtonElement>(
    '[title="/work/repo-feat-picker"]',
  )!;
  await act(async () => worktreeRow.click());
  expect(onSelectProject).toHaveBeenCalledWith("/work/repo-feat-picker");
});

it("walks the arrow keys across projects and worktrees as one list", async () => {
  const onSelectProject = vi.fn();
  await openPicker(onSelectProject);

  // Two projects, then the worktree: three presses down lands on the worktree.
  await act(async () => {
    press("ArrowDown");
    press("ArrowDown");
  });
  await act(async () => press("Enter"));

  expect(onSelectProject).toHaveBeenCalledWith("/work/repo-feat-picker");
});

it("filters worktrees with the same search box as the projects", async () => {
  const onSelectProject = vi.fn();
  await openPicker(onSelectProject);

  const input = document.querySelector<HTMLInputElement>(
    "[role=dialog] input",
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, "picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(rowTitles()).toEqual(["/work/repo-feat-picker"]);
});

it("adds a worktree and opens it", async () => {
  const onSelectProject = vi.fn();
  await openPicker(onSelectProject);

  const add = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("New worktree"))!;
  await act(async () => add.click());

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
  expect(onSelectProject).toHaveBeenCalledWith("/work/repo-feat-next");
});
