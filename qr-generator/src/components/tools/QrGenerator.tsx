import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, ImagePlus, QrCode, X } from "lucide-react";
import { toast } from "@/shims/sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { saveFile } from "@/lib/desktop";
import { t as tNow, useT } from "@/lib/i18n";
import {
  QR_QUIET_ZONE,
  buildQrSvg,
  encodeQr,
  getLogoBox,
  type EncodedQr,
  type QrErrorCorrectionChoice,
} from "@/utils/qr";
import {
  buildEventPayload,
  buildGeoPayload,
  buildMailtoPayload,
  buildSmsPayload,
  buildTelPayload,
  buildVCardPayload,
  buildWifiPayload,
  type ContactFields,
  type EmailFields,
  type EventFields,
  type GeoFields,
  type PayloadResult,
  type SmsFields,
  type WifiFields,
  type WifiSecurity,
} from "@/utils/qr-payload";

const FAQ_KEYS = ["types", "level", "logoScan", "wifiEscape", "timeZone", "format", "privacy"] as const;

type Template = "text" | "wifi" | "contact" | "email" | "phone" | "sms" | "location" | "event";

const TEMPLATES: Template[] = ["text", "wifi", "contact", "email", "phone", "sms", "location", "event"];

const LEVEL_OPTIONS: Array<{ value: QrErrorCorrectionChoice; label: string }> = [
  { value: "auto", label: "" },
  { value: "L", label: "L · 7%" },
  { value: "M", label: "M · 15%" },
  { value: "Q", label: "Q · 25%" },
  { value: "H", label: "H · 30%" },
];

interface Logo {
  name: string;
  dataUrl: string;
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const canvasToPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
  );

/** Draws the code on the canvas. Module edges are rounded to whole pixels, so no seams show. */
function drawQr(canvas: HTMLCanvasElement, matrix: boolean[][], size: number, logo: HTMLImageElement | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const count = matrix.length;
  const unit = size / (count + QR_QUIET_ZONE * 2);
  const edge = (modules: number) => Math.round((modules + QR_QUIET_ZONE) * unit);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect(edge(x), edge(y), edge(x + 1) - edge(x), edge(y + 1) - edge(y));
    }),
  );

  if (!logo) return;
  const box = getLogoBox(count);
  const start = edge(box.start);
  const end = edge(box.start + box.size);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(start, start, end - start, end - start);
  // Keep half a module of white around the logo and keep its aspect ratio.
  const room = end - start - unit;
  const scale = Math.min(room / (logo.naturalWidth || 1), room / (logo.naturalHeight || 1));
  const width = (logo.naturalWidth || 1) * scale;
  const height = (logo.naturalHeight || 1) * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(logo, start + (end - start - width) / 2, start + (end - start - height) / 2, width, height);
}

