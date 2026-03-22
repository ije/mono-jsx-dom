import { rm } from "node:fs/promises";
import { init } from "../bin/init.mjs";
import { dev } from "../bin/dev.mjs";

const appName = "mono-test-app";

await rm(appName, { recursive: true, force: true });
await init(appName);
await dev({ dir: appName });
