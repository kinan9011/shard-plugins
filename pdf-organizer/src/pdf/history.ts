import type { Page } from "./engine";

export type History = { past: Page[][]; pages: Page[]; future: Page[][] };
export const emptyHistory: History = { past: [], pages: [], future: [] };
export type Edit = { type: "set"; pages: Page[] } | { type: "undo" | "redo" | "reset" };

export function historyReducer(state: History, edit: Edit): History {
  if (edit.type === "reset") return emptyHistory;
  if (edit.type === "set") return { past: [...state.past, state.pages].slice(-30), pages: edit.pages, future: [] };
  if (edit.type === "undo" && state.past.length) return {
    past: state.past.slice(0, -1), pages: state.past[state.past.length - 1], future: [state.pages, ...state.future],
  };
  if (edit.type === "redo" && state.future.length) return {
    past: [...state.past, state.pages], pages: state.future[0], future: state.future.slice(1),
  };
  return state;
}

export function movePage(pages: Page[], id: string, target: number): Page[] {
  const index = pages.findIndex(page => page.id === id);
  if (index < 0 || target < 0 || target >= pages.length || index === target) return pages;
  const result = [...pages];
  result.splice(target, 0, result.splice(index, 1)[0]);
  return result;
}

export function moveSource(pages: Page[], id: string, targetId: string): Page[] {
  const ids = [...new Set(pages.map(page => page.sourceId))];
  const index = ids.indexOf(id), target = ids.indexOf(targetId);
  if (index < 0 || target < 0 || index === target) return pages;
  ids.splice(target, 0, ids.splice(index, 1)[0]);
  return ids.flatMap(sourceId => pages.filter(page => page.sourceId === sourceId));
}
