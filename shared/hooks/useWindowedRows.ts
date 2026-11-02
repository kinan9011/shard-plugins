import { useEffect, useRef, useState } from "react";

const BLOCK = 20; // rows; the range only moves in steps of this, so a scroll event rarely re-renders
const OVERSCAN = 40;

/**
 * Which rows of a fixed-height list to render inside a scrolling element (`ref`). Off, it returns every row.
 * Pad the list with `first * rowHeight` above and `(count - last) * rowHeight` below.
 */
export function useWindowedRows(count: number, rowHeight: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: OVERSCAN * 3 });

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const read = () => {
      // No layout (jsdom, a hidden tab): assume a tall viewport rather than render nothing.
      const height = el.clientHeight || 1000;
      const first = Math.floor(Math.max(0, Math.floor(el.scrollTop / rowHeight) - OVERSCAN) / BLOCK) * BLOCK;
      const last = first + Math.ceil(height / rowHeight) + OVERSCAN * 2 + BLOCK;
      setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      observer?.disconnect();
    };
  }, [enabled, rowHeight, count]);

  return enabled ? { ref, first: Math.min(range.first, count), last: Math.min(range.last, count) } : { ref, first: 0, last: count };
}
