import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { server } from "./workerd.mjs";
import { getContentType } from "./media-type.ts";

// serve 'public' directory as assets
server.setAssets({
  fetch: async (request: Request) => {
    const { pathname } = new URL(request.url);
    const filename = join(cwd(), "public", pathname);
    console.log(filename);
    try {
      const stats = await lstat(filename);
      if (stats.isDirectory()) {
        return new Response("not found", { status: 404 });
      }
      const etag = 'w/"' + stats.mtime.getTime() + "-" + stats.size + '"';
      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
      }
      const headers: Record<string, string> = {
        "Content-Type": getContentType(filename),
      };
      headers["ETag"] = etag;
      headers["Last-Modified"] = stats.mtime.toUTCString();
      headers["Cache-Control"] = "public, max-age=0, must-revalidate";
      return new Response(await readFile(filename), { headers });
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        return new Response("not found", { status: 404 });
      }
      console.error(error);
      return new Response("internal server error", { status: 500 });
    }
  },
});

export { server };
export default server;
