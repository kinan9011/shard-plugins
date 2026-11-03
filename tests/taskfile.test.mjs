import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Task commands target one plugin, validate inputs and stop on npm failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shard-tasks-"));
  try {
    fs.copyFileSync(fileURLToPath(new URL("../Taskfile.yml", import.meta.url)), path.join(root, "Taskfile.yml"));
    for (const id of ["sample", "no-lock"]) {
      fs.mkdirSync(path.join(root, id, "public"), { recursive: true });
      fs.writeFileSync(path.join(root, id, "public/plugin.json"), JSON.stringify({ id, name: id, version: "1.0.0" }));
      fs.writeFileSync(path.join(root, id, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build", test: "vitest run", typecheck: "tsc", "test:browser": "node browser.mjs" } }));
    }
    fs.writeFileSync(path.join(root, "sample/package-lock.json"), "{}");
    fs.mkdirSync(path.join(root, "bin"));
    fs.writeFileSync(path.join(root, "bin/npm"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TASK_TEST_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (process.argv.at(-1) === process.env.TASK_TEST_FAIL) process.exit(7);
`, { mode: 0o755 });
    const log = path.join(root, "npm.log");
    const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const run = (args, extra = {}, cwd = root) => spawnSync("task", args, {
      cwd, encoding: "utf8", timeout: 15000,
      env: { ...process.env, PATH: `${root}/bin${path.delimiter}${process.env.PATH}`, TASK_TEST_LOG: log, PLUGIN_ID: "unrelated", NPM_SCRIPT: "unrelated", ...extra },
    });
    const succeeds = result => assert.equal(result.status, 0, result.stdout + result.stderr);
    succeeds(run([]));
    const list = run(["plugins"]); succeeds(list); assert.match(list.stdout, /sample\s+1\.0\.0/);
    for (const args of [["build"], ["build", "PLUGIN=missing"], ["build", "PLUGIN="], ["build", "PLUGIN=../sample"], ["build", "PLUGIN=sample; echo injected"], ["build", "PLUGIN=$(echo sample)"]]) {
      const result = run(args); assert.notEqual(result.status, 0, JSON.stringify(args));
      assert.match(result.stderr, /Choose an existing plugin/);
    }
    assert.deepEqual(calls(), []);
    for (const command of ["dev", "build", "test", "typecheck", "browser"]) succeeds(run([command, "--", "sample"]));
    succeeds(run(["build", "PLUGIN=sample"], {}, path.join(root, "sample")));
    succeeds(run(["install", "--", "sample"]));
    succeeds(run(["install", "--", "no-lock"]));
    assert.deepEqual(calls().map(call => call.args), [
      ...["dev", "build", "test", "typecheck", "test:browser", "build"].map(script => ["--prefix", "sample", "run", script]),
      ["--prefix", "sample", "ci"], ["--prefix", "no-lock", "install"],
    ]);
    assert.ok(calls().every(call => call.cwd === root));
    fs.writeFileSync(log, "");
    succeeds(run(["check", "--", "sample"]));
    assert.deepEqual(calls().map(call => call.args.at(-1)), ["typecheck", "test", "build"]);
    fs.writeFileSync(log, "");
    assert.notEqual(run(["check", "--", "sample"], { TASK_TEST_FAIL: "test" }).status, 0);
    assert.deepEqual(calls().map(call => call.args.at(-1)), ["typecheck", "test"]);
    fs.writeFileSync(path.join(root, "sample/package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    fs.writeFileSync(log, "");
    const missing = run(["browser", "--", "sample"]);
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /does not define/);
    assert.deepEqual(calls(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
