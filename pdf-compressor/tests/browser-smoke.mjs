// Emulates Shard's bridge and opaque-origin frame; native host acceptance is separate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, degrees, rgb } from "pdf-lib";
import { unzipSync, unzlibSync } from "fflate";

const root = path.resolve("dist"), artifacts = path.resolve("artifacts");
await fs.mkdir(artifacts, { recursive: true });
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="PDF Compressor" sandbox="allow-scripts" src="/index.html"></iframe><script>
window.saved=[];window.denied=false;window.cancelSave=false;
addEventListener('message',e=>{
 const m=e.data;if(!m?.id||!m.method)return;let result=null,error;
 if(m.method==='ready')result={pluginId:'pdf-compressor',visible:true,locale:{lang:'en',dir:'ltr'},theme:{isDark:false,vars:{}}};
 if(m.method==='files.open')result=window.hostInput??null;
 if(m.method==='files.save'){
  if(window.denied)error={code:'permission_denied',message:'Save denied',permission:'files:save'};
  else if(window.cancelSave)result=false;
  else{const chunks=[];for(let i=0;i<m.params.data.length;i+=32768)chunks.push(String.fromCharCode(...m.params.data.subarray(i,i+32768)));window.saved.push({name:m.params.name,base64:btoa(chunks.join(''))});result=true;}
 }
 e.source.postMessage({v:m.v,id:m.id,result,error},'*');
});</script></body></html>`;
const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/host.html") { response.setHeader("Content-Type", "text/html"); response.end(host); return; }
  const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css" };
  response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
  try { response.end(await fs.readFile(file)); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  const errors = [], outbound = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(origin) && !/^(blob:|data:)/.test(request.url())) outbound.push(request.url()); });
  await page.goto(`${origin}/host.html`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("heading", { name: "PDF Compressor" }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "desktop-empty.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "mobile-empty.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await ui.getByRole("button", { name: "Browse files", exact: true }).evaluate(el => el === document.activeElement), true, "file actions support keyboard navigation");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 700;
    const ctx = canvas.getContext("2d"), data = ctx.createImageData(canvas.width, canvas.height);
    let seed = 123;
    for (let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const i=(y*canvas.width+x)*4, noise=(seed>>>24)/8;
      data.data[i]=x/canvas.width*220+noise;data.data[i+1]=y/canvas.height*200+noise;data.data[i+2]=180+noise;data.data[i+3]=255;
    }
    ctx.putImageData(data,0,0);ctx.fillStyle='white';ctx.fillRect(50,50,775,110);ctx.fillStyle='black';ctx.font='32px sans-serif';ctx.fillText('Scanned text sample 1234',75,115);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create();
  const picture = await doc.embedPng(new Uint8Array(Buffer.from(image, "base64")));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const sheet = doc.addPage([612, 792]);
    sheet.drawImage(picture, { x: 20, y: 110, width: 570, height: 580 });
    sheet.drawText(`Searchable original page ${i + 1}`, { x: 40, y: 735, size: 22, font, color: rgb(0.1, 0.2, 0.7) });
    if (i === 0) {
      const field = doc.getForm().createTextField("customer"); field.setText("Ada Lovelace"); field.addToPage(sheet, { x: 40, y: 45, width: 220, height: 28 });
      const annot = doc.context.obj({ Type: "Annot", Subtype: "Square", Rect: [350, 40, 450, 85], C: [1, 0, 0], BS: { W: 4, S: "S" }, F: 4 });
      sheet.node.addAnnot(doc.context.register(annot));
    } else { sheet.setCropBox(20, 30, 500, 700); sheet.setRotation(degrees(90)); }
  }
  doc.setTitle("Compression fixture"); doc.setAuthor("Browser test");
  doc.getForm().updateFieldAppearances(font);
  await doc.attach(new TextEncoder().encode("attachment"), "note.txt");
  const source = await doc.save({ useObjectStreams: false });
  await fs.writeFile(path.join(artifacts, "original.pdf"), source);
  const plugin = page.frames().find(frame => frame.parentFrame());
  const transfer = await plugin.evaluateHandle(base64 => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "dropped.pdf", { type: "application/pdf" }));
    return data;
  }, Buffer.from(source).toString("base64"));
  await ui.locator("main").dispatchEvent("dragenter", { dataTransfer: transfer });
  await ui.locator("main.is-dragging").waitFor();
  await page.screenshot({ path: path.join(artifacts, "desktop-drag.png"), fullPage: true });
  await ui.getByRole("heading", { name: "Drop a PDF here" }).dispatchEvent("drop", { dataTransfer: transfer });
  await ui.getByText("dropped.pdf", { exact: true }).waitFor();
  assert.equal(await ui.locator(".drop-overlay").count(), 0);
  assert.equal(await ui.locator("details").getAttribute("open"), null);
  await page.screenshot({ path: path.join(artifacts, "desktop-ready.png"), fullPage: true });
  // A corrupt replacement must preserve the loaded source and keep the page in the plugin.
  const corrupt = await plugin.evaluateHandle(() => {
    const data = new DataTransfer(); data.items.add(new File(["not a PDF"], "broken.pdf", { type: "application/pdf" })); return data;
  });
  await ui.locator(".file-area").dispatchEvent("drop", { dataTransfer: corrupt });
  await ui.getByRole("alert").waitFor();
  assert.equal(await ui.getByText("dropped.pdf", { exact: true }).count(), 1);
  await transfer.dispose(); await corrupt.dispose();
  console.log(`Fixture: ${source.length} bytes, opening through host bridge`);
  await page.evaluate(base64 => { const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));window.hostInput = { name: "sample.pdf", size: bytes.length, bytes }; }, Buffer.from(source).toString("base64"));
  await ui.getByRole("button", { name: "Open PDF", exact: true }).click();
  await ui.getByText("sample.pdf", { exact: true }).waitFor();
  await ui.getByLabel("I understand these changes and will keep my original.").check();

  async function processAndSave(label) {
    console.log(`Checking ${label}`);
    await ui.getByRole("button", { name: "Compress PDF", exact: true }).click();
    await ui.getByRole("button", { name: "Save PDF", exact: true }).waitFor({ timeout: 90_000 });
    const frame = page.frames().find(frame => frame.parentFrame());
    await frame.waitForFunction(() => {
      const c=document.querySelector('canvas'); return c && c.width > 0 && c.height > 0 && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);
    });
    assert.equal(await ui.getByText("Preview unavailable. Check the saved PDF in a PDF viewer.").count(), 0);
    await ui.getByRole("button", { name: "Save PDF", exact: true }).click();
    await ui.getByText("PDF saved.", { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.saved.at(-1));
    assert.equal(saved.name, "sample-compressed.pdf");
    const bytes = new Uint8Array(Buffer.from(saved.base64, "base64"));
    await fs.writeFile(path.join(artifacts, `${label}.pdf`), bytes);
    const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(parsed.getPageCount(), 2);
    assert.equal(parsed.context.trailerInfo.Info, undefined);
    console.log(`${label}: ${source.length} → ${bytes.length} bytes (${Math.round((1 - bytes.length / source.length) * 100)}% smaller)`);
    return { parsed, bytes };
  }

  const gentle = await processAndSave("gentle");
  assert.equal(gentle.parsed.getForm().getTextField("customer").getText(), "Ada Lovelace");
  assert.equal(gentle.parsed.getPage(1).getRotation().angle, 90);
  await ui.getByText("More options", { exact: true }).click();
  await ui.getByLabel("Flatten form fields", { exact: true }).check();
  const forms = await processAndSave("forms");
  assert.equal(forms.parsed.catalog.has(PDFName.of("AcroForm")), false);
  const annots = forms.parsed.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(annots.size(), 1, "preserve the square annotation while removing widgets");

  await ui.getByLabel("Compression level", { exact: true }).selectOption("balanced");
  const balanced = await processAndSave("balanced");
  await ui.getByLabel("Compression level", { exact: true }).selectOption("strong");
  const strong = await processAndSave("strong");
  await ui.getByLabel("Compression level", { exact: true }).selectOption("extreme");
  const extreme = await processAndSave("extreme");
  assert.ok(strong.bytes.length < balanced.bytes.length);
  assert.ok(extreme.bytes.length < strong.bytes.length);
  assert.equal(strong.parsed.catalog.has(PDFName.of("AcroForm")), false);
  assert.equal(strong.parsed.catalog.has(PDFName.of("Names")), false);
  assert.deepEqual(strong.parsed.getPage(1).getSize(), { width: 700, height: 500 });
  assert.equal(strong.parsed.getPage(1).getRotation().angle, 0);
  assert.equal(strong.parsed.getPage(0).node.Annots()?.size() ?? 0, 0);

  await ui.getByLabel("Color output", { exact: true }).selectOption("gray");
  const gray = await processAndSave("grayscale");
  const jpeg = gray.parsed.context.enumerateIndirectObjects().map(([, v]) => v).find(v => v instanceof PDFRawStream && v.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  const grayColors = await page.evaluate(async base64 => {
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let maxDelta=0;for(let i=0;i<data.length;i+=4)maxDelta=Math.max(maxDelta,Math.abs(data[i]-data[i+1]),Math.abs(data[i]-data[i+2]));
    bitmap.close();return maxDelta;
  }, Buffer.from(jpeg.contents).toString("base64"));
  assert.ok(grayColors <= 2, `grayscale JPEG channel delta: ${grayColors}`);

  await ui.getByLabel("Color output", { exact: true }).selectOption("bw");
  await ui.getByLabel("Page resolution", { exact: true }).selectOption("150");
  const bw = await processAndSave("black-white");
  for (const [, value] of bw.parsed.context.enumerateIndirectObjects()) if (value instanceof PDFRawStream && value.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) {
    assert.equal(value.dict.get(PDFName.of("ColorSpace")), PDFName.of("DeviceGray"));
    assert.equal(value.dict.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber(), 1);
    assert.ok(unzlibSync(value.contents).some(v => v !== 255));
  }
  await ui.getByText("More options", { exact: true }).click();
  await plugin.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, "desktop-result.png"), fullPage: true });

  await page.evaluate(() => { window.denied = true; });
  await ui.getByRole("button", { name: "Save PDF", exact: true }).click();
  await ui.getByRole("alert").waitFor();
  await page.evaluate(() => { window.denied = false; window.cancelSave = true; });
  await ui.getByRole("button", { name: "Save PDF", exact: true }).click();
  await ui.getByText("Save cancelled. The result is still available.").waitFor();
  await page.evaluate(() => { window.cancelSave = false; });

  await ui.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await ui.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await ui.getByText("Processing cancelled. Your original is unchanged.").waitFor();
  assert.equal(await ui.getByRole("button", { name: "Save PDF", exact: true }).count(), 0);
  await processAndSave("final-black-white");

  for (const [width, dark, lang] of [[1280, false, "en"], [768, true, "de"], [390, false, "ar"], [320, false, "ar"], [390, true, "he"]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
    await page.evaluate(({ dark, lang }) => {
      const frame = document.querySelector('iframe').contentWindow;
      frame.postMessage({v:1,event:'theme',data:{isDark:dark,vars:{}}},'*');
      frame.postMessage({v:1,event:'locale',data:{lang,dir:['ar','he'].includes(lang)?'rtl':'ltr'}},'*');
    }, { dark, lang });
    const frame = page.frames().find(frame => frame.parentFrame());
    await frame.waitForFunction(lang => document.documentElement.lang === lang, lang);
    await frame.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${width}/${lang}`);
    const escaped = await frame.evaluate(() => [...document.querySelectorAll('button, select, summary, .filename')].filter(el => {
      if (!el.checkVisibility()) return false;
      const rect = el.getBoundingClientRect(); return rect.width && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map(el => el.textContent));
    assert.deepEqual(escaped, [], `child overflow at ${width}/${lang}`);
    if (lang === "ar" || lang === "he") assert.equal(await frame.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await frame.evaluate(() => /[٠-٩۰-۹]/.test(document.body.innerText)), false);
    await page.screenshot({ path: path.join(artifacts, `${width}-${lang}-${dark ? "dark" : "light"}.png`), fullPage: true });
    await frame.locator("summary").click();
    const advancedOverflow = await frame.locator(".advanced-content").evaluate(el => [...el.querySelectorAll('select, input, label')].filter(child => {
      if (!child.checkVisibility()) return false;
      const rect = child.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(child => child.textContent));
    assert.deepEqual(advancedOverflow, [], `expanded options overflow at ${width}/${lang}`);
    if (width === 390) await page.screenshot({ path: path.join(artifacts, `${width}-${lang}-advanced.png`), fullPage: true });
    await frame.locator("summary").click();
    if (width === 390) {
      await frame.locator(".output").scrollIntoViewIfNeeded();
      assert.equal(await frame.locator("canvas").isVisible(), true);
      await page.screenshot({ path: path.join(artifacts, `${width}-${lang}-result.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, [], "uncaught browser errors");
  assert.deepEqual(outbound, [], "outbound network requests");
  const zip = unzipSync(new Uint8Array(await fs.readFile("release/pdf-compressor-1.0.0.zip")));
  for (const file of ["index.html", "plugin.json", "pdf-engine.js", "pdf-preview.js", "licenses/pdf-lib.txt", "licenses/pdfjs-dist.txt", "licenses/fflate.txt"]) assert.ok(zip[file], `missing package asset ${file}`);
  const manifest = JSON.parse(new TextDecoder().decode(zip["plugin.json"]));
  assert.equal(manifest.id, "pdf-compressor");
  assert.deepEqual(manifest.permissions.map(p => p.name), ["files:open", "files:save"]);
  console.log("PASS: PDF drop in opaque-origin frame; drag feedback; corrupt replacement; keyboard actions; progressive options; real workers; all compression levels; grayscale pixels; 1-bit output; forms; rotated crop; save denial/cancel; processing cancel; responsive EN/DE/AR/HE; package assets; no outbound requests or page errors.");
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    console.error(await page.frames().find(frame => frame.parentFrame())?.locator("footer").innerText().catch(() => "No footer"));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
