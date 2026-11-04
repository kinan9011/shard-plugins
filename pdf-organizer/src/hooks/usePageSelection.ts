import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Page } from "../pdf/engine";

type Modifiers = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type Rectangle = { left: number; top: number; width: number; height: number };

export function usePageSelection(pages: Page[], busy: boolean) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string>();
  const [rectangle, setRectangle] = useState<Rectangle>();
  const grid = useRef<HTMLOListElement>(null);
  const anchor = useRef<string>();
  const gesture = useRef<{ pointer: number; x: number; y: number; clientX: number; clientY: number; initial: Set<string>; anchor?: string; additive: boolean; moved: boolean }>();

  useEffect(() => {
    finish(true);
    const ids = new Set(pages.map(page => page.id));
    setSelected(previous => new Set([...previous].filter(id => ids.has(id))));
    if (!ids.has(anchor.current ?? "")) anchor.current = undefined;
    setFocused(previous => ids.has(previous ?? "") ? previous : pages[0]?.id);
  }, [pages]);
  useEffect(() => { if (busy) finish(true); }, [busy]);

  function clear() { setSelected(new Set()); anchor.current = undefined; }

  function select(id: string, modifiers: Modifiers, toggle = false) {
    if (busy) return;
    setFocused(id);
    const additive = modifiers.ctrlKey || modifiers.metaKey;
    const start = pages.findIndex(page => page.id === anchor.current);
    const end = pages.findIndex(page => page.id === id);
    setSelected(previous => {
      if (modifiers.shiftKey && start >= 0) {
        const next = additive ? new Set(previous) : new Set<string>();
        pages.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(page => next.add(page.id));
        return next;
      }
      if (!additive && !toggle) return new Set([id]);
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!modifiers.shiftKey || start < 0) anchor.current = id;
  }

  function finish(cancel = false) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    if (cancel) { setSelected(current.initial); anchor.current = current.anchor; }
    else if (!current.moved && !current.additive) clear();
    if (grid.current?.hasPointerCapture(current.pointer)) grid.current.releasePointerCapture(current.pointer);
    setRectangle(undefined);
  }

  function updateMarquee() {
    const current = gesture.current;
    const element = grid.current;
    if (!current || !element) return;
    const bounds = element.getBoundingClientRect();
    const x = current.clientX - bounds.left, y = current.clientY - bounds.top;
    if (!current.moved && Math.hypot(x - current.x, y - current.y) < 5) return;
    current.moved = true;
    const rect = { left: Math.min(x, current.x), top: Math.min(y, current.y), width: Math.abs(x - current.x), height: Math.abs(y - current.y) };
    setRectangle(rect);
    const next = current.additive ? new Set(current.initial) : new Set<string>();
    element.querySelectorAll<HTMLElement>("[data-page-id]").forEach(card => {
      const box = card.getBoundingClientRect();
      if (box.right > bounds.left + rect.left && box.left < bounds.left + rect.left + rect.width && box.bottom > bounds.top + rect.top && box.top < bounds.top + rect.top + rect.height) next.add(card.dataset.pageId!);
    });
    setSelected(next);
    anchor.current = undefined;
  }

  useEffect(() => {
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (gesture.current) { event.preventDefault(); finish(true); }
      else if (grid.current?.closest("main")?.contains(document.activeElement) && !document.activeElement?.matches("input, select, textarea")) clear();
    }
    function cancel() { finish(true); }
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", updateMarquee, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", updateMarquee, true);
      window.removeEventListener("blur", cancel);
      const current = gesture.current;
      gesture.current = undefined;
      if (current && grid.current?.hasPointerCapture(current.pointer)) grid.current.releasePointerCapture(current.pointer);
    };
  }, []);

  function pointerDown(event: PointerEvent<HTMLOListElement>) {
    if (busy || !event.isPrimary || event.button !== 0 || event.pointerType === "touch" || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    gesture.current = { pointer: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top, clientX: event.clientX, clientY: event.clientY, initial: new Set(selected), anchor: anchor.current, additive: event.ctrlKey || event.metaKey, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.currentTarget.querySelector<HTMLElement>(`[tabindex="0"]`)?.focus({ preventScroll: true });
  }

  function pointerMove(event: PointerEvent) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current.clientX = event.clientX; gesture.current.clientY = event.clientY;
    updateMarquee();
  }

  function keyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (busy) return;
    const additive = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") { event.preventDefault(); if (gesture.current) finish(true); else clear(); return; }
    if (additive && event.key.toLowerCase() === "a") { event.preventDefault(); if (event.shiftKey) clear(); else setSelected(new Set(pages.map(page => page.id))); return; }
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); select(id, event, event.key === " "); return; }
    // Ctrl/Cmd+arrows rotate (App-level shortcut); Alt+arrows move pages.
    if ((additive && !event.shiftKey) || event.altKey) return;
    const index = pages.findIndex(page => page.id === id);
    const cards = Array.from(grid.current?.querySelectorAll<HTMLElement>("[data-page-id]") ?? []);
    const columns = cards.filter(card => card.getBoundingClientRect().top === cards[0]?.getBoundingClientRect().top).length || 1;
    const rtl = !!grid.current && getComputedStyle(grid.current).direction === "rtl";   // the grid fills right to left
    const offset = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : offset === undefined ? undefined : Math.max(0, Math.min(pages.length - 1, index + offset));
    if (next === undefined) return;
    event.preventDefault();
    select(pages[next].id, event);
    setFocused(pages[next].id);
    cards[next]?.querySelector<HTMLElement>(".page-select")?.focus();
  }

  return { selected, setSelected, focused, setFocused, grid, rectangle, clear, select, keyDown, pointerDown, pointerMove, finish };
}
