import type { Page } from "./engine";
import { noCrop, narrowCrop, turnCrop, type Crop } from "./geometry";

export type History = { past: Page[][]; pages: Page[]; future: Page[][] };
export const emptyHistory: History = { past: [], pages: [], future: [] };
export type Edit = { type: "set" | "load"; pages: Page[] } | { type: "undo" | "redo" | "reset" };

export function historyReducer(state: History, edit: Edit): History {
  if (edit.type === "reset") return emptyHistory;
  // "load" replaces the whole session (Open): nothing before it can be undone into.
  if (edit.type === "load") return { past: [], pages: edit.pages, future: [] };
  if (edit.type === "set") return { past: [...state.past, state.pages].slice(-30), pages: edit.pages, future: [] };
  if (edit.type === "undo" && state.past.length) return {
    past: state.past.slice(0, -1), pages: state.past[state.past.length - 1], future: [state.pages, ...state.future],
  };
  if (edit.type === "redo" && state.future.length) return {
    past: [...state.past, state.pages], pages: state.future[0], future: state.future.slice(1),
  };
  return state;
}

/** Moves `ids` (kept in document order) next to `targetId`; null target appends. Returns the same array when nothing changes. */
export function movePages(pages: Page[], ids: Set<string>, targetId: string | null, after = false): Page[] {
  if (targetId !== null && ids.has(targetId)) return pages;
  const moving = pages.filter(page => ids.has(page.id));
  if (!moving.length) return pages;
  const remaining = pages.filter(page => !ids.has(page.id));
  const target = targetId === null ? remaining.length : remaining.findIndex(page => page.id === targetId);
  if (target < 0) return pages;
  const insertion = target + (targetId !== null && after ? 1 : 0);
  const result = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
  return result.every((page, index) => page === pages[index]) ? pages : result;
}

/** Copies with fresh IDs; the same source page can appear many times. */
export const clonePages = (pages: Page[]): Page[] => pages.map(page => ({ ...page, id: crypto.randomUUID() }));

/** Inserts `added` before/after `targetId`; a null target appends. A missing target changes nothing. */
export function insertPages(pages: Page[], added: Page[], targetId: string | null, after = true): Page[] {
  if (!added.length) return pages;
  const target = targetId === null ? pages.length : pages.findIndex(page => page.id === targetId);
  if (target < 0) return pages;
  const at = targetId === null ? target : target + (after ? 1 : 0);
  return [...pages.slice(0, at), ...added, ...pages.slice(at)];
}

/** Reverses the chosen pages within their own slots; fewer than two chosen pages reverses the whole document. */
export function reversePages(pages: Page[], ids: Set<string>): Page[] {
  const slots = pages.flatMap((page, index) => ids.has(page.id) ? [index] : []);
  const chosen = slots.length > 1 ? slots : pages.map((_, index) => index);
  if (chosen.length < 2) return pages;
  const result = [...pages];
  chosen.forEach((slot, i) => { result[slot] = pages[chosen[chosen.length - 1 - i]]; });
  return result;
}

const turns = (page: Page) => page.rotation / 90;

/** Crops the chosen pages further. `margins` are fractions of what is currently visible, as the page is displayed now. */
export function cropPages(pages: Page[], ids: Set<string>, margins: Crop): Page[] {
  return pages.map(page => ids.has(page.id) ? { ...page, crop: turnCrop(narrowCrop(turnCrop(page.crop ?? noCrop, turns(page)), margins), -turns(page)) } : page);
}

/** Sets an absolute crop given in displayed orientation (for example the detected content box). */
export function setCrop(page: Page, displayed: Crop): Page { return { ...page, crop: turnCrop(displayed, -turns(page)) }; }

export function scalePages(pages: Page[], ids: Set<string>, factor: number): Page[] {
  return pages.map(page => ids.has(page.id) ? { ...page, scale: factor === 1 ? undefined : factor } : page);
}

export function resetGeometry(pages: Page[], ids: Set<string>): Page[] {
  return pages.map(page => ids.has(page.id) && (page.crop || page.scale) ? { ...page, crop: undefined, scale: undefined } : page);
}

/** Replaces each chosen page by cols×rows pages, one per cell, in reading order as displayed. The pieces get fresh IDs. */
export function splitPages(pages: Page[], ids: Set<string>, cols: number, rows: number): { pages: Page[]; created: string[] } {
  const created: string[] = [];
  if (cols * rows < 2) return { pages, created };
  const result = pages.flatMap(page => {
    if (!ids.has(page.id)) return [page];
    const [left, top, right, bottom] = turnCrop(page.crop ?? noCrop, turns(page));
    const width = (1 - left - right) / cols, height = (1 - top - bottom) / rows;
    return Array.from({ length: cols * rows }, (_, cell) => {
      const row = Math.floor(cell / cols), column = cell % cols;
      const piece: Crop = [left + column * width, top + row * height, right + (cols - 1 - column) * width, bottom + (rows - 1 - row) * height];
      const id = crypto.randomUUID(); created.push(id);
      return { ...page, id, crop: turnCrop(piece, -turns(page)) };
    });
  });
  return { pages: result, created };
}
