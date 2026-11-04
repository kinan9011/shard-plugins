import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export type MenuItem = { id: string; label: string; keys?: string; disabled?: boolean; run: () => void } | "separator";

/** One popup used for both the ☰ button and right-click. Closes on Escape, outside press, Tab or after running an item. */
export function Menu({ items, x, y, label, onClose }: { items: MenuItem[]; x: number; y: number; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Clamp after measuring so a menu opened near an edge stays fully visible.
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, innerWidth - box.width - 4)), top: Math.max(4, Math.min(y, innerHeight - box.height - 4)) });
    ref.current!.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [x, y]);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose); };
  }, [onClose]);

  function keyDown(event: KeyboardEvent) {
    const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); buttons[(to + buttons.length) % buttons.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === "Tab") { event.preventDefault(); onClose(); }
  }

  return <div ref={ref} className="menu" role="menu" aria-label={label} style={position} onKeyDown={keyDown} onContextMenu={event => event.preventDefault()}>
    {items.map((item, index) => item === "separator" ? <hr key={index} role="separator" /> :
      <button key={item.id} type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.run(); }}>
        <span>{item.label}</span>{item.keys && <kbd dir="ltr">{item.keys}</kbd>}
      </button>)}
  </div>;
}
