import type { ASSETS, VFS } from "../types/server.d.ts";

let assets: ASSETS | undefined;
let vfs: VFS | undefined;
let vfsPromise: Promise<void> | undefined;

export const server = {
  fetch: async (req: Request, env?: any) => {
    const { pathname, searchParams } = new URL(req.url);

    if (!vfs) {
      const devServer = env?.DEV_SERVER ?? globalThis.process?.env?.DEV_SERVER;
      if (devServer) {
        const onError = (error: any) => console.warn("Failed to fetch dev vfs from " + devServer, error);
        vfsPromise ??= fetch(devServer + "/__dev_vfs.json")
          .then(async res => {
            if (!res.ok) {
              onError(res.statusText);
              return;
            }
            vfs = new Map(await res.json());
          })
          .catch(onError);
        await vfsPromise;
      }
    }

    let filename = pathname.slice(1) || "index.html";
    if (!vfs?.has(filename)) {
      const a = assets ?? env?.ASSETS;
      if (a && !filename.startsWith(".")) {
        const res = await a.fetch(req);
        if (res.ok) {
          return res;
        }
      }
      filename = "index.html";
    }
    if (!vfs?.has(filename)) {
      return new Response(
        new Uint8Array([78, 111, 116, 32, 70, 111, 117, 110, 100]), // "Not Found"
        { status: 404, headers: { "Content-Type": "text/plain" } },
      );
    }
    const file = vfs.get(filename)!;
    if (typeof file === "string" || file instanceof URL) {
      return fetch(file);
    }
    const headers: Record<string, string> = {};
    if (filename === "index.html") {
      headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    } else {
      // check etag for static files
      if (file.contentHash) {
        const etag = '"' + file.contentHash + '"';
        if (req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        headers["ETag"] = etag;
      }
      if (searchParams.get("hash") || filename.startsWith("chunk-")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      } else {
        headers["Cache-Control"] = "public, max-age=600";
      }
    }
    headers["Content-Type"] = file.contentType;
    headers["Last-Modified"] = new Date(file.lastModified).toUTCString();
    return new Response(file.content, { headers });
  },
  setVFS: (newVFS: VFS) => {
    vfs = newVFS;
  },
  setAssets: (newAssets: ASSETS) => {
    assets = newAssets;
  },
};

export default server;
