import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Moon, RotateCw, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useLocale, useT, type TKey } from "@/lib/i18n";
import { buildPreviewDocument, previewSandbox } from "@/utils/html-preview";

type Canvas = "light" | "dark";

/** A frame size in CSS pixels. A null side fills the pane. */
interface FrameSize {
  width: number | null;
  height: number | null;
}

interface Device {
  id: string;
  /** A product name, shown as it is. */
  label?: string;
  /** A generic name, translated. */
  labelKey?: TKey;
  width: number;
  height: number;
}

/** CSS viewport sizes in portrait. */
const DEVICE_GROUPS: { key: TKey; devices: Device[] }[] = [
  {
    key: "device.mobile",
    devices: [
      { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
      { id: "iphone-16", label: "iPhone 16", width: 393, height: 852 },
      { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", width: 440, height: 956 },
      { id: "pixel-9", label: "Pixel 9", width: 412, height: 923 },
      { id: "galaxy-s24", label: "Galaxy S24", width: 360, height: 780 },
    ],
  },
  {
    key: "device.tablet",
    devices: [
      { id: "ipad-mini", label: "iPad Mini", width: 768, height: 1024 },
      { id: "ipad-air", label: "iPad Air", width: 820, height: 1180 },
      { id: "ipad-pro-13", label: "iPad Pro 13", width: 1032, height: 1376 },
    ],
  },
  {
    key: "device.desktop",
    devices: [
      { id: "laptop", labelKey: "device.laptop", width: 1280, height: 800 },
      { id: "desktop", labelKey: "device.desktop", width: 1440, height: 900 },
      { id: "full-hd", labelKey: "device.fullHd", width: 1920, height: 1080 },
    ],
  },
];

const DEVICES = DEVICE_GROUPS.flatMap((group) => group.devices);

const ZOOMS = [50, 75, 100, 125, 150, 200];

/** The size limits for the width and height fields and the frame handle. */
const MIN_SIZE = 200;
const MAX_SIZE = 3840;

const clampSize = (value: number) => Math.round(Math.max(MIN_SIZE, Math.min(value, MAX_SIZE)));

/** The device that has this size in either orientation, if any. */
const matchDevice = ({ width, height }: FrameSize) =>
  DEVICES.find((d) => (d.width === width && d.height === height) || (d.width === height && d.height === width));

const FAQ_KEYS = ["remote", "scripts", "links", "size", "scale", "browser"] as const;

/** The sample document of the editor: the style is code, the heading and the sentence are translated. */
const placeholderHtml = (heading: string, text: string) => `<style>\n  h1 { font-family: system-ui; color: teal; }\n</style>\n<h1>${heading}</h1>\n<p>${text}</p>`;

interface DeviceBarProps {
  size: FrameSize;
  zoom: number | null;
  onSize: (size: FrameSize) => void;
  onZoom: (zoom: number | null) => void;
}

/** Device, size, rotation, and zoom controls for the preview frame. */
function DeviceBar({ size, zoom, onSize, onZoom }: DeviceBarProps) {
  const t = useT();
  const device = matchDevice(size);
  const responsive = size.width === null && size.height === null;
  const sizeField = (side: keyof FrameSize, label: string) => (
    <input
      type="number"
      aria-label={label}
      min={MIN_SIZE}
      max={MAX_SIZE}
      placeholder={t("size.auto")}
      value={size[side] ?? ""}
      onChange={(e) => onSize({ ...size, [side]: e.target.value === "" ? null : Math.min(Number(e.target.value), MAX_SIZE) })}
      onBlur={() => size[side] !== null && onSize({ ...size, [side]: clampSize(size[side]) })}
    />
  );

  return (
    <div className="html-preview-devicebar">
      <select
        aria-label={t("device.label")}
        value={device?.id ?? (responsive ? "responsive" : "custom")}
        onChange={(e) => {
          const next = DEVICES.find((d) => d.id === e.target.value);
          onSize(next ? { width: next.width, height: next.height } : { width: null, height: null });
        }}
      >
        <option value="responsive">{t("device.responsive")}</option>
        {!device && !responsive && <option value="custom">{t("device.custom")}</option>}
        {DEVICE_GROUPS.map((group) => (
          <optgroup key={group.key} label={t(group.key)}>
            {group.devices.map((d) => (
              <option key={d.id} value={d.id}>{d.labelKey ? t(d.labelKey) : d.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {sizeField("width", t("size.width"))}
      <span aria-hidden="true">×</span>
      {sizeField("height", t("size.height"))}
      <button
        type="button"
        className="toolbar-text-button"
        aria-label={t("size.rotate")}
        title={t("size.swap")}
        disabled={size.width === null || size.height === null}
        onClick={() => onSize({ width: size.height, height: size.width })}
      >
        <RotateCw size={14} aria-hidden="true" />
      </button>
      <select aria-label={t("zoom.label")} value={zoom ?? "fit"} onChange={(e) => onZoom(e.target.value === "fit" ? null : Number(e.target.value))}>
        <option value="fit">{t("zoom.fit")}</option>
        {ZOOMS.map((z) => (
          <option key={z} value={z}>{z}%</option>
        ))}
      </select>
    </div>
  );
}

export function HtmlPreview() {
  const t = useT();
  const { dir } = useLocale();
  // The width handle sits at the end edge of the frame, so in a right-to-left page it is on the left
  const handleSign = dir === "rtl" ? -1 : 1;
  const [input, setInput] = useState("");
  const [scripts, setScripts] = useState(false);
  const [size, setSize] = useState<FrameSize>({ width: null, height: null });
  const [zoom, setZoom] = useState<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [canvas, setCanvas] = useState<Canvas>("light");
  const [fullScreen, setFullScreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, width: 0 });
  const html = useDebouncedValue(input, 300);

  const placeholder = placeholderHtml(t("placeholder.heading"), t("placeholder.text"));

  const srcDoc = useMemo(
    () => (html.trim() ? buildPreviewDocument(html, { scripts, dark: canvas === "dark" }) : ""),
    [html, scripts, canvas],
  );

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  // The stage is remounted when full screen opens or closes, so measure whichever one is shown
  const hasPreview = Boolean(srcDoc);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setStageSize({ width: stage.clientWidth, height: stage.clientHeight }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [hasPreview, fullScreen]);

  const { width, height } = size;
  // Fit to pane scales a fixed size down to the space beside the handle and inside the padding
  const fitScale = Math.min(
    1,
    width && stageSize.width ? (stageSize.width - 12 - 24) / width : 1,
    height && stageSize.height ? (stageSize.height - 24) / height : 1,
  );
  const scale = zoom ? zoom / 100 : Math.max(fitScale, 0.1);

  // The frame's CSS width, measured when it fills the pane
  const currentWidth = () => width ?? (frameRef.current?.getBoundingClientRect().width ?? MIN_SIZE) / scale;

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: currentWidth() };
    setDragging(true);
  };

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // The frame is centered, so each edge moves by half of the change
    setSize({ width: clampSize(dragStart.current.width + (handleSign * (e.clientX - dragStart.current.x) * 2) / scale), height });
  };

  const resizeWithKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft") setSize({ width: clampSize(currentWidth() - handleSign * step), height });
    else if (e.key === "ArrowRight") setSize({ width: clampSize(currentWidth() + handleSign * step), height });
    else return;
    e.preventDefault();
  };

  const stage = srcDoc ? (
    <div ref={stageRef} className="html-preview-stage" data-fixed-height={height ? true : undefined}>
      {/* The box takes the scaled size, and the frame inside keeps the CSS size */}
      <div
        ref={frameRef}
        className="html-preview-frame"
        style={{
          width: width ? `${width * scale}px` : undefined,
          height: height ? `${height * scale}px` : undefined,
          flex: width ? "none" : 1,
        }}
      >
        <iframe
          // A new frame applies the sandbox flags when scripts are turned on or off
          key={scripts ? "scripts" : "static"}
          title={t("frame.title")}
          sandbox={previewSandbox(scripts)}
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          className="bg-background"
          style={{
            width: width ? `${width}px` : `${100 / scale}%`,
            height: height ? `${height}px` : `${100 / scale}%`,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            pointerEvents: dragging ? "none" : undefined,
          }}
        />
      </div>
      <div
        className="html-preview-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("handle.label")}
        aria-valuenow={width ?? undefined}
        aria-valuemin={MIN_SIZE}
        aria-valuemax={MAX_SIZE}
        tabIndex={0}
        data-active={dragging || undefined}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => setSize({ width: null, height: null })}
        onKeyDown={resizeWithKeys}
        title={t("handle.title")}
      />
    </div>
  ) : (
    <PaneEmpty title={t("empty.title")} hint={t("empty.hint")} />
  );

  const sizeLabel = width || height ? `${width ?? t("size.auto")} × ${height ?? t("size.auto")}` : t("status.fills");
  const deviceBar = <DeviceBar size={size} zoom={zoom} onSize={setSize} onZoom={setZoom} />;

  return (
    <ToolWorkspace
      id="html-preview"
      toolbar={
        <>
          <div className="layout-switch" role="group" aria-label={t("canvas.group")}>
            <button type="button" aria-pressed={canvas === "light"} onClick={() => setCanvas("light")}>
              <Sun size={14} aria-hidden="true" />
              {t("canvas.light")}
            </button>
            <button type="button" aria-pressed={canvas === "dark"} onClick={() => setCanvas("dark")}>
              <Moon size={14} aria-hidden="true" />
              {t("canvas.dark")}
            </button>
          </div>
          <label className="option-switch indent-control" htmlFor="html-preview-scripts">
            {t("option.scripts")}
            <Switch id="html-preview-scripts" checked={scripts} onCheckedChange={setScripts} aria-describedby="html-preview-isolation" />
          </label>
        </>
      }
      notice={
        <p className="workspace-notice text-muted-foreground" id="html-preview-isolation">
          {t(scripts ? "notice.scriptsOn" : "notice.scriptsOff")}
        </p>
      }
      first={
        <EditorPane
          title="HTML"
          htmlFor="html-preview-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea id="html-preview-input" wrap="off" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("pane.preview")}
          scroll={false}
          actions={
            <button type="button" className="toolbar-text-button" onClick={() => setFullScreen(true)} disabled={!srcDoc}>
              <Maximize2 size={13} aria-hidden="true" />
              {t("action.fullScreen")}
            </button>
          }
        >
          {srcDoc && !fullScreen && deviceBar}
          {fullScreen ? <PaneEmpty title={t("empty.fullTitle")} hint={t("empty.fullHint")} /> : stage}
          {fullScreen &&
            createPortal(
              <div className="html-preview-full" role="dialog" aria-modal="true" aria-label={t("frame.fullTitle")}>
                <div className="editor-toolbar">
                  <div className="toolbar-actions ms-auto">{deviceBar}</div>
                  <button type="button" className="toolbar-text-button" onClick={() => setFullScreen(false)} autoFocus>
                    <Minimize2 size={13} aria-hidden="true" />
                    {t("action.exitFullScreen")}
                  </button>
                </div>
                {stage}
              </div>,
              document.body,
            )}
        </EditorPane>
      }
      status={
        <>
          <span>{sizeLabel}</span>
          <span>{Math.round(scale * 100)}%</span>
          <span>{t(scripts ? "status.scriptsOn" : "status.scriptsOff")}</span>
          <span>{t("status.networkBlocked")}</span>
        </>
      }
      help={<ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />}
    />
  );
}
