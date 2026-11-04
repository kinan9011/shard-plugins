import { useEffect, useRef, useState } from "react";
import { AnnotationMode, getDocument, PDFWorker, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { spawnWorker } from "./shard-sdk";
import { useT } from "./lib/i18n";
import type { Field } from "./pdf/engine";

export default function Preview({ bytes, page, fields, selected, onSelect, zoom }: { bytes: Uint8Array; page: number; fields: Field[]; selected: string; onSelect: (field: Field) => void; zoom: number }) {
  const t = useT(), viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [width, setWidth] = useState(600), [failed, setFailed] = useState(false);
  const [boxes, setBoxes] = useState<{ field: Field; x: number; y: number; width: number; height: number }[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 }), [rendered, setRendered] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, entry.contentRect.width - 32)));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, worker: Worker | undefined, pdfWorker: PDFWorker | undefined;
    let task: ReturnType<typeof getDocument> | undefined;
    setPdf(null); setFailed(false); setRendered(false); setBoxes([]);
    void (async () => {
      worker = await spawnWorker("./pdf-preview.js");
      if (disposed) { worker.terminate(); return; }
      pdfWorker = PDFWorker.create({ port: worker });
      task = getDocument({ data: bytes.slice(), worker: pdfWorker, isEvalSupported: false, useWasm: false, isImageDecoderSupported: false, useWorkerFetch: false, maxImageSize: 32_000_000,
        cMapUrl: new URL("./pdf-assets/cmaps/", location.href).href, cMapPacked: true, standardFontDataUrl: new URL("./pdf-assets/standard_fonts/", location.href).href });
      const loaded = await task.promise;
      if (!disposed) setPdf(loaded);
    })().catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; void task?.destroy().catch(() => {}); pdfWorker?.destroy(); worker?.terminate(); };
  }, [bytes]);
  useEffect(() => {
    let disposed = false, task: RenderTask | undefined;
    setRendered(false); setBoxes([]);
    if (!pdf) return;
    void (async () => {
      const sheet = await pdf.getPage(page);
      if (disposed || !canvas.current) return;
      const natural = sheet.getViewport({ scale: 1 });
      const view = sheet.getViewport({ scale: Math.min(width / natural.width, 1.7) * zoom });
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (view.width * view.height)));
      canvas.current.width = Math.ceil(view.width * ratio); canvas.current.height = Math.ceil(view.height * ratio);
      setSize({ width: view.width, height: view.height });
      task = sheet.render({ canvas: canvas.current, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: AnnotationMode.ENABLE });
      await task.promise;
      if (disposed) return;
      setBoxes(fields.flatMap(field => field.widgets.filter(widget => widget.page === page).map(widget => {
        const [x1, y1, x2, y2] = view.convertToViewportRectangle(widget.rect);
        return { field, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      })));
      setRendered(true);
    })().catch(error => { if (!disposed && error?.name !== "RenderingCancelledException") setFailed(true); });
    return () => { disposed = true; task?.cancel(); };
  }, [pdf, page, width, zoom, fields]);
  return <div className="preview-scroll" ref={viewport} aria-label={t("preview")}>
    {failed ? <p className="preview-message" role="alert">{t("preview.error")}</p> : <>
      {!rendered && <p className="preview-message" role="status">{t("preview.loading")}</p>}
      <div className="pdf-sheet" style={{ width: size.width, height: size.height, visibility: rendered ? "visible" : "hidden" }}>
        <canvas ref={canvas} style={{ width: size.width, height: size.height }} aria-label={t("field.page", { n: page })} />
        {boxes.map((box, i) => <button key={i} type="button" className={`widget-target${selected === box.field.name ? " selected" : ""}`} aria-label={t("preview.jump", { name: box.field.name })}
          title={box.field.name} onClick={() => onSelect(box.field)} style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />)}
      </div>
    </>}
  </div>;
}
