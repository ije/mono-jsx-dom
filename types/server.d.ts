export type VFile = {
  content: string | ArrayBuffer;
  contentType: string;
  hash: string;
  lastModified: number;
};

export type VFS = {
  has: (filename: string) => boolean;
  get: (filename: string) => VFile | undefined;
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
