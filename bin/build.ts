import type { VFile } from "../types/server.d.ts";
import { cwd } from "node:process";
import { extname, join, relative } from "node:path";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import * as esbuild from "npm:esbuild@0.27.4";

const buildPipeline = Promise.withResolvers<{ indexHTML: string }>();

export type BuildOptions = {
  dir?: string;
  outdir?: string;
  target?: string;
  runtime?: "node" | "fetch-server";
  dev?: {
    port: number;
    signal?: AbortSignal;
  };
};

export async function build(options?: BuildOptions) {
  const start = performance.now();
  const workDir = join(cwd(), options?.dir ?? ".");

  if (!await exists(join(workDir, "index.html"))) {
    console.error("index.html not found");
    return;
  }

  let entryPoints = new Array<string>();
  let styleLinks = new Array<string>();

  let indexHTML = (await readFile(join(workDir, "index.html"), "utf8"))
    .replace(/<link(\s[^>]*?)href="([^"]+\.css)"\s*>/g, (tag, attrs, href) => {
      if (isUrl(href)) {
        return tag;
      }
      const relativePath = relative(workDir, join(workDir, href));
      styleLinks.push(relativePath);
      return `<link${attrs} href="/${relativePath}">`;
    })
    .replace(/<script(\s[^>]*?)src="([^"]+\.(ts|tsx|js|jsx|mjs))"\s*>/g, (tag, attrs, src) => {
      if (isUrl(src)) {
        return tag;
      }
      const relativePath = relative(workDir, join(workDir, src));
      entryPoints.push(relativePath);
      return `<script${attrs} src="/${relativePath.slice(0, relativePath.lastIndexOf("."))}.js">`;
    });

  const createVFile = async (filename: string, content: string, contentType: string) => {
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (filename !== "index.html") {
      const ext = extname(filename);
      if (ext !== ".css" && ext !== ".js") {
        filename = filename.slice(0, -ext.length) + ".js";
      }
      indexHTML = indexHTML.replace('"/' + filename + '"', '"/' + filename + "?hash=" + hash.slice(0, 8) + '"');
    }
    return {
      content,
      contentType,
      hash: hash,
      lastModified: Date.now(),
    };
  };

  let tailwindEntryCSS = null;
  for (let filename of styleLinks) {
    const css = await readFile(join(workDir, filename), "utf8");
    if (css.search(/@import\s+["']tailwindcss["']/) !== -1) {
      tailwindEntryCSS = filename;
      break;
    }
  }

  let tw: {
    entryCSS: { filename: string; etag?: string };
    builtCSS: null | string;
    build: () => Promise<void>;
    extractCandidatesFrom: (filename: string) => Promise<void>;
  } | undefined;

  if (tailwindEntryCSS) {
    const tailwind = import("npm:tailwindcss@4.2.1");
    const oxide = import("npm:oxide-wasm@0.1.1").then(m => m.init().then(() => m));
    const builder = {
      entryCSS: { filename: tailwindEntryCSS } as { filename: string; etag?: string },
      builtCSS: null as null | string,
      files: new Map<string, number>(),
      candidates: new Set<string>(),
      compiler: null as null | Awaited<ReturnType<Awaited<typeof tailwind>["compile"]>>,
      async build() {
        const filename = join(workDir, this.entryCSS.filename);
        const stats = await lstat(filename);
        const etag = stats.mtime.getTime() + "-" + stats.size;
        if (!this.compiler || this.entryCSS.etag !== etag) {
          let entryCSS = await readFile(filename, "utf8");
          this.compiler = await (await tailwind).compile(entryCSS, {
            async loadStylesheet(id, base) {
              if (id === "tailwindcss") {
                const path = join(workDir, "node_modules/tailwindcss/index.css");
                const content = await readFile(path, "utf8");
                return { path, base, content };
              }
              throw new Error("not found: " + id);
            },
          });
          this.entryCSS.etag = etag;
        }
        this.builtCSS = this.compiler.build([...this.candidates]);
      },
      async extractCandidatesFrom(filename: string) {
        const stats = await lstat(filename);
        const modtime = stats.mtime.getTime();
        const prev = this.files.get(filename);
        if (prev === undefined || prev !== modtime) {
          for (const candidate of (await oxide).extract(await readFile(filename, "utf8"))) {
            if (!this.candidates.has(candidate)) {
              this.candidates.add(candidate);
              this.builtCSS = null;
            }
          }
          this.files.set(filename, modtime);
        }
      },
    };
    tw = builder;
  }

  const resolvePlugin: esbuild.Plugin = {
    name: "resolver",
    setup(b) {
      b.onResolve({ filter: /\.+/ }, async ({ resolveDir, path }) => {
        if (isUrl(path) || path.endsWith("?url")) {
          return { path, external: true };
        }
        let { pathname: filename } = new URL(path, "file://" + resolveDir + "/");
        let ext = extname(filename);
        if (ext === "") {
          if (await exists(filename) && (await lstat(filename)).isDirectory()) {
            filename = filename + "/index";
          }
          const resolved = await resolveModule(filename);
          if (resolved) {
            filename = resolved;
          }
        }
        if (filename.endsWith(".tsx") || filename.endsWith(".jsx")) {
          await tw?.extractCandidatesFrom(filename);
        }
        return {};
      });
    },
  };

  const dev = options?.dev;
  const outdir = join(workDir, options?.outdir ?? "dist");
  const target = options?.target ?? "es2022";

  const ctx = await esbuild.context({
    entryPoints,
    absWorkingDir: workDir,
    outdir,
    outbase: workDir,
    splitting: true,
    bundle: true,
    treeShaking: true,
    minify: true,
    write: false,
    sourcemap: dev ? "linked" : undefined,
    platform: "browser",
    format: "esm",
    target,
    jsx: "automatic",
    jsxImportSource: "mono-jsx-dom",
    jsxDev: !!dev,
    plugins: [resolvePlugin],
  });

  if (dev) {
    await ctx.serve({ port: dev.port });
    await ctx.watch();
    if (dev.signal) {
      dev.signal.addEventListener("abort", ctx.dispose.bind(ctx));
    }
    buildPipeline.resolve({ indexHTML });
  } else {
    const result = await ctx.rebuild();
    await ctx.dispose();

    // build build.json
    {
      const vfs: Record<string, VFile> = {};
      for (const file of result.outputFiles) {
        const contentType = file.path.endsWith(".js") ? "application/javascript" : "text/css";
        const filename = relative(outdir, file.path);
        vfs[filename] = await createVFile(filename, file.text, contentType + "; charset=utf-8");
      }
      if (tw) {
        await tw.build();
        if (tw.builtCSS) {
          const filename = tw.entryCSS.filename;
          vfs[filename] = await createVFile(filename, await minifyCSS(tw.builtCSS), "text/css");
        }
      }
      for (const filename of styleLinks) {
        if (filename !== tw?.entryCSS.filename) {
          const content = await bundleCSS(join(workDir, filename));
          vfs[filename] = await createVFile(filename, content, "text/css");
        }
      }
      vfs["index.html"] = await createVFile("index.html", indexHTML, "text/html");
      await ensureDir(outdir);
      await writeFile(join(outdir, "build.json"), JSON.stringify(vfs, null, 2));
    }

    const js = 'import server from "mono-jsx-dom/server";'
      + 'import build from "./build.json" with { type: "json" };'
      + "server.setVFS(new Map(Object.entries(build)));";

    // build server.js
    {
      const stdin = {
        sourcefile: join(workDir, "server.js"),
        contents: 'import server from "mono-jsx-dom/server;export default server;',
        loader: "ts" as esbuild.Loader,
      };
      for (const loader of ["ts", "tsx", "js", "jsx"] as const) {
        const sourcefile = join(workDir, "server." + loader);
        if (await exists(sourcefile)) {
          stdin.sourcefile = sourcefile;
          stdin.contents = await readFile(sourcefile, "utf8");
          stdin.loader = loader;
          break;
        }
      }
      await esbuild.build({
        stdin: stdin,
        absWorkingDir: workDir,
        outfile: join(outdir, "server.mjs"),
        bundle: true,
        treeShaking: true,
        minify: true,
        write: true,
        platform: "node",
        format: "esm",
        target: "es2024",
        external: ["mono-jsx-dom/server"],
        banner: options?.runtime === "node" ? undefined : { js },
      });
    }

    // use node-fetch-server for node runtime
    if (options?.runtime === "node") {
      const stdin = {
        sourcefile: join(outdir, "server-node.mjs"),
        resolveDir: outdir,
        contents: [
          'import { serve } from "mono-jsx-dom/server/node-fetch-server";',
          'import server from "./server.mjs";',
          "serve(server);",
        ].join("\n"),
        loader: "js" as esbuild.Loader,
      };
      await esbuild.build({
        stdin,
        absWorkingDir: workDir,
        outfile: join(outdir, "server.mjs"),
        bundle: true,
        treeShaking: true,
        minify: true,
        write: true,
        allowOverwrite: true,
        platform: "node",
        format: "esm",
        target: "es2024",
        external: ["mono-jsx-dom/server", "mono-jsx-dom/server/node-fetch-server"],
        banner: { js },
      });
    }

    console.log("\x1b[32m✅ build complete\x1b[0m", "\x1b[90m(%d ms)\x1b[0m", performance.now() - start);
  }
}

function isUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

async function exists(filename: string) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string) {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

async function resolveModule(filename: string) {
  for (const ext of [".tsx", ".ts", ".jsx", ".mjs", ".js"]) {
    const path = filename + ext;
    if (await exists(path)) {
      return path;
    }
  }
  return null;
}

async function bundleCSS(filename: string) {
  const result = await esbuild.build({
    entryPoints: [filename],
    platform: "browser",
    target: "es2022",
    bundle: true,
    minify: true,
    write: false,
  });
  return result.outputFiles[0].text;
}

async function minifyCSS(content: string) {
  const result = await esbuild.transform(content, {
    loader: "css",
    platform: "browser",
    target: "es2022",
    minify: true,
  });
  return result.code;
}
