import type { VFile } from "../types/server.d.ts";
import { cwd } from "node:process";
import { extname, join, relative } from "node:path";
import { lstat, readFile, writeFile } from "node:fs/promises";
import * as esbuild from "npm:esbuild@0.27.4";
import { ensureDir, exists, parseFlags, resolveModule } from "./utils.ts";

export async function run() {
  const flags = parseFlags();
  const start = performance.now();
  const runtime = flags.node as "node" | "fetch-server" | undefined ?? "fetch-server";
  await build({ runtime });
  console.log("\x1b[32m✨ Build completed.\x1b[0m", "\x1b[90m(%d ms)\x1b[0m", performance.now() - start);
}

export type BuildContext = {
  readonly indexHTML: IndexHTML;
  readonly tw?: TailwindBuilder;
  on(kind: "rebuild", callback: (result: esbuild.BuildResult) => void): () => void;
};

export type IndexHTML = {
  content: string;
  entryPoints: Record<string, string>;
};

export type TailwindBuilder = {
  entryCSS: string;
  build: () => Promise<string>;
  extractCandidatesFrom: (filename: string) => Promise<void>;
};

export type BuildOptions = {
  dir?: string;
  outdir?: string;
  target?: string;
  runtime?: "node" | "fetch-server";
  dev?: {
    signal?: AbortSignal;
    onWatch?: (ctx: BuildContext) => void;
  };
};

