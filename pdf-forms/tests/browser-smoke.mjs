// Real classic workers in an opaque-origin sandbox. Native Shard acceptance remains separate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";

const root = path.resolve("dist"), artifacts = path.resolve("artifacts");
await fs.mkdir(artifacts, { recursive: true });
const fixture = await PDFDocument.create(), sheet = fixture.addPage([500, 650]), second = fixture.addPage([500, 650]), form = fixture.getForm();
sheet.drawText("Registration form", { x: 40, y: 590, size: 23 });
for (const [label, y] of [["Full name", 550], ["Consent", 470], ["Country", 410], ["Plan: Basic / Plus", 340]]) sheet.drawText(label, { x: 40, y, size: 11 });
const nameField = form.createTextField("person.name"); nameField.enableRequired(); nameField.addToPage(sheet, { x: 40, y: 510, width: 280, height: 25 });
const consent = form.createCheckBox("consent"); consent.enableRequired(); consent.addToPage(sheet, { x: 40, y: 440, width: 18, height: 18 });
const country = form.createDropdown("country"); country.setOptions(["Germany", "France"]); country.select("Germany"); country.addToPage(sheet, { x: 40, y: 370, width: 230, height: 25 });
const plan = form.createRadioGroup("plan"); plan.addOptionToPage("Basic", sheet, { x: 40, y: 300, width: 18, height: 18 }); plan.addOptionToPage("Plus", sheet, { x: 140, y: 300, width: 18, height: 18 });
second.drawText("Your interests and notes", { x: 40, y: 590, size: 21 });
const interests = form.createOptionList("interests"); interests.setOptions(["Music", "Science", "Art"]); interests.enableMultiselect(); interests.addToPage(second, { x: 40, y: 430, width: 250, height: 90 });
const notes = form.createTextField("notes"); notes.enableMultiline(); notes.addToPage(second, { x: 40, y: 270, width: 350, height: 100 });
const reference = form.createTextField("reference"); reference.setText("REF-001"); reference.enableReadOnly(); reference.addToPage(second, { x: 40, y: 200, width: 200, height: 25 });
form.updateFieldAppearances(await fixture.embedFont(StandardFonts.Helvetica));
const inputBytes = Array.from(await fixture.save());
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>PDF Forms host test</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="PDF Forms" sandbox="allow-scripts" src="/index.html"></iframe><script>
window.saved=[];window.saveCalls=0;window.denied=false;window.cancelSave=false;
addEventListener('message',e=>{const m=e.data;if(!m?.id||!m.method)return;let result=null,error;
if(m.method==='ready')result={pluginId:'pdf-forms',visible:true,theme:{isDark:false,vars:{}},locale:{lang:'en',dir:'ltr'}};
if(m.method==='files.open')result=window.hostInput??null;
if(m.method==='files.save'){window.saveCalls++;if(window.denied)error={code:'permission_denied',message:'Denied',permission:'files:save'};else if(window.cancelSave)result=false;else{window.saved.push({name:m.params.name,bytes:typeof m.params.data==='string'?m.params.data:Array.from(m.params.data)});result=true;}}
const respond=()=>e.source.postMessage({v:m.v,id:m.id,result,error},'*');if(m.method==='files.save'&&window.holdSave){window.finishSave=respond;return;}respond();});</script></body></html>`;
const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/host.html") { response.setHeader("Content-Type", "text/html"); response.end(host); return; }
  const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  response.setHeader("Content-Type", ({ ".js": "text/javascript", ".html": "text/html", ".css": "text/css" })[path.extname(file)] ?? "application/octet-stream");
  try { response.end(await fs.readFile(file)); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const failures = [], outbound = [], missing = [];
  async function session(viewport, options = {}) {
    const context = await browser.newContext({ viewport, ...options }), page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", e => failures.push(e.message));
    page.on("request", r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin)) outbound.push(r.url()); });
    page.on("response", r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${origin}/host.html`);
    const tool = page.frameLocator("iframe");
    await tool.getByRole("button", { name: "Open PDF", exact: true }).first().waitFor();
    const frame = page.frames().find(frame => frame.url().endsWith("/index.html"));
    return { context, page, tool, frame };
  }
  async function open(s) {
    await s.page.evaluate(bytes => { window.hostInput = { name: "registration.pdf", size: bytes.length, bytes: new Uint8Array(bytes) }; }, inputBytes);
    await s.tool.getByRole("button", { name: "Open PDF", exact: true }).first().click();
    await s.tool.locator('[data-field="person.name"] input').waitFor();
  }
  async function ready(s) {
    await s.tool.getByText("Generated appearances", { exact: true }).waitFor();
    await s.frame.waitForFunction(() => { const c = document.querySelector("canvas"); return c?.width > 100 && getComputedStyle(c.parentElement).visibility === "visible"; });
  }
  async function save(s, action = () => s.tool.getByRole("button", { name: "Save PDF", exact: true }).click()) {
    const before = await s.page.evaluate(() => window.saved.length); await action();
    await s.page.waitForFunction(n => window.saved.length > n, before);
    return s.page.evaluate(() => window.saved.at(-1));
  }
  const field = (s, name) => s.tool.locator(`[data-field="${name}"]`);
  const overflow = async s => {
    const bad = await s.frame.evaluate(() => Array.from(document.querySelectorAll(".editor-toolbar,.fields-panel,.field-editor,input,select,textarea,.status-bar")).filter(el => { const b = el.getBoundingClientRect(); return b.width && (b.left < -1 || b.right > innerWidth + 1); }).map(el => el.className || el.tagName));
    assert.deepEqual(bad, [], "controls fit viewport");
    assert.equal(await s.frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  };
  const desktop = await session({ width: 1280, height: 900 });
  await desktop.page.screenshot({ path: path.join(artifacts, "empty-light.png") });
  await open(desktop);
  await desktop.tool.getByRole("button", { name: "Save PDF", exact: true }).click();
  await desktop.tool.getByRole("alert").filter({ hasText: "Complete required field" }).waitFor();
  await field(desktop, "person.name").locator("input").fill("Ada Lovelace");
  await field(desktop, "consent").locator("input").check();
  await field(desktop, "country").locator("select").selectOption("France");
  await field(desktop, "plan").getByRole("radio", { name: "Plus", exact: true }).check();
  await field(desktop, "interests").getByRole("checkbox", { name: "Art", exact: true }).check();
  await field(desktop, "notes").locator("textarea").fill("Hello from the form editor.\nSecond line.");
  assert.equal(await field(desktop, "reference").locator("input").isDisabled(), true);
  await desktop.tool.getByRole("button", { name: "Previous page" }).click();
  await ready(desktop); await overflow(desktop);
  await desktop.page.screenshot({ path: path.join(artifacts, "editor-light.png") });
  await desktop.tool.getByRole("button", { name: "Go to field person.name", exact: true }).click();
  assert.equal(await field(desktop, "person.name").locator("input").evaluate(el => document.activeElement === el), true);
  const saved = await save(desktop, () => desktop.page.keyboard.press("Control+s"));
  assert.equal(saved.name, "registration-filled.pdf");
  const output = await PDFDocument.load(new Uint8Array(saved.bytes));
  assert.equal(output.getForm().getTextField("person.name").getText(), "Ada Lovelace");
  assert.equal(output.getForm().getCheckBox("consent").isChecked(), true);
  assert.deepEqual(output.getForm().getDropdown("country").getSelected(), ["France"]);
  assert.equal(output.getForm().getRadioGroup("plan").getSelected(), "Plus");
  assert.deepEqual(output.getForm().getOptionList("interests").getSelected(), ["Art"]);
  await fs.writeFile(path.join(artifacts, "filled.pdf"), new Uint8Array(saved.bytes));

  // Denied and cancelled native saves preserve editing; repeated shortcuts cannot start another save.
  await field(desktop, "person.name").locator("input").fill("Grace Hopper");
  await desktop.page.evaluate(() => { window.denied = true; });
  await desktop.tool.getByRole("button", { name: "Save PDF", exact: true }).click();
  await desktop.tool.getByRole("alert").filter({ hasText: "Could not save" }).waitFor();
  assert.equal(await field(desktop, "person.name").locator("input").inputValue(), "Grace Hopper");
  await desktop.page.evaluate(() => { window.denied = false; window.cancelSave = true; });
  await desktop.page.keyboard.press("Meta+s");
  await desktop.tool.getByText("Save cancelled. Your changes are still here.").waitFor();
  await desktop.page.evaluate(() => { window.cancelSave = false; window.holdSave = true; });
  await desktop.page.keyboard.press("Control+s");
  await desktop.page.waitForFunction(() => !!window.finishSave);
  const calls = await desktop.page.evaluate(() => window.saveCalls);
  await desktop.page.keyboard.press("Control+s");
  assert.equal(await desktop.page.evaluate(() => window.saveCalls), calls);
  await desktop.page.evaluate(() => { window.holdSave = false; window.finishSave(); });
  await desktop.tool.getByText("Saved registration-filled.pdf", { exact: true }).waitFor();

  // JSON template, batch row preview, and actual ZIP contents.
  await desktop.tool.getByRole("button", { name: "Import / batch", exact: true }).click();
  const template = await save(desktop, () => desktop.tool.getByRole("button", { name: "Save JSON template" }).click());
  assert.equal(JSON.parse(template.bytes)["person.name"], "Grace Hopper");
  assert.equal(Object.hasOwn(JSON.parse(template.bytes), "reference"), false);
  const mapping = JSON.stringify([{ "person.name": "Alice", country: "Germany" }, { "person.name": "Bob", country: "France" }]);
  await desktop.page.evaluate(text => { window.hostInput = { name: "batch.json", size: text.length, text }; }, mapping);
  await desktop.tool.getByRole("button", { name: "Choose JSON / CSV" }).click();
  await desktop.tool.getByRole("button", { name: "Apply mapping" }).click();
  assert.equal(await field(desktop, "person.name").locator("input").inputValue(), "Alice");
  await desktop.tool.getByLabel("Preview batch row").selectOption({ value: "1" });
  await desktop.frame.waitForFunction(() => document.querySelector('[data-field="person.name"] input').value === "Bob");
  assert.equal(await field(desktop, "person.name").locator("input").inputValue(), "Bob");
  const zipped = await save(desktop, () => desktop.tool.getByRole("button", { name: "Save 2 forms as ZIP" }).click());
  const batch = unzipSync(new Uint8Array(zipped.bytes));
  for (const [i, expected] of ["Alice", "Bob"].entries()) assert.equal((await PDFDocument.load(batch[`form-00${i + 1}.pdf`])).getForm().getTextField("person.name").getText(), expected);
  await desktop.tool.getByRole("button", { name: "Clear batch", exact: true }).click();
  await desktop.tool.getByRole("button", { name: "Import / batch", exact: true }).click();
  await desktop.tool.getByLabel("Format", { exact: true }).selectOption("csv");
  await desktop.tool.getByLabel("Field mapping", { exact: true }).fill('person.name,consent\n"CSV, Person",true');
  await desktop.tool.getByRole("button", { name: "Apply mapping" }).click();
  assert.equal(await field(desktop, "person.name").locator("input").inputValue(), "CSV, Person");

  // Flatten is deliberate and the saved copy contains neither fields nor dangling annotations.
  await desktop.tool.getByRole("checkbox", { name: "Flatten saved copy", exact: true }).check();
  await desktop.tool.getByRole("button", { name: "Save PDF", exact: true }).click();
  await desktop.tool.getByRole("dialog").waitFor();
  await desktop.page.keyboard.press("Escape");
  assert.equal(await desktop.tool.getByRole("dialog").count(), 0);
  const flat = await save(desktop, async () => {
    await desktop.tool.getByRole("button", { name: "Save PDF", exact: true }).click();
    await desktop.tool.getByRole("button", { name: "I understand, save" }).click();
  });
  const flatDoc = await PDFDocument.load(new Uint8Array(flat.bytes));
  assert.equal(flatDoc.catalog.has(PDFName.of("AcroForm")), false);
  for (const page of flatDoc.getPages()) for (const ref of page.node.Annots()?.asArray() ?? []) assert.notEqual(flatDoc.context.lookup(ref, PDFDict).get(PDFName.of("Subtype"))?.toString(), "/Widget");
  await fs.writeFile(path.join(artifacts, "flattened.pdf"), new Uint8Array(flat.bytes));
  await field(desktop, "person.name").locator("input").fill("Keep me");
  await desktop.tool.getByRole("button", { name: "Reset fields", exact: true }).click();
  await desktop.tool.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await field(desktop, "person.name").locator("input").inputValue(), "Keep me");
  await desktop.tool.getByRole("searchbox").fill("not-a-field"); await desktop.tool.getByText("No matching fields.").waitFor();
  await desktop.tool.getByRole("searchbox").fill("");

  // Independent viewer: Poppler renders both outputs and reads their generated text.
  for (const name of ["filled", "flattened"]) {
    const text = execFileSync("pdftotext", [path.join(artifacts, `${name}.pdf`), "-"], { encoding: "utf8" });
    assert.ok(text.includes(name === "filled" ? "Ada Lovelace" : "CSV, Person"), `${name} appearances readable in Poppler`);
    execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1000", "-png", path.join(artifacts, `${name}.pdf`), path.join(artifacts, `${name}-poppler`)], { stdio: "pipe" });
  }

  // Batched layout evidence: narrow touch, dark, reduced motion and Arabic RTL.
  for (const [name, viewport, lang, dir, dark] of [
    ["mobile-en", { width: 390, height: 844 }, "en", "ltr", false],
    ["mobile-ar", { width: 360, height: 800 }, "ar", "rtl", true],
    ["desktop-de", { width: 1100, height: 800 }, "de", "ltr", true],
  ]) {
    const s = await session(viewport, { isMobile: viewport.width < 600, hasTouch: viewport.width < 600, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
    await open(s);
    await field(s, "person.name").locator("input").fill("Ada Lovelace"); await field(s, "consent").locator("input").check();
    await ready(s);
    await s.page.evaluate(({ lang, dir }) => document.querySelector("iframe").contentWindow.postMessage({ v: 1, event: "locale", data: { lang, dir } }, "*"), { lang, dir });
    await s.frame.waitForFunction(dir => document.documentElement.dir === dir, dir);
    await overflow(s);
    if (lang === "ar") assert.equal(await s.frame.evaluate(() => /[٠-٩۰-۹]/.test(document.body.innerText)), false);
    if (viewport.width < 600) assert.equal(await s.tool.locator(".toolbar-actions button").first().evaluate(el => el.getBoundingClientRect().height >= 44), true);
    await s.page.screenshot({ path: path.join(artifacts, `${name}.png`) });
    await s.context.close();
  }
  const archive = unzipSync(new Uint8Array(await fs.readFile("release/pdf-forms-1.0.0.zip")));
  for (const file of ["index.html", "plugin.json", "pdf-engine.js", "pdf-preview.js", "licenses/pdf-lib.txt", "licenses/pdfjs-dist.txt", "licenses/fflate.txt"]) assert.ok(archive[file], `packaged ${file}`);
  assert.equal(JSON.parse(new TextDecoder().decode(archive["plugin.json"])).id, "pdf-forms");
  assert.deepEqual(failures, []); assert.deepEqual(outbound, []); assert.deepEqual(missing, []);
  console.log("PASS: opaque-origin workers; all field types; generated appearances; Ctrl/Cmd+S; denied/cancelled/repeated saves; JSON/CSV mapping; batch ZIP; flatten confirmation and cleanup; Poppler text/render; desktop/mobile EN/DE/AR RTL; touch/reduced-motion/overflow; archive; no outbound requests.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
