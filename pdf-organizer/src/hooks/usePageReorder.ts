import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Page } from "../pdf/engine";

// Pointer events, not HTML5 drag-and-drop: embedded webviews swallow native drags that start inside a plugin frame.
type Marker = { targetId: string; after: boolean; left: number; top: number; height: number; position: number };
type Ghost = { x: number; y: number; count: number };
export type Drop = { targetId: string; after: boolean };

const THRESHOLD = 5, LONG_PRESS = 400, EDGE = 56;

type Options = {
  pages: Page[]; selected: Set<string>; grid: RefObject<HTMLOListElement>; scroller: RefObject<HTMLElement>; busy: boolean;
  selectOnly: (id: string) => void; commit: (ids: Set<string>, drop: Drop, copy: boolean) => void;
};

export function usePageReorder(options: Options) {
  const [dragging, setDragging] = useState<Set<string>>(new Set());
  const [marker, setMarker] = useState<Marker>();
  const [ghost, setGhost] = useState<Ghost>();
  const latest = useRef(options); latest.current = options;
  const armed = useRef<{ pointer: number; id: string; x: number; y: number; touch: boolean; timer?: number }>();
  const drag = useRef<{ ids: Set<string>; pointer: number; x: number; y: number; marker?: Marker }>();
  const suppress = useRef(false);
  const frame = useRef<number>();

  // Handlers are created once: window listeners must be removable with the same function identities.
  const handlers = useRef<{ stop: () => void; down: (event: ReactPointerEvent, id: string) => void }>();
  handlers.current ??= create();
  const { stop, down } = handlers.current;

  function create() {
  const blockScroll = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };

  function stop() {
    if (armed.current?.timer) clearTimeout(armed.current.timer);
    armed.current = undefined; drag.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", abort); window.removeEventListener("blur", abort);
    window.removeEventListener("keydown", key, true); window.removeEventListener("touchmove", blockScroll);
    document.body.classList.remove("reordering");
    setDragging(previous => previous.size ? new Set() : previous); setMarker(undefined); setGhost(undefined);
  }
  function abort() { stop(); }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); }
  }

  /** Picks the nearest visual row, then the insertion edge inside it. Outside the scroll area means "no drop". */
  function locate() {
    const current = drag.current, grid = latest.current.grid.current, scroller = latest.current.scroller.current;
    if (!current || !grid || !scroller) return;
    const area = scroller.getBoundingClientRect();
    const { x, y } = current;
    const inside = x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-page-id]")).map((card, index) => ({ card, index, box: card.getBoundingClientRect() }));
    let next: Marker | undefined;
    if (inside && cards.length) {
      const gridBox = grid.getBoundingClientRect();
      const distance = (c: (typeof cards)[number]) => Math.max(c.box.top - y, y - c.box.bottom, 0);
      const nearest = cards.reduce((best, c) => distance(c) < distance(best) ? c : best);
      const row = cards.filter(c => c.box.top === nearest.box.top);
      const before = row.find(c => x < c.box.left + c.box.width / 2);
      const target = y < cards[0].box.top ? cards[0] : y > cards[cards.length - 1].box.bottom ? cards[cards.length - 1] : before ?? row[row.length - 1];
      const after = y > cards[cards.length - 1].box.bottom || (y >= cards[0].box.top && !before);
      const targetId = target.card.dataset.pageId!;
      if (!current.ids.has(targetId)) next = {
        targetId, after, position: target.index + (after ? 1 : 0),
        left: (after ? target.box.right + 6 : target.box.left - 10) - gridBox.left, top: target.box.top - gridBox.top, height: target.box.height,
      };
    }
    current.marker = next;
    setMarker(next);
  }

  function tick() {
    const current = drag.current, scroller = latest.current.scroller.current;
    if (!current || !scroller) return;
    const area = scroller.getBoundingClientRect();
    const push = current.y < area.top + EDGE ? current.y - (area.top + EDGE) : current.y > area.bottom - EDGE ? current.y - (area.bottom - EDGE) : 0;
    if (push && current.x >= area.left && current.x <= area.right) { scroller.scrollTop += Math.max(-24, Math.min(24, Math.ceil(push / 3))); locate(); }
    frame.current = requestAnimationFrame(tick);
  }

  function begin(x: number, y: number) {
    const a = armed.current;
    if (!a) return;
    if (a.timer) clearTimeout(a.timer);
    const { selected, selectOnly } = latest.current;
    const ids = selected.has(a.id) ? new Set(selected) : new Set([a.id]);
    if (!selected.has(a.id)) selectOnly(a.id);
    drag.current = { ids, pointer: a.pointer, x, y };
    armed.current = undefined;
    suppress.current = true;
    document.body.classList.add("reordering");
    window.addEventListener("touchmove", blockScroll, { passive: false });
    setDragging(ids); setGhost({ x, y, count: ids.size });
    locate();
    frame.current = requestAnimationFrame(tick);
  }

  function move(event: PointerEvent) {
    const current = drag.current, a = armed.current;
    if (current && event.pointerId === current.pointer) {
      current.x = event.clientX; current.y = event.clientY;
      setGhost({ x: event.clientX, y: event.clientY, count: current.ids.size });
      locate();
    } else if (a && event.pointerId === a.pointer) {
      const distance = Math.hypot(event.clientX - a.x, event.clientY - a.y);
      // A moving finger means "scroll"; a moving mouse means "drag".
      if (a.touch) { if (distance > 8) stop(); } else if (distance >= THRESHOLD) begin(event.clientX, event.clientY);
    }
  }

  function up(event: PointerEvent) {
    const current = drag.current;
    if (current && event.pointerId === current.pointer) {
      // Use the last move's position: some touch pointerup events report 0,0 instead of the lift point.
      const drop = current.marker;
      const ids = current.ids;
      stop();
      if (drop && !latest.current.busy) latest.current.commit(ids, { targetId: drop.targetId, after: drop.after }, event.ctrlKey || event.metaKey);
      setTimeout(() => { suppress.current = false; }, 0);
    } else if (armed.current?.pointer === event.pointerId) stop();
  }

  /** Attach to a page card's pointerdown. Plain clicks are left to the card's click handler. */
  function down(event: ReactPointerEvent, id: string) {
    if (latest.current.busy || !event.isPrimary || event.button !== 0 || (event.target as Element).closest("button")) return;
    stop();
    suppress.current = false;
    const touch = event.pointerType === "touch";
    armed.current = { pointer: event.pointerId, id, x: event.clientX, y: event.clientY, touch };
    if (touch) { const a = armed.current; a.timer = window.setTimeout(() => begin(a.x, a.y), LONG_PRESS); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort); window.addEventListener("blur", abort);
    window.addEventListener("keydown", key, true);
  }

  return { stop, down };
  }

  useEffect(() => { stop(); }, [options.pages, options.busy]);
  useEffect(() => stop, []);

  return { dragging, marker, ghost, down, active: () => !!drag.current, /** True once for the click that follows a drag. */ consumeClick: () => { const swallow = suppress.current; suppress.current = false; return swallow; } };
}
