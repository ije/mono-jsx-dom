export type VFile = {
  content: string | Uint8Array<any>;
  contentType: string;
  contentHash?: string;
  lastModified: number;
};

export type VFS = {
  has: (filename: string) => boolean;
  get: (filename: string) => string | URL | VFile | undefined;
};

export type ASSETS = {
  fetch: (request: Request) => Promise<Response>;
};

export const server: {
  fetch: (req: Request) => Promise<Response>;
  setVFS: (vfs: VFS) => void;
  setAssets: (assets: ASSETS) => void;
};

export default server;
