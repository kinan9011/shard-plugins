// Run after npm run build. This emulates the SDK host; actual Shard install acceptance is separate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { PDFDict, PDFDocument, PDFName, rgb } from "pdf-lib";
import { unzipSync } from "fflate";

const root = path.resolve("dist");
const artifacts = path.resolve("artifacts");
await fs.mkdir(artifacts, { recursive: true });
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>PDF plugin sandbox smoke test</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="PDF Organizer" sandbox="allow-scripts" src="/index.html"></iframe><script>
window.saved=[];window.denied=false;window.cancelSave=false;window.saveCalls=0;
addEventListener('message',e=>{
 const m=e.data;if(!m?.id||!m.method)return;
 let result=null,error;
 if(m.method==='ready')result={pluginId:'pdf-organizer',visible:true,theme:{isDark:false,vars:{}}};
 if(m.method==='files.open')result=window.hostInput??null;
 if(m.method==='files.save'){
  window.saveCalls++;
  if(window.denied)error={code:'permission_denied',message:'File save permission denied',permission:'files:save'};
  else if(window.cancelSave)result=false;
  else{window.saved.push({name:m.params.name,bytes:Array.from(m.params.data)});result=true;}
 }
 const respond=()=>e.source.postMessage({v:m.v,id:m.id,result,error},'*');
 if(m.method==='files.save'&&window.holdSave){window.finishSave=respond;return;}
 respond();
});</script></body></html>`;
const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/host.html") { response.setHeader("Content-Type", "text/html"); response.end(host); return; }
  const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".css": "text/css" };
  response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
  try { response.end(await fs.readFile(file)); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });

  // Pages are identified by width (300 + 10 * n) so the saved PDF proves order and rotation without reading text.
  const widthOf = n => 300 + n * 10;
  const makeFixture = async count => {
    const document = await PDFDocument.create();
    for (let n = 0; n < count; n++) {
      const sheet = document.addPage([widthOf(n), 400]);
      sheet.drawText(String(n + 1), { x: 30, y: 300, size: 90 });
      sheet.drawRectangle({ x: 20, y: 20, width: 80, height: 60, color: rgb(0.1, 0.3, 0.8) });
    }
    return Array.from(await document.save());
  };
  const newSession = async (viewport, options = {}) => {
    const context = await browser.newContext({ viewport, ...options });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const problems = { failures: [], outbound: [], missing: [] };
    page.on("pageerror", error => problems.failures.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) problems.outbound.push(request.url()); });
    page.on("response", response => { if (response.status() >= 400) problems.missing.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${origin}/host.html`);
    const tool = page.frameLocator("iframe");
    const frame = page.frames().find(frame => frame.url().endsWith("/index.html"));
    await tool.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
    return { context, page, tool, frame, problems };
  };
  const open = async ({ page, tool }, count, name = "fixture.pdf") => {
    const bytes = await makeFixture(count);
    await page.evaluate(({ bytes, name }) => { window.hostInput = { name, size: bytes.length, bytes: new Uint8Array(bytes) }; }, { bytes, name });
    await tool.getByRole("button", { name: /^Open/, exact: false }).first().click();
    await tool.getByRole("row", { name: "Page 1", exact: true }).waitFor();
  };
  const saveAll = async ({ page, tool }) => {
    const before = await page.evaluate(() => window.saved.length);
    await page.keyboard.press("Control+s");
    const confirm = tool.getByRole("button", { name: "I understand, save" });
    if (await confirm.count()) await confirm.click();
    await page.waitForFunction(count => window.saved.length > count, before);
    const saved = await page.evaluate(() => window.saved[window.saved.length - 1]);
    const output = await PDFDocument.load(new Uint8Array(saved.bytes));
    return output.getPages().map(sheet => ({ width: sheet.getWidth(), rotation: sheet.getRotation().angle }));
  };

  // ---- Desktop session -------------------------------------------------------------------------------------------
  const desktop = await newSession({ width: 1280, height: 900 });
  const { page, tool, frame, problems } = desktop;
  const row = number => tool.getByRole("row", { name: `Page ${number}`, exact: true });
  const ids = () => tool.getByRole("row").evaluateAll(rows => rows.map(row => row.dataset.pageId));
  const selection = () => tool.getByRole("row").evaluateAll(rows => rows.flatMap((row, index) => row.getAttribute("aria-selected") === "true" ? [index + 1] : []));
  const overflow = async target => assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const center = async locator => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }; };

  // Empty state: one obvious action, nothing else.
  assert.equal(await tool.getByRole("toolbar").count(), 0);
  assert.equal(await tool.getByRole("checkbox").count(), 0);
  await page.screenshot({ path: path.join(artifacts, "empty-1280-light.png") });

  await open(desktop, 5);
  await frame.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.width < 100) return false;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 2 && value > 150 && pixels[index - 2] < 100);
  });
  assert.equal(await tool.getByText(/Preview unavailable/).count(), 0);
  assert.equal(await tool.getByRole("toolbar").getByRole("button").count() > 8, true);
  await overflow(frame);

  // Click / Ctrl / Shift selection, then the real mouse drags the selected pair after the last page.
  await row(2).click(); await row(4).click({ modifiers: ["Control"] });
  assert.deepEqual(await selection(), [2, 4]);
  const original = await ids();
  const from = await center(row(2)), to = await center(row(5));
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.box.x + to.box.width - 8, to.y, { steps: 10 });
  assert.equal(await tool.locator(".drag-ghost").textContent(), "2 pages");
  assert.equal(await tool.locator(".page-insertion-marker").count(), 1);
  await page.screenshot({ path: path.join(artifacts, "drag-1280-light.png") });
  await page.mouse.up();
  assert.deepEqual(await ids(), [original[0], original[2], original[4], original[1], original[3]]);
  assert.deepEqual(await selection(), [4, 5]);
  assert.equal(await tool.locator(".drag-ghost").count(), 0);
  await tool.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await ids(), original);

  // Ctrl held on drop copies; Escape cancels a drag.
  await row(1).click();
  const one = await center(row(1)), end = await center(row(5));
  await page.mouse.move(one.x, one.y); await page.mouse.down(); await page.mouse.move(one.x + 20, one.y + 20, { steps: 3 });
  await page.mouse.move(end.box.x + end.box.width - 8, end.y, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual(await ids(), original);
  await page.mouse.move(one.x, one.y); await page.mouse.down(); await page.mouse.move(one.x + 20, one.y + 20, { steps: 3 });
  await page.mouse.move(end.box.x + end.box.width - 8, end.y, { steps: 8 });
  await page.keyboard.down("Control"); await page.mouse.up(); await page.keyboard.up("Control");
  assert.equal((await ids()).length, 6);
  await tool.getByRole("button", { name: "Undo", exact: true }).click();

  // Right-click: the menu opens at the cursor, selects the page, and runs an action.
  await row(3).click({ button: "right", position: { x: 40, y: 40 } });
  const menu = tool.getByRole("menu", { name: "Page actions" });
  await menu.waitFor();
  assert.deepEqual(await selection(), [3]);
  const menuBox = await menu.boundingBox(), cardBox = await row(3).boundingBox();
  assert.ok(Math.abs(menuBox.x - (cardBox.x + 40)) < 6 && Math.abs(menuBox.y - (cardBox.y + 40)) < 6, "menu opens at the pointer");
  await page.screenshot({ path: path.join(artifacts, "menu-1280-light.png") });
  await menu.getByRole("menuitem", { name: /^Rotate right/ }).click();
  assert.equal(await menu.count(), 0);
  await page.keyboard.press("Escape");
  // Background right-click and keyboard shortcuts.
  await tool.getByRole("grid").click({ button: "right", position: { x: 5, y: 700 } });
  await tool.getByRole("menu").waitFor();
  await page.keyboard.press("Escape"); assert.equal(await tool.getByRole("menu").count(), 0);
  await page.keyboard.press("Control+a"); assert.deepEqual(await selection(), [1, 2, 3, 4, 5]);
  await page.keyboard.press("Delete"); assert.equal((await ids()).length, 0);
  await tool.getByRole("heading", { name: "No pages left" }).waitFor();
  await page.keyboard.press("Control+z"); assert.deepEqual(await ids(), original);

  // Zoom: the slider re-renders sharper canvases; thumbnails stay inside the grid.
  const widthAt = async () => { await frame.waitForFunction(() => document.querySelector("canvas")?.width > 1); return frame.evaluate(() => document.querySelector("canvas").width); };
  const small = await widthAt();
  await tool.getByRole("slider", { name: "Zoom" }).fill("320");
  await frame.waitForFunction(small => document.querySelector("canvas")?.width > small * 1.5, small);
  await tool.getByRole("button", { name: "Reset zoom" }).count();
  await page.keyboard.press("0");
  await overflow(frame);

  // Save: Ctrl+S exports every page with the rotation chosen above; reparse proves it.
  await row(2).click();
  const saved = await saveAll(desktop);
  assert.deepEqual(saved.map(entry => entry.width), [0, 1, 2, 3, 4].map(widthOf));
  assert.deepEqual(saved.map(entry => entry.rotation), [0, 0, 90, 0, 0]);
  assert.equal(await page.evaluate(() => window.saved[0].name), "fixture-organized.pdf");

  // Import after the selected page, then reorder through the real mouse and re-save.
  await row(2).click();
  const extra = await makeFixture(2);
  await page.evaluate(bytes => { window.hostInput = { name: "extra.pdf", size: bytes.length, bytes: new Uint8Array(bytes) }; }, extra);
  await tool.getByRole("button", { name: "Import", exact: true }).click();
  await tool.getByText("Added 1 file(s), 2 page(s) after page 2.").waitFor();
  const merged = await saveAll(desktop);
  assert.deepEqual(merged.map(entry => entry.width), [0, 1, 0, 1, 2, 3, 4].map(widthOf));

  // Selected-page export dialog produces a ZIP of ranges.
  await page.keyboard.press("Control+a"); await tool.getByRole("button", { name: "More actions" }).click();
  await tool.getByRole("menuitem", { name: /^Export pages/ }).click();
  const dialog = tool.getByRole("dialog", { name: "Export pages" });
  await dialog.getByLabel("Output").selectOption("every"); await dialog.getByLabel("Pages per file").fill("3");
  await page.screenshot({ path: path.join(artifacts, "dialog-1280-light.png") });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForFunction(() => window.saved.length === 3).catch(async error => {
    console.error("save feedback:", await tool.locator(".feedback").textContent(), "| alert:", await tool.getByRole("alert").allTextContents(), "| saved:", await page.evaluate(() => window.saved.length));
    await page.screenshot({ path: path.join(artifacts, "failure.png") }); throw error;
  });
  const zip = unzipSync(new Uint8Array(await page.evaluate(() => window.saved[2].bytes)));
  assert.deepEqual(Object.keys(zip).sort(), ["part-001.pdf", "part-002.pdf", "part-003.pdf"]);
  assert.equal((await PDFDocument.load(zip["part-003.pdf"])).getPageCount(), 1);

  // Autoscroll: dragging to the bottom edge of a long document scrolls the grid by itself.
  await tool.getByRole("button", { name: "More actions" }).click();
  await tool.getByRole("menuitem", { name: /^Clear session/ }).click();
  await tool.getByRole("button", { name: "Clear session", exact: true }).click();
  await open(desktop, 40, "long.pdf");
  const scroller = tool.locator(".grid-scroll");
  const area = await scroller.boundingBox();
  const head = await center(row(1));
  await page.mouse.move(head.x, head.y); await page.mouse.down(); await page.mouse.move(head.x + 10, head.y + 10, { steps: 3 });
  await page.mouse.move(area.x + area.width / 2, area.y + area.height - 10, { steps: 6 });
  await page.waitForTimeout(700);
  assert.ok(await scroller.evaluate(element => element.scrollTop) > 100, "grid autoscrolls near the bottom edge");
  await page.mouse.up();
  await tool.getByRole("button", { name: "Undo", exact: true }).click().catch(() => {});

  // Layout / theme matrix with no horizontal overflow.
  await tool.getByRole("button", { name: "Undo", exact: true }).isEnabled();
  for (const [width, height] of [[1280, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await overflow(frame);
      await page.screenshot({ path: path.join(artifacts, `workspace-${width}-${colorScheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  assert.deepEqual(problems, { failures: [], outbound: [], missing: [] });
  await desktop.context.close();

  // ---- Geometry session: crop, white borders, split, merge, blank page, properties --------------------------------
  const geo = await newSession({ width: 1280, height: 900 });
  await open(geo, 3, "geo.pdf");
  const g = geo.tool, gp = geo.page;
  const grow = number => g.getByRole("row", { name: `Page ${number}`, exact: true });
  const gcount = () => g.getByRole("row").count();
  const fill = (dialogName, label, value) => g.getByRole("dialog", { name: dialogName }).getByLabel(label).fill(value);
  const menuAction = async (name, target = "More actions") => { await g.getByRole("button", { name: target }).click(); await g.getByRole("menuitem", { name }).click(); };
  const dialogButton = (dialogName, name) => g.getByRole("dialog", { name: dialogName }).getByRole("button", { name, exact: true }).click();

  await grow(1).click({ button: "right" });
  await g.getByRole("menuitem", { name: /^Crop…/ }).click();
  await fill("Crop pages", /^Left/, "50"); await dialogButton("Crop pages", "Crop");
  // The thumbnail itself must now show only the right half: 150 x 400 points.
  await geo.frame.waitForFunction(() => { const canvas = document.querySelector('[aria-label="Page 1"] canvas'); return canvas && canvas.width > 1 && Math.abs(canvas.width / canvas.height - 0.375) < 0.02; });

  await grow(2).click({ button: "right" });
  await g.getByRole("menuitem", { name: /^Crop white borders/ }).click();
  await g.getByText("Cropped white borders on 1 page.").waitFor();

  await grow(3).click();
  await menuAction(/^Split pages…/);
  await fill("Split pages", /^Columns/, "2"); await fill("Split pages", /^Rows/, "1"); await dialogButton("Split pages", "Split");
  assert.equal(await gcount(), 4);

  await grow(1).click(); await grow(2).click({ modifiers: ["Control"] });
  await menuAction(/^Merge pages…/);
  await fill("Merge pages", /^Pages across/, "2"); await dialogButton("Merge pages", "Merge");
  await g.getByText("Merged 2 pages onto 1 page.").waitFor();
  assert.equal(await gcount(), 3);

  await grow(2).click(); await gp.keyboard.press("Insert");
  await g.getByText("Inserted a blank page after page 2.").waitFor();
  assert.equal(await gcount(), 4);

  await menuAction(/^Document properties…/);
  await fill("Document properties", /^Title/, "Smoke test"); await fill("Document properties", /^Keywords/, "one, two"); await dialogButton("Document properties", "Apply");
  await gp.screenshot({ path: path.join(artifacts, "geometry-1280-light.png") });

  const geoBefore = await gp.evaluate(() => window.saved.length);
  await gp.keyboard.press("Control+s"); await g.getByRole("button", { name: "I understand, save" }).click();
  await gp.waitForFunction(count => window.saved.length > count, geoBefore);
  const geoResult = await PDFDocument.load(new Uint8Array(await gp.evaluate(() => window.saved[window.saved.length - 1].bytes)));
  const sizes = geoResult.getPages().map(sheet => sheet.getSize());
  assert.equal(sizes.length, 4);
  assert.deepEqual(sizes[0], { width: 300, height: 400 });                       // 2 cells of 150 x 400 (cropped page 1 is the widest)
  assert.equal(geoResult.getPage(0).node.Resources().lookup(PDFName.of("XObject"), PDFDict).keys().length, 2);
  assert.deepEqual(sizes[1], { width: 160, height: 400 });                       // left half of page 3
  assert.deepEqual(sizes[2], { width: 320, height: 400 });                       // blank page copies the size of its neighbour (uncropped)
  assert.deepEqual(sizes[3], { width: 160, height: 400 });
  assert.equal(geoResult.getTitle(), "Smoke test"); assert.equal(geoResult.getKeywords(), "one two");
  // White-border detection shrank page 2 to its content (checked before merging by the merge sheet staying 150 wide).
  await gp.keyboard.press("Control+z");
  assert.equal(await gcount(), 3);
  assert.deepEqual(geo.problems, { failures: [], outbound: [], missing: [] });
  await geo.context.close();

  // ---- Touch session: tap toggles, a moving finger scrolls, press-and-hold drags --------------------------------
  const touch = await newSession({ width: 390, height: 700 }, { hasTouch: true, isMobile: true });
  await open(touch, 12, "touch.pdf");
  const t = touch.tool, tp = touch.page;
  const trow = number => t.getByRole("row", { name: `Page ${number}`, exact: true });
  const tids = () => t.getByRole("row").evaluateAll(rows => rows.map(row => row.dataset.pageId));
  const cdp = await tp.context().newCDPSession(tp);
  const finger = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const startIds = await tids();
  const a = await center(trow(1)), b = await center(trow(2));   // one column at 390 px: page 2 is the visible neighbour
  await finger("touchStart", a.x, a.y); await tp.waitForTimeout(550);
  for (let step = 1; step <= 8; step++) { await finger("touchMove", a.x + (b.x + 20 - a.x) * step / 8, a.y + (b.y + 40 - a.y) * step / 8); await tp.waitForTimeout(16); }
  assert.equal(await t.locator(".drag-ghost").count(), 1, "long press starts a drag");
  await finger("touchEnd"); await tp.waitForTimeout(100);
  assert.deepEqual(await tids(), [startIds[1], startIds[0], ...startIds.slice(2)]);
  // A finger that moves first scrolls the grid and reorders nothing.
  const before = await tids(), top = await t.locator(".grid-scroll").evaluate(element => element.scrollTop);
  const c = await center(trow(2));
  await finger("touchStart", c.x, c.y);
  for (let step = 1; step <= 10; step++) { await finger("touchMove", c.x, c.y - step * 20); await tp.waitForTimeout(16); }
  await finger("touchEnd"); await tp.waitForTimeout(200);
  assert.deepEqual(await tids(), before);
  assert.ok(await t.locator(".grid-scroll").evaluate(element => element.scrollTop) > top, "swipe scrolls");
  assert.deepEqual(touch.problems, { failures: [], outbound: [], missing: [] });
  await touch.context.close();

  console.log("Browser smoke passed: empty state; real-mouse group drag with ghost/marker, Escape cancel, Ctrl-drop copy, edge autoscroll; right-click page/background menus at the pointer; keyboard shortcuts; zoom re-render; Ctrl+S reparsed order and rotation; import after page; ZIP export dialog; touch long-press drag and swipe-scroll; 1280/768/390 light/dark without overflow; no outbound requests or page errors.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
