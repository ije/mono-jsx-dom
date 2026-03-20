import type { ASSETS, VFS } from "../types/server.d.ts";

let vfs: VFS = new Map();
let assets: ASSETS | undefined;

export const server = {
  fetch: async (req: Request, env?: any) => {
    const { pathname, searchParams } = new URL(req.url);
    let filename = pathname.slice(1) || "index.html";
    if (!vfs.has(filename)) {
      const a = assets ?? env?.ASSETS;
      if (a && !filename.startsWith(".")) {
        const res = await a.fetch(req);
        if (res.ok) {
          return res;
        }
      }
      filename = "index.html";
    }
    if (!vfs.has(filename)) {
      return new Response(
        // "Not Found"
        new Uint8Array([78, 111, 116, 32, 70, 111, 117, 110, 100]),
        { status: 404 },
      );
    }
    const file = vfs.get(filename)!;
    const headers: Record<string, string> = {};
    if (filename === "index.html") {
      headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    } else {
      // check etag for static files
      const ifNoneMatch = req.headers.get("If-None-Match");
      const etag = '"' + file.hash + '"';
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304 });
      }
      if (searchParams.get("hash") || filename.startsWith("chunk-")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      } else {
        headers["Cache-Control"] = "public, max-age=600";
      }
      headers["ETag"] = etag;
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
