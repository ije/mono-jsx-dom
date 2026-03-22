// based on https://github.com/remix-run/remix/tree/main/packages/node-fetch-server

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Fetch = (request: Request) => Response | Promise<Response>;

function createRequestListener(fetch: Fetch, options?: ServeOptions) {
  const onError = options?.onError ?? defaultErrorHandler;
  const idleTimeout = options?.idleTimeout;
  return async (req: IncomingMessage, res: ServerResponse) => {
    let response;
    if (idleTimeout !== undefined) {
      req.socket.setTimeout(idleTimeout * 1000);
    }
    try {
      response = await fetch(createRequest(req, res, options));
    } catch (error) {
      try {
        response = await onError(error as Error) ?? internalServerError();
      } catch (error2) {
        console.error(`There was an error in the error handler: ${error2}`);
        response = internalServerError();
      }
    }
    await sendResponse(res, response);
  };
}

async function* readStream(stream: ReadableStream) {
  let reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function defaultErrorHandler(error: Error) {
  console.error(error);
  return internalServerError();
}

function internalServerError() {
  return new Response(
    // "Internal Server Error"
    new Uint8Array([73, 110, 116, 101, 114, 110, 97, 108, 32, 83, 101, 114, 118, 101, 114, 32, 69, 114, 114, 111, 114]),
    {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    },
  );
}

function createRequest(req: IncomingMessage, res: ServerResponse, options?: ServeOptions) {
  let controller: AbortController | null = new AbortController();
  let method = req.method ?? "GET";
  let headers = createHeaders(req);
  let protocol = "encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:";
  let host = headers.get("Host") ?? req.headers[":authority"] ?? options?.hostname ?? "localhost";
  let url = new URL(req.url!, `${protocol}//${host}`);
  let init: RequestInit & { duplex?: "half" } = { method, headers, signal: controller.signal };
  res.once("close", () => controller?.abort());
  res.once("finish", () => controller = null);
  if (method !== "GET" && method !== "HEAD") {
    init.body = new ReadableStream({
      start(controller2) {
        req.on("data", (chunk) => {
          controller2.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        });
        req.on("end", () => {
          controller2.close();
        });
      },
    });
    init.duplex = "half";
  }
  return new Request(url, init);
}

function createHeaders(req: IncomingMessage) {
  let headers = new Headers();
  let rawHeaders = req.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].startsWith(":")) {
      continue;
    }
    headers.append(rawHeaders[i], rawHeaders[i + 1]);
  }
  return headers;
}

async function sendResponse(res: ServerResponse, response: Response) {
  let headers: Record<string, string | string[]> = {};
  for (let [key, value] of response.headers) {
    if (key in headers) {
      if (Array.isArray(headers[key])) {
        headers[key].push(value);
      } else {
        headers[key] = [headers[key], value];
      }
    } else {
      headers[key] = value;
    }
  }
  if (res.req.httpVersionMajor === 1) {
    res.writeHead(response.status, response.statusText, headers);
  } else {
    res.writeHead(response.status, headers);
  }
  if (response.body != null && res.req.method !== "HEAD") {
    for await (let chunk of readStream(response.body)) {
      if (res.write(chunk) === false) {
        await new Promise((resolve) => {
          res.once("drain", resolve);
        });
      }
    }
  }
  res.end();
}

export type ServeOptions = {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  idleTimeout?: number;
  fetch: (req: Request) => Response | Promise<Response>;
  onError?: (error: Error) => Response | Promise<Response>;
};

export function serve(options: ServeOptions): Promise<{ port: number }> {
  const port = options?.port ?? getDefaultPort();
  const server = createServer(createRequestListener(options.fetch, options));
  server.listen(port, options?.hostname, () => {
    console.log(`Server is running on http://${options?.hostname ?? "localhost"}:${port}`);
  });
  options?.signal?.addEventListener("abort", () => {
    server.close();
  });
  return new Promise((resolve, reject) => {
    server.on("listening", () => resolve({ port }));
    server.on("error", reject);
  });
}

function getDefaultPort() {
  // deno-lint-ignore no-process-global
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--port=")) {
      return parseInt(arg.slice(7));
    } else if (arg === "--port" && i + 1 < args.length) {
      return parseInt(args[i + 1]);
    }
  }
  return 3000;
}
