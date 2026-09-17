// @vitest-environment happy-dom
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  worktrees: vi.fn(),
  diffStats: vi.fn(),
  history: vi.fn(),
  size: vi.fn(),
}));

vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  gitWorktrees: fsMocks.worktrees,
  gitDiffStats: fsMocks.diffStats,
  gitHistory: fsMocks.history,
  dirSize: fsMocks.size,
}));

import {
  clearAllWorktreesCache,
  useAllWorktrees,
  type AllWorktreeEntry,
} from "./useAllWorktrees";

let container: HTMLDivElement;
let root: Root;
let seen: AllWorktreeEntry[][] = [];

function Probe({ projects }: { projects: string[] }) {
  const { entries } = useAllWorktrees(projects, true);
  seen.push(entries);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearAllWorktreesCache();
  seen = [];
  fsMocks.worktrees.mockImplementation((project: string) =>
    Promise.resolve(
      project === "/work/repo"
        ? [
            { path: "/work/repo", branch: "main", detached: false, main: true, current: false },
            { path: "/work/repo-feat", branch: "feat", detached: false, main: false, current: false },
          ]
        : [],
    ),
  );
  fsMocks.diffStats.mockResolvedValue({ files: 0, additions: 0, deletions: 0 });
  fsMocks.history.mockResolvedValue({
    head: "abc",
    commits: [
      { sha: "abc", shortSha: "abc", parents: [], author: "A", timestamp: 1700000000, subject: "s", refs: [], head: true },
    ],
  });
  fsMocks.size.mockResolvedValue({ bytes: 42, files: 2, truncated: false });
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

it("lists linked worktrees across projects with status, activity, and size", async () => {
  act(() => {
    root.render(createElement(Probe, { projects: ["/work/repo", "/work/plain"] }));
  });
  await act(async () => {});

  const last = seen[seen.length - 1]!;
  expect(last).toHaveLength(1);
  expect(last[0]).toMatchObject({
    project: "/work/repo",
    projectName: "repo",
    path: "/work/repo-feat",
    branch: "feat",
    clean: true,
    lastCommit: 1700000000,
    sizeBytes: 42,
  });
  expect(fsMocks.worktrees).toHaveBeenCalledWith("/work/repo");
  expect(fsMocks.worktrees).toHaveBeenCalledWith("/work/plain");
});

it("serves the cached aggregate until an explicit refresh", async () => {
  act(() => {
    root.render(createElement(Probe, { projects: ["/work/repo"] }));
  });
  await act(async () => {});
  expect(fsMocks.worktrees.mock.calls.length).toBeGreaterThan(0);

  const calls = fsMocks.worktrees.mock.calls.length;
  // A second mount with the same projects reuses the cache: no new scan.
  await act(async () => root.unmount());
  root = createRoot(container);
  act(() => {
    root.render(createElement(Probe, { projects: ["/work/repo"] }));
  });
  await act(async () => {});
  expect(fsMocks.worktrees.mock.calls.length).toBe(calls);
});
