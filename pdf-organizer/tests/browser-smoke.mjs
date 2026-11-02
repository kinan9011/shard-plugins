// Run after npm run build. This emulates the SDK host; actual Shard install acceptance is separate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { unzipSync } from "fflate";

const root = path.resolve("dist");
const artifacts = path.resolve("artifacts");
await fs.mkdir(artifacts, { recursive: true });
const host = `<!doctype html><html><head><title>PDF plugin sandbox smoke test</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="PDF Organizer" sandbox="allow-scripts" src="/index.html"></iframe><script>
window.saved=[];window.denied=false;
addEventListener('message',e=>{
 const m=e.data;if(!m?.id||!m.method)return;
 let result=null,error;
 if(m.method==='ready')result={pluginId:'pdf-organizer',visible:true,theme:{isDark:false,vars:{}}};
 if(m.method==='files.open')result=window.hostInput??null;
 if(m.method==='files.save'){
  if(window.denied)error={code:'permission_denied',message:'File save permission denied',permission:'files:save'};
  else{window.saved.push({name:m.params.name,bytes:Array.from(m.params.data)});result=true;}
 }
 e.source.postMessage({v:m.v,id:m.id,result,error},'*');
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.setDefaultTimeout(15_000);
  const failures = [], outbound = [], missing = [], requests = [], messages = [];
  page.on("console", message => messages.push(message.text().slice(0, 300)));
  page.on("pageerror", error => failures.push(error.message));
  page.on("request", request => { requests.push(request.url()); if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) outbound.push(request.url()); });
  page.on("response", response => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${origin}/host.html`);
  const tool = page.frameLocator("iframe");
  await tool.getByRole("heading", { name: "PDF Organizer", exact: true }).waitFor();
  const fixture = await PDFDocument.create();
  const first = fixture.addPage([320, 480]);
  first.drawText("PDF organizer fixture", { x: 30, y: 400, size: 18 });
  first.drawRectangle({ x: 20, y: 20, width: 80, height: 90, color: rgb(0.1, 0.3, 0.8) });
  fixture.addPage([600, 300]).setRotation(degrees(90));
  const bytes = await fixture.save();
  await page.evaluate(bytes => { window.hostInput = { name: "geometry.pdf", size: bytes.length, bytes: new Uint8Array(bytes) }; }, Array.from(bytes));
  await tool.getByRole("button", { name: "Open file", exact: true }).click();
  await tool.getByRole("heading", { name: "2 pages · 1 files" }).waitFor();
  const canvas = tool.locator("canvas").first();
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  // Poll the real canvas in its opaque-origin frame, rather than trusting its presence.
  const frame = page.frames().find(frame => frame.url().endsWith("/index.html"));
  await frame.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.width < 100) return false;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 2 && value > 100 && pixels[index - 2] < 100);
  }, undefined, { timeout: 15_000 }).catch(async error => {
    await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
    const intersection = await frame.evaluate(() => new Promise(resolve => { const observer = new IntersectionObserver(([entry]) => { observer.disconnect(); resolve({ visible: entry.isIntersecting, rect: entry.boundingClientRect.toJSON(), root: entry.rootBounds?.toJSON() }); }, { rootMargin: "150px" }); observer.observe(document.querySelector("canvas")); }));
    console.error(JSON.stringify({ failures, missing, requests, messages, intersection, previews: await frame.locator(".thumbnail").allTextContents(), canvases: await frame.locator("canvas").evaluateAll(canvases => canvases.map(canvas => ({ width: canvas.width, height: canvas.height }))) }));
    throw error;
  });
  assert.equal(await tool.getByText(/Preview unavailable/).count(), 0);
  await tool.getByRole("button", { name: "Move page 2 earlier" }).focus();
  await page.keyboard.press("Enter");
  await tool.getByRole("checkbox", { name: "Page 1", exact: true }).check();
  await tool.getByRole("button", { name: "Rotate selected 90°" }).click();
  await tool.getByRole("checkbox", { name: /I understand/ }).check();
  await tool.getByRole("button", { name: "Export PDF", exact: true }).click();
  await tool.getByText("Saved 1 PDF file(s), 2 page(s).").waitFor();
  const saved = await page.evaluate(() => window.saved[0]);
  const output = await PDFDocument.load(new Uint8Array(saved.bytes));
  assert.deepEqual(output.getPage(0).getSize(), { width: 600, height: 300 });
  assert.equal(output.getPage(0).getRotation().angle, 180);
  assert.deepEqual(output.getPage(1).getSize(), { width: 320, height: 480 });

  // Exercise native multiple-file input and browser JPEG/PNG normalization.
  const images = await frame.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 30;
    const context = canvas.getContext("2d"); context.fillStyle = "#d06020"; context.fillRect(0, 0, 40, 30);
    const encode = async mime => {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return { png: await encode("image/png"), jpeg: await encode("image/jpeg") };
  });
  await tool.locator('input[type="file"]').setInputFiles([
    { name: "sample.png", mimeType: "image/png", buffer: Buffer.from(images.png) },
    { name: "sample.jpg", mimeType: "image/jpeg", buffer: Buffer.from(images.jpeg) },
  ]);
  await tool.getByRole("heading", { name: "4 pages · 3 files" }).waitFor();
  await tool.getByLabel("Output", { exact: true }).selectOption("every");
  await tool.getByLabel("Pages per file").fill("1");
  await tool.getByRole("checkbox", { name: /I understand/ }).check();
  await tool.getByRole("button", { name: "Export PDF / ZIP" }).click();
  await tool.getByText("Saved 4 PDF file(s), 4 page(s).").waitFor();
  const zip = await page.evaluate(() => window.saved[1]);
  assert.equal(zip.name, "organized.zip");
  const parts = unzipSync(new Uint8Array(zip.bytes));
  assert.equal(Object.keys(parts).length, 4);
  assert.deepEqual((await PDFDocument.load(parts["part-003.pdf"])).getPage(0).getSize(), { width: 30, height: 22.5 });
  assert.deepEqual((await PDFDocument.load(parts["part-004.pdf"])).getPage(0).getSize(), { width: 30, height: 22.5 });

  await tool.locator(".sources li").nth(2).dragTo(tool.locator(".sources li").first());
  assert.match(await tool.locator(".page-source").first().textContent(), /sample.jpg/);
  await tool.locator(".page-grid li").first().dragTo(tool.locator(".page-grid li").last());
  assert.match(await tool.locator(".page-source").last().textContent(), /sample.jpg/);

  const checkOverflow = async () => assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await checkOverflow();
  await page.screenshot({ path: path.join(artifacts, "desktop-export.png"), fullPage: true });
  await frame.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, "desktop-light.png"), fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 }); await checkOverflow();
  await page.setViewportSize({ width: 390, height: 844 }); await checkOverflow();
  await frame.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, "mobile-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(artifacts, "mobile-dark.png"), fullPage: true });
  await tool.getByLabel("Output", { exact: true }).selectOption("all");
  await page.evaluate(() => { window.denied = true; });
  await tool.getByRole("button", { name: "Export PDF", exact: true }).click();
  await tool.getByRole("alert").filter({ hasText: "File save permission denied" }).waitFor();
  assert.deepEqual(failures, []); assert.deepEqual(outbound, []); assert.deepEqual(missing, []);
  console.log("Browser smoke passed: opaque-origin frame, real previews/workers, reorder/rotation geometry, PNG+JPEG merge, ZIP reparse, denied save, 1280/768/390 px overflow, light/dark screenshots, zero outbound requests or page errors.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
