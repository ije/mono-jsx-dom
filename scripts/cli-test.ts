import { init } from "../bin/init.mjs";
import { build } from "../bin/build.mjs";

await init("mono-test-app");

const ac = new AbortController();
await build({ dir: "mono-test-app", runtime: "node" });
ac.abort();
