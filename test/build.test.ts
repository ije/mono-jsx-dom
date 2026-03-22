import { rm } from "node:fs/promises";
import { init } from "../bin/init.mjs";
import { build } from "../bin/build.mjs";

const appName = "mono-test-app";

await rm(appName, { recursive: true, force: true });
await init(appName);
await build({ dir: appName, runtime: "node" });
