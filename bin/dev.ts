import type { VFile } from "../types/server.d.ts";
import type { BuildContext } from "./build.ts";
import { cwd, env, exit, versions } from "node:process";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import { parseFlags, resolveModule } from "./utils.ts";

// external modules, do not remove the `.mjs` extension
import { build } from "./build.mjs";

export type DevOptions = {
  dir?: string;
  outdir?: string;
  port?: number;
};

export async function dev(options?: DevOptions) {
  const ac = new AbortController();
  const isBun = "Bun" in globalThis;
  const workDir = join(cwd(), options?.dir ?? ".");
  const outdir = join(workDir, options?.outdir ?? "dist");
  const port = options?.port ?? 3000;
  const devServerPort = 8798;
  const devServerUrl = "http://localhost:" + devServerPort;
  const hotReloadJS = `new EventSource("${devServerUrl}/__hot").addEventListener("rebuild",()=>location.reload())`;
  const serv = async (ctx: BuildContext) => {
    const tw = ctx.tw;
    const buildVFS = new Map<string, VFile>();
    ctx.on("rebuild", (result) => {
      result.outputFiles?.forEach(file => {
        const filename = relative(outdir, file.path);
        const prev = buildVFS.get(filename);
        if (!prev || prev.contentHash !== file.hash) {
          buildVFS.set(filename, {
            content: file.contents,
            contentType: file.path.endsWith(".js") ? "application/javascript" : "text/css",
            contentHash: file.hash,
            lastModified: Date.now(),
          });
        }
      });
    });

    // start dev server
    await serve({
      port: devServerPort,
      idleTimeout: 32, // 32 seconds
      fetch: async (req: Request) => {
        const { pathname } = new URL(req.url);
        if (pathname === "/__dev_vfs.json") {
          const { entryPoints, content } = ctx.indexHTML;
          const devVFS: [string, VFile | string][] = [
            ...Object.entries(entryPoints).map<[string, string]>(([_entryPoint, resolvedPath]) => {
              return [resolvedPath, devServerUrl + "/" + resolvedPath];
            }),
            [
              "index.html",
              {
                content: content + "\n<script>" + hotReloadJS + "</script>",
                contentType: "text/html",
                lastModified: Date.now(),
              } satisfies VFile,
            ],
          ];
          return Response.json(devVFS);
        }
        if (pathname === "/__hot") {
          let interval: ReturnType<typeof setInterval> | null = null;
          let disposed: (() => void) | null = null;
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              interval = setInterval(() => {
                controller.enqueue(encoder.encode(":\n\n")); // keep-alive ping
              }, 30_000);
              disposed = ctx.on("rebuild", () => {
                controller.enqueue(encoder.encode("event: rebuild\ndata: \n\n"));
              });
              controller.enqueue(encoder.encode("retry: 500\n"));
            },
            cancel() {
              if (interval) {
                clearInterval(interval);
                interval = null;
              }
              if (disposed) {
                disposed();
                disposed = null;
              }
            },
          });
          return new Response(stream, {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "text/event-stream",
              "Connection": "keep-alive",
              "Cache-Control": "no-cache",
            },
          });
        }
        const filename = pathname.slice(1);
        if (buildVFS.has(filename)) {
          if (tw && filename == tw.entryCSS) {
            const css = await tw.build();
            return new Response(css, {
              headers: {
                "Content-Type": "text/css",
                "Cache-Control": "public, max-age=0, must-revalidate",
              },
            });
          }
          const { content, contentType, contentHash, lastModified } = buildVFS.get(filename)!;
          const headers: Record<string, string> = {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=0, must-revalidate",
            "Last-Modified": new Date(lastModified).toUTCString(),
          };
          if (contentHash) {
            const etag = 'w/"' + contentHash + '"';
            if (req.headers.get("If-None-Match") === etag) {
              return new Response(null, { status: 304 });
            }
            headers["ETag"] = etag;
          }
          return new Response(content, { headers });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const serverScript = (await resolveModule(join(workDir, "server"), [".ts", ".mjs", ".js"]))
      ?? join(workDir, "node_modules/mono-jsx-dom/server/index.mjs");
    const serverProcess = spawn(
      isBun ? "bun" : "node",
      ["--watch", serverScript, "--port", port.toString()],
      {
        cwd: workDir,
        env: { ...env, DEV_SERVER: devServerUrl },
        stdio: "inherit",
      },
    );
    serverProcess.on("close", () => ac.abort());
  };
  const onError = (error: Error) => {
    console.error(error);
    ac.abort();
  };

  if (!isBun) {
    const [major, minor] = versions.node.slice(1).split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 18)) {
      console.error("Node.js version 22.18.0 or higher is required to use the dev command.");
      exit(1);
    }
  }

  await build({
    dir: options?.dir,
    outdir: options?.outdir,
    dev: {
      signal: ac.signal,
      onWatch: (ctx: BuildContext) => serv(ctx).catch(onError),
    },
  }).catch(onError);
}

type ServeOptions = {
  port: number;
  fetch: (req: Request) => Response | Promise<Response>;
  signal?: AbortSignal;
  idleTimeout?: number;
};

async function serve(options: ServeOptions) {
  // @ts-ignore
  const serve = globalThis.Bun?.serve;
  if (serve) {
    const server = serve(options);
    options.signal?.addEventListener("abort", () => server.stop());
  } else {
    await import("../server/node-fetch-server.mjs").then(m => m.serve(options));
  }
}

export function run() {
  const flags = parseFlags();
  const port = typeof flags.port === "string" && flags.port.match(/^\d+$/) ? parseInt(flags.port) : 3000;
  return dev({ port });
}
