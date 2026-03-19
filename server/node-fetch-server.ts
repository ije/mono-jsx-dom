// based on https://github.com/remix-run/remix/tree/main/packages/node-fetch-server

import type { IncomingMessage, ServerResponse } from "node:http";

export type RequestListenerHandler = (
  request: Request,
  client: { address?: string; family?: string; port?: number },
) => Promise<Response>;

export type RequestListenerOptions = {
  protocol?: string;
  host?: string;
  onError?: (error: Error) => Promise<Response>;
};

export function createRequestListener(handler: RequestListenerHandler, options?: RequestListenerOptions) {
  const onError = options?.onError ?? defaultErrorHandler;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const request = createRequest(req, res, options);
    const client = {
      address: req.socket.remoteAddress,
      family: req.socket.remoteFamily,
      port: req.socket.remotePort,
    };
    let response;
    try {
      response = await handler(request, client);
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

function createRequest(req: IncomingMessage, res: ServerResponse, options?: RequestListenerOptions) {
  let controller: AbortController | null = new AbortController();
  let method = req.method ?? "GET";
  let headers = createHeaders(req);
  let protocol = options?.protocol ?? ("encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:");
  let host = options?.host ?? headers.get("Host") ?? req.headers[":authority"] ?? "localhost";
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
