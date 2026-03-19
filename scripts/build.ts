import { build, stop, transform } from "npm:esbuild@0.27.4";

async function buildPackageModule(name: string, format: "esm" | "cjs" = "esm") {
  const entryPointPath = `./${name}.ts`;
  const outfile = `./${name}.` + (format === "esm" ? "mjs" : "cjs");
  await build({
    entryPoints: [entryPointPath],
    outfile,
    format,
    target: "esnext",
    bundle: true,
    minify: false,
    external: ["node:*", "cloudflare:*", "*.mjs"],
    plugins: [{
      name: "npm-specifier",
      setup(b) {
        b.onResolve({ filter: /^npm:.+/ }, (args) => {
          const path = args.path.slice(4).split("@", 1)[0];
          return { path, external: true };
        });
      },
    }],
  });
  const gzippedSize = await getGzippedSize(await Deno.readTextFile(outfile));
  return {
    size: (await Deno.lstat(outfile)).size,
    gzippedSize,
  };
}

async function getGzippedSize(code: string, minify: boolean = true): Promise<number> {
  if (minify) {
    code = (await transform(code, {
      loader: "js",
      platform: "browser",
      format: "esm",
      target: "es2022",
      minify: true,
    })).code;
  }
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(code));
      controller.close();
    },
  });
  const res = new Response(readableStream.pipeThrough(new CompressionStream("gzip")));
  const buffer = await res.arrayBuffer();
  return buffer.byteLength;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString() + "B";
}

if (import.meta.main) {
  const start = performance.now();

  for await (const entry of Deno.readDir(".")) {
    if (entry.isFile && entry.name.endsWith(".mjs")) {
      await Deno.remove(entry.name);
    }
  }

  for (
    const moduleName of [
      "bin/init",
      "bin/dev",
      "bin/build",
      "index",
      "jsx-runtime",
      "server/index",
      "server/workerd",
      "server/node-fetch-server",
    ]
  ) {
    const { size, gzippedSize } = await buildPackageModule(moduleName, "esm");
    console.log(`· ${moduleName}.mjs %c(${formatBytes(size)}, ${formatBytes(gzippedSize)} gzipped)`, "color:grey");
  }

  await Deno.mkdir("./bin", { recursive: true });

  console.log("%cBuild complete! (%d ms)", "color:grey", performance.now() - start);
  stop();
}
