export type ServeOptions = {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  idleTimeout?: number;
  fetch: (req: Request) => Response | Promise<Response>;
  onListen?: (localAddress: { port: number }) => void;
  onError?: (error: Error) => Response | Promise<Response>;
};

export function serve(options: ServeOptions): Promise<{ port: number }>;
