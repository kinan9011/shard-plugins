import { createContext, useContext, useEffect, useRef, useState, type RefObject } from "react";
import type { RenderTask } from "pdfjs-dist";
import { useToolActive } from "./hooks/useToolActive";
import type { Page, Source } from "./pdf/engine";
import { previewDocument } from "./pdf/preview";
import { noCrop, turnCrop } from "./pdf/geometry";
import { t, useT } from "@/lib/i18n";

/** The scrolling grid. Lazy rendering measures against it so the look-ahead margin applies inside the scroller. */
export const ScrollRoot = createContext<RefObject<HTMLElement> | null>(null);
/** Page boxes are A4-ish tall; the thumbnail box is `size` wide and this much taller. */
export const ASPECT = 1.41;

/** Renders one page to fit a `size`-px-wide box. Re-renders sharply after a short pause when `size` changes. */
export function Thumbnail({ source, page, size }: { source: Source; page: Page; size: number }) {
  const translate = useT();
  const ref = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const root = useContext(ScrollRoot);
  const [near, setNear] = useState(false);
  const [error, setError] = useState("");
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [renderSize, setRenderSize] = useState(size);
  const active = useToolActive();
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { root: root?.current ?? null, rootMargin: "300px" });
    observer.observe(ref.current!);
    const resize = () => setPixelRatio(window.devicePixelRatio || 1);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [root]);
  // Dragging the zoom slider changes `size` constantly; only the settled value is worth a PDF.js render.
  useEffect(() => {
    if (size === renderSize) return;
    const timer = setTimeout(() => setRenderSize(size), 150);
    return () => clearTimeout(timer);
  }, [size, renderSize]);
  useEffect(() => {
    setError("");
    if (!near || !active) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    // Each render owns its canvas so cancelled PDF.js work cannot paint a newer preview.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("grid.sourceTitle", { name: source.name, n: page.index + 1 }));
    canvas.width = canvas.height = 0;
    surface.current!.replaceChildren(canvas);
    void previewDocument(source).then(document => cancelled ? undefined : document.getPage(page.index + 1)).then(pdfPage => {
      if (cancelled || !pdfPage) return;
      const rotation = pdfPage.rotate + page.rotation;
      const original = pdfPage.getViewport({ scale: 1, rotation });
      // The crop is stored for rotation 0; show it the way the page is currently turned.
      const [cropLeft, cropTop, cropRight, cropBottom] = turnCrop(page.crop ?? noCrop, page.rotation / 90);
      const shownWidth = original.width * (1 - cropLeft - cropRight), shownHeight = original.height * (1 - cropTop - cropBottom);
      const boxWidth = renderSize, boxHeight = renderSize * ASPECT;
      const scale = Math.min(boxWidth / shownWidth, boxHeight / shownHeight);
      const fitted = { width: shownWidth * scale, height: shownHeight * scale };
      const ratio = Math.min(pixelRatio, 3, Math.sqrt(4_000_000 / (fitted.width * fitted.height)));
      const viewport = pdfPage.getViewport({ scale: scale * ratio, rotation, offsetX: -cropLeft * original.width * scale * ratio, offsetY: -cropTop * original.height * scale * ratio });
      canvas.width = Math.max(1, Math.floor(fitted.width * ratio)); canvas.height = Math.max(1, Math.floor(fitted.height * ratio));
      // Percent sizes keep the bitmap proportional to the box while a debounced re-render is pending.
      canvas.style.width = `${(fitted.width / boxWidth) * 100}%`; canvas.style.height = `${(fitted.height / boxHeight) * 100}%`;
      task = pdfPage.render({ canvas, viewport });
      return task.promise;
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : t("preview.unsupported")); });
    return () => {
      cancelled = true; task?.cancel(); canvas.remove();
      void (task?.promise ?? Promise.resolve()).catch(() => {}).then(() => { canvas.width = canvas.height = 0; });
    };
  }, [source, page.index, page.rotation, page.crop, renderSize, near, active, pixelRatio]);
  return <div ref={ref} className="thumbnail" style={{ width: size, height: Math.round(size * ASPECT) }}><div ref={surface} className="thumbnail-surface" />{error && <p role="status">{translate("preview.unavailable", { message: error })}</p>}</div>;
}
