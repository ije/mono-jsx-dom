import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { cwd } from "node:process";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { init } from "../bin/init.ts";
import { build } from "../bin/build.ts";

const appName = "mono-test-app";

Deno.test.beforeAll(async () => {
  await rm(appName, { recursive: true, force: true });
  await init({ dir: join(cwd(), appName), appName, tailwindCSS: true, wrangler: false });
  await build({ appName, serverType: "node" });
});

Deno.test("build", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const serverJs = await Deno.readTextFile(join(cwd(), appName, "dist", "server.mjs"));
  assertStringIncludes(serverJs, 'import server$ from "mono-jsx-dom/server";');
  assertStringIncludes(serverJs, 'import buildJSON$ from "./build.json" with { type: "json" };');
  assertStringIncludes(serverJs, "server$.setVFS(new Map(Object.entries(buildJSON$)));");
  assertStringIncludes(serverJs, 'from"mono-jsx-dom/server/node-fetch-server";');

  const buildJSON = JSON.parse(await Deno.readTextFile(join(cwd(), appName, "dist", "build.json")));
  assertEquals(Object.keys(buildJSON).length, 3);
  assertEquals(Object.keys(buildJSON).sort(), ["app/main.js", "app/style.css", "index.html"]);
  assertStringIncludes(buildJSON["app/main.js"].content, "HTMLElement.prototype.mount=");
  assertStringIncludes(buildJSON["app/style.css"].content, "/*! tailwindcss v");
  assertStringIncludes(
    buildJSON["index.html"].content,
    'href="/app/style.css?hash=' + buildJSON["app/style.css"].contentHash.slice(0, 8) + '"',
  );
  assertStringIncludes(buildJSON["index.html"].content, 'src="/app/main.js?hash=' + buildJSON["app/main.js"].contentHash.slice(0, 8) + '"');
});
