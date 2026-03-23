import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";

import { cwd } from "node:process";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { init } from "../bin/init.ts";
import { dev } from "../bin/dev.ts";

const appName = "mono-test-app";
const ac = new AbortController();

Deno.test.beforeAll(async () => {
  await rm(appName, { recursive: true, force: true });
  await init({ dir: join(cwd(), appName), appName, tailwindCSS: true, wrangler: false });
  await dev({ appName, ac });
  while (true) {
    try {
      await fetch("http://localhost:3000/");
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
});

Deno.test.afterAll(() => {
  ac.abort();
});

Deno.test("dev", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const res = await fetch("http://localhost:8798/__dev_vfs.json");
  assertEquals(res.status, 200);
  const vfs = await res.json();
  assert(Array.isArray(vfs));
  assertEquals(vfs.length, 3);
  vfs.sort((a, b) => a[0].localeCompare(b[0]));
  assertEquals(vfs[0][0], "app/main.js");
  assertEquals(vfs[0][1], "http://localhost:8798/app/main.js");
  assertEquals(vfs[1][0], "app/style.css");
  assertEquals(vfs[1][1], "http://localhost:8798/app/style.css");
  assertEquals(vfs[2][0], "index.html");
  assertStringIncludes(vfs[2][1].content, "<!DOCTYPE html>");
  assertEquals(vfs[2][1].contentType, "text/html");

  const res2 = await fetch("http://localhost:8798/__hot");
  assertEquals(res2.status, 200);
  assertEquals(res2.headers.get("Content-Type"), "text/event-stream");
  res2.body?.cancel();

  const res3 = await fetch("http://localhost:3000/");
  assertEquals(res3.status, 200);
  assertEquals(res3.headers.get("Content-Type"), "text/html");
  const text = await res3.text();
  assertStringIncludes(text, "<!DOCTYPE html>");
  assertStringIncludes(text, '<link rel="stylesheet" href="/app/style.css">');
  assertStringIncludes(text, '<script type="module" src="/app/main.js"></script>');
  assertStringIncludes(
    text,
    '<script>new EventSource("http://localhost:8798/__hot").addEventListener("rebuild",()=>location.reload())</script>',
  );

  const res4 = await fetch("http://localhost:3000/data/word");
  assertEquals(res4.status, 200);
  assertEquals(await res4.text(), "world");

  const res6 = await fetch("http://localhost:3000/app/main.js");
  assertEquals(res6.status, 200);
  assertEquals(res6.headers.get("Content-Type"), "application/javascript");
  const js = await res6.text();
  assertStringIncludes(js, "HTMLElement.prototype.mount=");
  assertStringIncludes(js, '("div",{');
  assertStringIncludes(js, 'fileName:"app/main.tsx"');

  const res7 = await fetch("http://localhost:3000/app/style.css");
  assertEquals(res7.status, 200);
  assertEquals(res7.headers.get("Content-Type"), "text/css");
  assertStringIncludes(await res7.text(), "/*! tailwindcss v");
});
