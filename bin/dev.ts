import type { VFile } from "../types/server.d.ts";
import type { BuildContext } from "./build.ts";
import { cwd, env, exit, versions } from "node:process";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import { parseFlags, resolveModule } from "./utils.ts";
import { build } from "./build.ts";

export type DevOptions = {
  ac?: AbortController;
  appName?: string;
  outdir?: string;
  port?: number;
};

export async function dev(options?: DevOptions) {
  const runtime = "Deno" in globalThis ? "deno" : "Bun" in globalThis ? "bun" : "node";
  const ac = options?.ac ?? new AbortController();
  const workDir = join(cwd(), options?.appName ?? ".");
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
      hostname: "localhost",
      idleTimeout: 32, // 32 seconds
      onListen: (_localAddress) => {
        // quit dev server
      },
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
    const args = ["--watch", serverScript];
    if (runtime === "node") {
      args.push("--port", port.toString());
    } else {
      args.unshift("--port", port.toString());
    }
    if (runtime === "deno") {
      args.unshift("serve", "-A");
    }
    const serverProcess = spawn(
      runtime,
      args,
      {
        cwd: workDir,
        env: { ...env, DEV_SERVER: devServerUrl },
        stdio: "inherit",
      },
    );
    const onClose = () => ac.abort();
    serverProcess.on("close", onClose);
    ac.signal.addEventListener("abort", () => {
      serverProcess.off("close", onClose);
      serverProcess.kill();
    });
  };
  const onError = (error: Error) => {
    console.error(error);
    ac.abort();
  };

  if (runtime === "node") {
    const [major, minor] = versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 18)) {
      console.error("Node.js version 22.18.0 or higher is required to use the dev command.");
      exit(1);
    }
  }

  // deno-lint-ignore no-process-global
  process.on("SIGINT", () => {
    console.log("\x1b[90mShutting down dev server...\x1b[0m");
    ac.abort();
    exit(0);
  });

  await build({
    appName: options?.appName,
    outdir: options?.outdir,
    dev: {
      signal: ac.signal,
      onWatch: (ctx: BuildContext) => serv(ctx).catch(onError),
    },
  }).catch(onError);
}

type ServeOptions = {
  fetch: (req: Request) => Response | Promise<Response>;
  onListen?: (localAddress: { port: number }) => void;
  port: number;
  hostname?: string;
  signal?: AbortSignal;
  idleTimeout?: number;
};

async function serve(options: ServeOptions) {
  const denoServe = globalThis.Deno?.serve;
  // @ts-ignore
  const bunServe = globalThis.Bun?.serve;
  if (denoServe) {
    const { fetch, port, signal, hostname, onListen } = options;
    denoServe(
      {
        port,
        signal: signal,
        hostname: hostname,
        onListen: onListen ?? ((localAddress) => {
          console.log(`Server is running on http://${hostname ?? "localhost"}:${localAddress.port}`);
        }),
      },
      fetch,
    );
  } else if (bunServe) {
    const server = bunServe(options);
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