function Field({ id, label, wide, children }: { id: string; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid content-start gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

const inputProps = { className: "h-8 text-sm", autoComplete: "off", spellCheck: false } as const;

export function QrGenerator() {
  const t = useT();
  const [template, setTemplate] = useState<Template>("text");
  const [text, setText] = useState("");
  const [wifi, setWifi] = useState<WifiFields>({ ssid: "", password: "", security: "WPA", hidden: false });
  const [contact, setContact] = useState<ContactFields>({
    firstName: "", lastName: "", organization: "", title: "", phone: "", email: "", website: "", address: "", note: "",
  });
  const [email, setEmail] = useState<EmailFields>({ to: "", subject: "", body: "" });
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState<SmsFields>({ number: "", message: "" });
  const [geo, setGeo] = useState<GeoFields>({ latitude: "", longitude: "" });
  const [event, setEvent] = useState<EventFields>({ title: "", start: "", end: "", allDay: false, location: "", description: "" });
  const [level, setLevel] = useState<QrErrorCorrectionChoice>("auto");
  const [size, setSize] = useState(512);
  const [logo, setLogo] = useState<Logo | null>(null);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [logoError, setLogoError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const templateTitle = t(`template.${template}.title`);
  const templateHint = t(`template.${template}.hint`);
  const faqItems = FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }));

  const result: PayloadResult = useMemo(() => {
    switch (template) {
      case "wifi": return { payload: buildWifiPayload(wifi) };
      case "contact": return { payload: buildVCardPayload(contact) };
      case "email": return { payload: buildMailtoPayload(email) };
      case "phone": return { payload: buildTelPayload(phone) };
      case "sms": return { payload: buildSmsPayload(sms) };
      case "location": return buildGeoPayload(geo);
      case "event": return buildEventPayload(event);
      default: return { payload: text };
    }
  }, [template, text, wifi, contact, email, phone, sms, geo, event, t]);

  const payload = useDebouncedValue(result.payload);
  const hasLogo = Boolean(logo);

  const encoded = useMemo((): { qr: EncodedQr | null; tooLong: boolean } => {
    if (!payload) return { qr: null, tooLong: false };
    try {
      return { qr: encodeQr(payload, level, hasLogo), tooLong: false };
    } catch {
      return { qr: null, tooLong: true };
    }
  }, [payload, level, hasLogo]);
  const qr = encoded.qr;

  useEffect(() => {
    if (qr && canvasRef.current) drawQr(canvasRef.current, qr.matrix, size, logoImage);
  }, [qr, size, logoImage]);

  useEffect(() => {
    if (!logo) {
      setLogoImage(null);
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setLogoImage(image);
    };
    image.onerror = () => {
      if (!active) return;
      setLogo(null);
      setLogoError(tNow("error.logoUnusable"));
    };
    image.src = logo.dataUrl;
    return () => {
      active = false;
    };
  }, [logo]);

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError(t("error.logoNotImage"));
      return;
    }
    try {
      setLogo({ name: file.name, dataUrl: await readDataUrl(file) });
      setLogoError("");
    } catch {
      setLogoError(t("error.logoRead"));
    }
  };

  const savePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let blob: Blob;
    try {
      blob = await canvasToPng(canvas);
    } catch {
      toast.error(t("toast.imageFailed"));
      return;
    }
    try {
      if (await saveFile(blob, `qr-code-${Date.now()}.png`)) toast.success(t("toast.saved"));
    } catch (error) {
      console.error("Failed to save QR code:", error);
      toast.error(t("toast.saveFailed"));
    }
  };

  const saveSvg = async () => {
    if (!qr) return;
    const svg = buildQrSvg(qr.matrix, { size, logo: logo?.dataUrl });
    try {
      if (await saveFile(new Blob([svg], { type: "image/svg+xml" }), `qr-code-${Date.now()}.svg`)) toast.success(t("toast.saved"));
    } catch (error) {
      console.error("Failed to save QR code:", error);
      toast.error(t("toast.saveFailed"));
    }
  };

  const wifiField = (key: "ssid" | "password", value: string) => setWifi((state) => ({ ...state, [key]: value }));
  const contactInput = (key: keyof ContactFields, label: string, type = "text", wide = false) => (
    <Field id={`qr-contact-${key}`} label={label} wide={wide}>
      <Input id={`qr-contact-${key}`} type={type} {...inputProps} value={contact[key]}
        onChange={(e) => setContact((state) => ({ ...state, [key]: e.target.value }))} />
    </Field>
  );

  const setAllDay = (allDay: boolean) =>
    setEvent((state) => {
      const convert = (value: string, time: string) =>
        !value ? value : allDay ? value.split("T")[0] : value.includes("T") ? value : `${value}T${time}`;
      return { ...state, allDay, start: convert(state.start, "09:00"), end: convert(state.end, "10:00") };
    });

  const form = () => {
    switch (template) {
      case "wifi":
        return (
          <>
            <Field id="qr-wifi-ssid" label={t("field.ssid")}>
              <Input id="qr-wifi-ssid" {...inputProps} value={wifi.ssid} onChange={(e) => wifiField("ssid", e.target.value)} />
            </Field>
            <Field id="qr-wifi-security" label={t("field.security")}>
              <select id="qr-wifi-security" className="h-8 rounded-md border border-input bg-background px-2 pe-7 text-sm" value={wifi.security}
                onChange={(e) => setWifi((state) => ({ ...state, security: e.target.value as WifiSecurity }))}>
                <option value="WPA">{t("security.wpa")}</option>
                <option value="WEP">WEP</option>
                <option value="nopass">{t("security.none")}</option>
              </select>
            </Field>
            {wifi.security !== "nopass" && (
              <Field id="qr-wifi-password" label={t("field.password")}>
                <Input id="qr-wifi-password" {...inputProps} value={wifi.password} onChange={(e) => wifiField("password", e.target.value)} />
              </Field>
            )}
            <div className="flex items-end pb-1.5">
              <label className="option-switch" htmlFor="qr-wifi-hidden">
                {t("option.hidden")}
                <Switch id="qr-wifi-hidden" checked={wifi.hidden} onCheckedChange={(hidden) => setWifi((state) => ({ ...state, hidden }))} />
              </label>
            </div>
          </>
        );
      case "contact":
        return (
          <>
            {contactInput("firstName", t("field.firstName"))}
            {contactInput("lastName", t("field.lastName"))}
            {contactInput("organization", t("field.organization"))}
            {contactInput("title", t("field.jobTitle"))}
            {contactInput("phone", t("field.phone"), "tel")}
            {contactInput("email", t("field.email"), "email")}
            {contactInput("website", t("field.website"), "url", true)}
            {contactInput("address", t("field.address"), "text", true)}
            {contactInput("note", t("field.note"), "text", true)}
          </>
        );
      case "email":
        return (
          <>
            <Field id="qr-email-to" label={t("field.to")} wide>
              <Input id="qr-email-to" type="email" multiple dir="ltr" {...inputProps} placeholder="name@example.com" value={email.to}
                onChange={(e) => setEmail((state) => ({ ...state, to: e.target.value }))} />
            </Field>
            <Field id="qr-email-subject" label={t("field.subject")} wide>
              <Input id="qr-email-subject" {...inputProps} value={email.subject}
                onChange={(e) => setEmail((state) => ({ ...state, subject: e.target.value }))} />
            </Field>
            <Field id="qr-email-body" label={t("field.body")} wide>
              <Textarea id="qr-email-body" className="text-sm" value={email.body}
                onChange={(e) => setEmail((state) => ({ ...state, body: e.target.value }))} />
            </Field>
          </>
        );
      case "phone":
        return (
          <Field id="qr-phone" label={t("field.phoneNumber")}>
            <Input id="qr-phone" type="tel" dir="ltr" {...inputProps} placeholder="+1 555 0100" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        );
      case "sms":
        return (
          <>
            <Field id="qr-sms-number" label={t("field.phoneNumber")}>
              <Input id="qr-sms-number" type="tel" dir="ltr" {...inputProps} placeholder="+1 555 0100" value={sms.number}
                onChange={(e) => setSms((state) => ({ ...state, number: e.target.value }))} />
            </Field>
            <Field id="qr-sms-message" label={t("field.message")} wide>
              <Textarea id="qr-sms-message" className="text-sm" value={sms.message}
                onChange={(e) => setSms((state) => ({ ...state, message: e.target.value }))} />
            </Field>
          </>
        );
      case "location":
        return (
          <>
            <Field id="qr-geo-latitude" label={t("field.latitude")}>
              <Input id="qr-geo-latitude" inputMode="decimal" dir="ltr" {...inputProps} placeholder="52.5200" value={geo.latitude}
                onChange={(e) => setGeo((state) => ({ ...state, latitude: e.target.value }))} />
            </Field>
            <Field id="qr-geo-longitude" label={t("field.longitude")}>
              <Input id="qr-geo-longitude" inputMode="decimal" dir="ltr" {...inputProps} placeholder="13.4050" value={geo.longitude}
                onChange={(e) => setGeo((state) => ({ ...state, longitude: e.target.value }))} />
            </Field>
          </>
        );
      case "event":
        return (
          <>
            <Field id="qr-event-title" label={t("field.title")} wide>
              <Input id="qr-event-title" {...inputProps} value={event.title}
                onChange={(e) => setEvent((state) => ({ ...state, title: e.target.value }))} />
            </Field>
            <Field id="qr-event-start" label={t("field.start")}>
              <Input id="qr-event-start" type={event.allDay ? "date" : "datetime-local"} className="h-8 text-sm" value={event.start}
                onChange={(e) => setEvent((state) => ({ ...state, start: e.target.value }))} />
            </Field>
            <Field id="qr-event-end" label={t("field.end")}>
              <Input id="qr-event-end" type={event.allDay ? "date" : "datetime-local"} className="h-8 text-sm" value={event.end}
                onChange={(e) => setEvent((state) => ({ ...state, end: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <label className="option-switch" htmlFor="qr-event-all-day">
                {t("option.allDay")}
                <Switch id="qr-event-all-day" checked={event.allDay} onCheckedChange={setAllDay} />
              </label>
            </div>
            <Field id="qr-event-location" label={t("field.location")} wide>
              <Input id="qr-event-location" {...inputProps} value={event.location}
                onChange={(e) => setEvent((state) => ({ ...state, location: e.target.value }))} />
            </Field>
            <Field id="qr-event-description" label={t("field.description")} wide>
              <Textarea id="qr-event-description" className="text-sm" value={event.description}
                onChange={(e) => setEvent((state) => ({ ...state, description: e.target.value }))} />
            </Field>
          </>
        );
      default:
        return null;
    }
  };

  const lowLevelWithLogo = hasLogo && (level === "L" || level === "M");
  const notice = result.error ? (
    <div className="workspace-notice" data-tone="error" role="alert">{result.error}</div>
  ) : encoded.tooLong ? (
    <div className="workspace-notice" data-tone="error" role="alert">
      {level === "auto" ? t("notice.tooLongAuto") : level === "L" ? t("notice.tooLongLevel", { level }) : t("notice.tooLongLower", { level })}
    </div>
  ) : logoError ? (
    <div className="workspace-notice" data-tone="error" role="alert">{logoError}</div>
  ) : lowLevelWithLogo ? (
    <div className="workspace-notice" role="status">{t("notice.logoLowLevel")}</div>
  ) : undefined;

  const bytes = useMemo(() => new TextEncoder().encode(payload).length, [payload]);
  const autoLevel = level === "auto" && qr ? qr.level : hasLogo ? "H" : "M";

  return (
    <ToolWorkspace
      id="qr-generator"
      toolbar={
        <>
          <Tabs value={template} onValueChange={(value) => setTemplate(value as Template)}>
            <TabsList aria-label={t("tabs.aria")}>
              {TEMPLATES.map((item) => (
                <TabsTrigger key={item} value={item}>{t(`template.${item}.label`)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <label className="indent-control">
            {t("level.label")}
            <select aria-label={t("level.label")} value={level} onChange={(e) => setLevel(e.target.value as QrErrorCorrectionChoice)}>
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "auto" ? t("level.auto", { level: autoLevel }) : option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      notice={notice}
      first={
        template === "text" ? (
          <EditorPane title={templateTitle} htmlFor="qr-text" scroll={false}>
            <CodeTextarea id="qr-text" placeholder="https://example.com" value={text} onChange={(e) => setText(e.target.value)} />
          </EditorPane>
        ) : (
          <EditorPane title={templateTitle}>
            <div className="grid gap-3 p-4 sm:grid-cols-2">{form()}</div>
            <div className="grid gap-1.5 border-t px-4 py-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="qr-payload" className="text-xs font-medium">{t("payload.label")}</Label>
                <CopyButton value={result.payload} label={t("copy.payload")} />
              </div>
              <textarea
                id="qr-payload"
                readOnly
                rows={Math.min(Math.max(result.payload.split("\n").length, 2), 12)}
                placeholder={templateHint}
                value={result.payload}
                dir="ltr"
                spellCheck={false}
                className="w-full resize-none rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs"
              />
            </div>
          </EditorPane>
        )
      }
      second={
        <EditorPane
          title={t("pane.qr")}
          actions={
            qr ? (
              <>
                <button type="button" className="toolbar-text-button" onClick={savePng}>
                  <Download size={14} aria-hidden="true" />
                  {t("action.savePng")}
                </button>
                <button type="button" className="toolbar-text-button" onClick={saveSvg}>
                  <Download size={14} aria-hidden="true" />
                  {t("action.saveSvg")}
                </button>
              </>
            ) : undefined
          }
        >
          <div className="pane-options">
            <span className="font-medium">{t("size.label")}</span>
            <Slider className="min-w-32 flex-1" value={[size]} onValueChange={([value]) => setSize(value)}
              min={128} max={1024} step={64} aria-label={t("size.label")} />
            <span className="w-24 text-muted-foreground">{size} × {size} px</span>
          </div>
          <div className="pane-options">
            <span className="font-medium">{t("logo.label")}</span>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="qr-logo-input"
              onChange={(e) => {
                void chooseLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {logo ? (
              <>
                <span className="min-w-0 truncate text-muted-foreground">{logo.name}</span>
                <button type="button" className="toolbar-text-button" onClick={() => setLogo(null)}>
                  <X size={14} aria-hidden="true" />
                  {t("logo.remove")}
                </button>
              </>
            ) : (
              <button type="button" className="toolbar-text-button" onClick={() => logoInputRef.current?.click()}>
                <ImagePlus size={14} aria-hidden="true" />
                {t("logo.add")}
              </button>
            )}
          </div>
          {qr ? (
            <div className="flex justify-center p-6">
              <canvas
                ref={canvasRef}
                width={size}
                height={size}
                role="img"
                aria-label={t("preview.alt")}
                className="h-auto w-full max-w-[320px] rounded-md border border-border"
              />
            </div>
          ) : (
            <PaneEmpty icon={<QrCode size={22} aria-hidden="true" />} title={t("empty.title")} hint={templateHint} />
          )}
        </EditorPane>
      }
      status={
        qr ? (
          <>
            <span>{t("status.version", { version: qr.version, size: qr.matrix.length })}</span>
            <span>{t("status.level", { level: qr.level })}</span>
            <span>{t("unit.bytes", { count: bytes })}</span>
          </>
        ) : encoded.tooLong ? (
          <span className="text-destructive">{t("status.tooLong", { size: t("unit.bytes", { count: bytes }) })}</span>
        ) : (
          <span>{t("status.ready")}</span>
        )
      }
      help={<ToolFaqSection items={faqItems} />}
    />
  );
}
