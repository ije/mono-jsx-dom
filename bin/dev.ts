import { build } from "./build.mjs";

export async function dev() {
  const ac = new AbortController();
  await build({ dev: { port: 8688, signal: ac.signal } });
  ac.abort();
}
