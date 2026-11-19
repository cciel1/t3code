import { isAuxiliaryChatWindow } from "./lib/chatWindow";
import type { ThreadRouteTarget } from "./threadRoutes";
import { resolveThreadRouteTarget } from "./threadRoutes";
import { MAX_SPLIT_CHATS, threadTargetKey, type SplitChatTabGroups } from "./splitChatStore";

const STORAGE_KEY = "t3code:split-workspace:v1";

export interface SavedSplitWorkspace {
  readonly primary: ThreadRouteTarget;
  readonly secondary: readonly ThreadRouteTarget[];
  readonly groups: SplitChatTabGroups;
  readonly activeIndex: number;
  readonly maximizedIndex: number | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function decodeTarget(value: unknown): ThreadRouteTarget | null {
  const target = record(value);
  if (target.kind === "server") {
    const { threadId, environmentId } = record(target.threadRef);
    if (typeof threadId === "string" && typeof environmentId === "string") {
      return resolveThreadRouteTarget({ threadId, environmentId });
    }
  }
  if (target.kind === "draft" && typeof target.draftId === "string") {
    return resolveThreadRouteTarget({ draftId: target.draftId });
  }
  return null;
}

const compactTargets = (input: unknown): ThreadRouteTarget[] =>
  Array.isArray(input) ? input.flatMap((item) => decodeTarget(item) ?? []) : [];

export function readSplitWorkspace(): SavedSplitWorkspace | null {
  if (typeof window === "undefined" || isAuxiliaryChatWindow()) return null;
  try {
    const saved = record(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
    const primary = decodeTarget(saved.primary);
    if (!primary) return null;
    const seen = new Set([threadTargetKey(primary)]);
    const secondary = compactTargets(saved.secondary)
      .filter((target) => {
        const key = threadTargetKey(target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SPLIT_CHATS - 1);
    const assigned = new Set<string>();
    const groups = (Array.isArray(saved.groups) ? saved.groups : []).flatMap((group) => {
      const local = new Set<string>();
      const tabs = compactTargets(group).filter((target) => {
        const key = threadTargetKey(target);
        if (assigned.has(key) || local.has(key)) return false;
        local.add(key);
        return true;
      });
      if (tabs.length < 2) return [];
      const representatives = [primary, ...secondary].filter((pane) =>
        local.has(threadTargetKey(pane)),
      );
      if (representatives.length !== 1) return [];
      for (const key of local) assigned.add(key);
      return [tabs];
    });
    const validIndex = (value: unknown): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= secondary.length;
    const activeIndex = validIndex(saved.activeIndex) ? saved.activeIndex : 0;
    return {
      primary,
      secondary,
      groups,
      activeIndex,
      maximizedIndex: secondary.length && saved.maximizedIndex === activeIndex ? activeIndex : null,
    };
  } catch {
    return null;
  }
}

export function writeSplitWorkspace(snapshot: SavedSplitWorkspace | null) {
  if (typeof window === "undefined" || isAuxiliaryChatWindow()) return;
  try {
    if (snapshot) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Disabled storage shouldn't prevent opening or arranging chats.
  }
}
