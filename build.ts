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
    external: ["node:*", "*.mjs"],
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
  const eol = "\n";
  const start = performance.now();
  const binJS = [
    `#!/usr/bin/env node`,
    ``,
    `import process from "node:process";`,
    `import { setup } from "../setup.mjs";`,
    ``,
    `switch (process.argv[2]) {`,
    `  case "setup":`,
    `    setup()`,
    `    break;`,
    `  default:`,
    `    process.exit(0);`,
    `}`,
    ``,
  ].join(eol);

  for (const moduleName of ["setup", "index", "jsx-runtime"]) {
    const { size, gzippedSize } = await buildPackageModule(moduleName, "esm");
    console.log(`· ${moduleName}.mjs %c(${formatBytes(size)}, ${formatBytes(gzippedSize)} gzipped)`, "color:grey");
  }

  await Deno.mkdir("./bin", { recursive: true });
  Deno.writeTextFile("./bin/mono-jsx-dom", binJS, { mode: 0o755 });

  console.log("%cBuild complete! (%d ms)", "color:grey", performance.now() - start);
  stop();
}
