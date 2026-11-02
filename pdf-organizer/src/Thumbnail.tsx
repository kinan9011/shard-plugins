import { useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import { useToolActive } from "./hooks/useToolActive";
import type { Page, Source } from "./pdf/engine";
import { previewDocument } from "./pdf/preview";

export function Thumbnail({ source, page }: { source: Source; page: Page }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState("");
  const active = useToolActive();
  useEffect(() => {
    const canvas = ref.current!;
    const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { rootMargin: "150px" });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !active) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setError("");
    void previewDocument(source).then(document => document.getPage(page.index + 1)).then(pdfPage => {
      if (cancelled) return;
      const canvas = ref.current!;
      const original = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate + page.rotation });
      const viewport = pdfPage.getViewport({ scale: Math.min(220 / original.width, 260 / original.height), rotation: pdfPage.rotate + page.rotation });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvas, viewport });
      return task.promise;
    }).catch(error => { if (!cancelled) setError(`Preview unavailable: ${error instanceof Error ? error.message : "unsupported page"}`); });
    return () => { cancelled = true; task?.cancel(); };
  }, [source, page.index, page.rotation, near, active]);
  return <div className="thumbnail"><canvas ref={ref} role="img" aria-label={`${source.name}, original page ${page.index + 1}`} />{error && <p role="status">{error}</p>}</div>;
}