export async function build(options?: BuildOptions) {
  const workDir = join(cwd(), options?.dir ?? ".");
  const outdir = join(workDir, options?.outdir ?? "dist");
  if (!await exists(join(workDir, "index.html"))) {
    console.error("index.html not found");
    return;
  }

  const indexHTML = await paseIndexHtml(workDir);

  let twEntryCSS = null;
  for (const filename of Object.keys(indexHTML.entryPoints)) {
    if (filename.endsWith(".css")) {
      const css = await readFile(join(workDir, filename), "utf8");
      if (css.search(/@import\s+["']tailwindcss["']/) !== -1) {
        twEntryCSS = filename;
        break;
      }
    }
  }

  const devServer = options?.dev;
  const isDev = !!devServer;
  const tw = twEntryCSS ? initTailwindBuilder(workDir, twEntryCSS) : undefined;

  const endListeners = new Set<((result: esbuild.BuildResult) => void)>();
  const on = (kind: string, callback: (args: any) => void) => {
    if (kind === "rebuild") {
      endListeners.add(callback);
      return () => endListeners.delete(callback);
    }
    throw new Error("unknown event: " + kind);
  };

  const resolvePlugin: esbuild.Plugin = {
    name: "resolver",
    setup(b) {
      b.onResolve({ filter: /\.+/ }, async ({ resolveDir, path }) => {
        if (isUrl(path) || path.endsWith("?url")) {
          return { path, external: true };
        }
        let { pathname: filename } = new URL(path, "file://" + resolveDir + "/");
        if (filename.endsWith(".css") && tw && relative(workDir, filename) === tw.entryCSS) {
          return { path, namespace: "tw", watchFiles: [filename] };
        }
        if (extname(filename) === "") {
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
      b.onLoad({ filter: /\.+/, namespace: "tw" }, () => {
        // return placeholder for tailwind css
        return { contents: "", loader: "css" };
      });
      if (isDev) {
        b.onEnd((result) => endListeners.forEach(fn => fn(result)));
      }
    },
  };

  const ctx = await esbuild.context({
    absWorkingDir: workDir,
    entryPoints: Object.keys(indexHTML.entryPoints),
    outdir,
    outbase: workDir,
    splitting: true,
    bundle: true,
    treeShaking: true,
    minify: true,
    write: false,
    sourcemap: isDev ? "linked" : undefined,
    platform: "browser",
    format: "esm",
    target: options?.target ?? "es2022",
    jsx: "automatic",
    jsxImportSource: "mono-jsx-dom",
    jsxDev: isDev,
    plugins: [resolvePlugin],
  });
  const dispose = async () => {
    await ctx.dispose();
    await esbuild.stop();
  };

  if (isDev) {
    devServer.signal?.addEventListener("abort", dispose);
    devServer.onWatch?.({ indexHTML, tw, on });
    await ctx.watch();
    return;
  }

  // create build.json
  const vfs: Record<string, VFile> = {};
  const { outputFiles } = await ctx.rebuild();
  for (const file of outputFiles) {
    const contentType = file.path.endsWith(".js") ? "application/javascript" : "text/css";
    const filename = relative(outdir, file.path);
    vfs[filename] = await createVFile(indexHTML, filename, file.text, contentType);
  }
  if (tw) {
    const css = await tw.build();
    vfs[tw.entryCSS] = await createVFile(indexHTML, tw.entryCSS, css, "text/css");
  }
  vfs["index.html"] = await createVFile(indexHTML, "index.html", indexHTML.content, "text/html");
  await ensureDir(outdir);
  await writeFile(join(outdir, "build.json"), JSON.stringify(vfs, null, 2));

  // build server.js
  const extraJS = [
    'import server$ from "mono-jsx-dom/server";',
    'import buildJSON$ from "./build.json" with { type: "json" };',
    "server$.setVFS(new Map(Object.entries(buildJSON$)));",
  ].join("");
  await buildServerJS(workDir, outdir, options?.runtime, extraJS);

  await dispose();
}

export async function buildServerJS(
  workDir: string,
  outdir: string,
  runtime: BuildOptions["runtime"] = "fetch-server",
  extraJS?: string,
  watch?: { signal?: AbortSignal; onRebuild?: (result: esbuild.BuildResult) => void },
) {
  const stdin: esbuild.BuildOptions["stdin"] = {
    sourcefile: join(workDir, "server.js"),
    contents: 'import server from "mono-jsx-dom/server;export default server;',
    loader: "js",
  };
  for (const loader of ["ts", "tsx", "js", "jsx"] as const) {
    const sourcefile = join(workDir, "server." + loader);
    if (await exists(sourcefile)) {
      if (runtime === "node") {
        stdin.sourcefile = join(workDir, "server-node.mjs");
        stdin.resolveDir = workDir;
        stdin.contents = [
          'import { serve$ } from "mono-jsx-dom/server/node-fetch-server";',
          'import server$ from "./server.' + loader + '";',
          "serve$(server$);",
        ].join("\n");
        stdin.loader = "js";
      } else {
        stdin.sourcefile = sourcefile;
        stdin.contents = await readFile(sourcefile, "utf8");
        stdin.loader = loader;
      }
      break;
    }
  }

  const esbOptions: esbuild.BuildOptions = {
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
    external: ["mono-jsx-dom/server", "mono-jsx-dom/server/node-fetch-server"],
  };
  if (extraJS) {
    esbOptions.banner = { js: extraJS };
  }
  if (watch?.onRebuild) {
    esbOptions.plugins = [{
      name: "onend",
      setup(build) {
        build.onEnd((result) => {
          watch.onRebuild!(result);
        });
      },
    }];
  }
  const ctx = await esbuild.context(esbOptions);
  if (watch) {
    watch.signal?.addEventListener("abort", ctx.dispose.bind(ctx));
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

function initTailwindBuilder(workDir: string, entryCSS: string): TailwindBuilder {
  const tailwind = import("npm:tailwindcss@4.2.1");
  const oxide = import("npm:oxide-wasm@0.1.1").then(m => m.init().then(() => m));
  const builder = {
    entryCSS: entryCSS,
    etag: null as null | string,
    builtCSS: null as null | string,
    files: new Map<string, number>(),
    candidates: new Set<string>(),
    compiler: null as null | Awaited<ReturnType<Awaited<typeof tailwind>["compile"]>>,
    async build() {
      if (this.builtCSS !== null) {
        return this.builtCSS;
      }
      const filename = join(workDir, this.entryCSS);
      const stats = await lstat(filename);
      const etag = stats.mtime.getTime() + "-" + stats.size;
      if (!this.compiler || this.etag !== etag) {
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
        this.etag = etag;
      }
      return this.builtCSS = this.compiler.build([...this.candidates]);
    },
    async extractCandidatesFrom(filename: string) {
      const stats = await lstat(filename);
      const modtime = stats.mtime.getTime();
      const prev = this.files.get(filename);
      if (prev === undefined || prev !== modtime) {
        const candidates = (await oxide).extract(await readFile(filename, "utf8"));
        for (const candidate of candidates) {
          if (!this.candidates.has(candidate)) {
            this.candidates.add(candidate);
            this.builtCSS = null;
          }
        }
        this.files.set(filename, modtime);
      }
    },
  };
  return builder as unknown as TailwindBuilder;
}

async function paseIndexHtml(workDir: string): Promise<IndexHTML> {
  let content = await readFile(join(workDir, "index.html"), "utf8");
  let entryPoints: Record<string, string> = {};

  // search style links
  content = content.replace(/<link(\s[^>]*?)href="([^"]+\.css)"\s*>/g, (tag, attrs, href) => {
    if (isUrl(href)) {
      return tag;
    }
    const relativePath = relative(workDir, join(workDir, href));
    entryPoints[relativePath] = relativePath;
    return `<link${attrs} href="/${relativePath}">`;
  });

  // search js scripts
  content = content.replace(/<script(\s[^>]*?)src="([^"]+\.(ts|tsx|js|jsx|mjs))"\s*>/g, (tag, attrs, src) => {
    if (isUrl(src)) {
      return tag;
    }
    const relativePath = relative(workDir, join(workDir, src));
    const resolvedPath = relativePath.slice(0, relativePath.lastIndexOf(".")) + ".js";
    entryPoints[relativePath] = resolvedPath;
    return `<script${attrs} src="/${resolvedPath}">`;
  });

  return { content, entryPoints };
}

async function createVFile(indexHTML: IndexHTML, filename: string, content: string, contentType: string): Promise<VFile> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const contentHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (filename !== "index.html") {
    const ext = extname(filename);
    if (ext !== ".css" && ext !== ".js") {
      filename = filename.slice(0, -ext.length) + ".js";
    }
    indexHTML.content = indexHTML.content.replace('"/' + filename + '"', '"/' + filename + "?hash=" + hash.slice(0, 8) + '"');
  }
  return {
    content,
    contentType,
    contentHash,
    lastModified: Date.now(),
  };
}

function isUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}
