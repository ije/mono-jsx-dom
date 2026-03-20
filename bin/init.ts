import process from "node:process";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const files = {
  "package.json": JSON.stringify(
    {
      name: "mono-app",
      version: "0.0.0",
      private: true,
      scripts: {
        dev: "mono-jsx-dom dev",
        build: "mono-jsx-dom build",
        start: "Bun" in globalThis ? "mono-jsx-dom build && bun dist/server.mjs" : "mono-jsx-dom build --node && node dist/server.mjs",
      },
    },
    null,
    2,
  ),
  "index.html": /* HTML */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>App</title>
    <link rel="stylesheet" href="app/style.css">
  </head>
  <body>
    <script type="module" src="app/main.tsx"></script>
  </body>
</html>
 `,
  "public/favicon.ico": "",
  "app/style.css": /* CSS */ `@import "tailwindcss";

/* @ref https://tailwindcss.com/docs/theme */
@theme {
}
`,
  "app/main.tsx": `// Docs: https://github.com/ije/mono-jsx-dom

async function App(this: FC<{ word: string }>) {
  this.word = await fetch("/data/word").then(res => res.text());
  return <div>Hello, {this.word}!</div>;
}

document.body.mount(<App />);
`,
  "server.ts": `import server from "mono-jsx-dom/server";

export default {
  fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/data/word") {
      return new Response("world")
    }
    return server.fetch(req);
  },
}
`,
};

function install(cwd: string, withTailwind: boolean) {
  let cmd = "npm";
  if ("Bun" in globalThis) {
    cmd = "bun";
  }
  spawnSync(cmd, ["add", "mono-jsx-dom"], { cwd });
  spawnSync(cmd, ["add", "-D", "esbuild"], { cwd });
  if (withTailwind) {
    spawnSync(cmd, ["add", "-D", "tailwindcss", "oxide-wasm"], { cwd });
  }
  return cmd;
}

export async function init(appName = "mono-app") {
  const cwd = join(process.cwd(), appName);
  const scaffold = { ...files };
  const withTailwind = await confirm("Use TailwindCSS for styling?");
  if (!withTailwind) {
    scaffold["app/style.css"] = "/* app styles */\n";
  }
  await ensureDir(cwd);
  await Promise.all(
    Object.entries(scaffold).map(async ([filename, content]) => {
      const filepath = join(cwd, filename);
      if (filename === "package.json") {
        content = JSON.stringify({ ...JSON.parse(content), name: appName }, null, 2);
      }
      if (!await exists(filepath)) {
        await ensureDir(dirname(filepath));
        return writeFile(filepath, content);
      }
    }),
  );
  let tsConfig = Object.create(null);
  try {
    const data = await readFile(join(cwd, "tsconfig.json"), "utf8");
    tsConfig = JSON.parse(data);
  } catch {
    // ignore
  }
  const compilerOptions = tsConfig.compilerOptions ?? (tsConfig.compilerOptions = {});
  compilerOptions.lib ??= ["dom", "es2022"];
  compilerOptions.module ??= "es2022";
  compilerOptions.moduleResolution ??= "bundler";
  compilerOptions.allowImportingTsExtensions ??= true;
  compilerOptions.noEmit ??= true;
  compilerOptions.jsx = "react-jsx";
  compilerOptions.jsxImportSource = "mono-jsx-dom";
  await writeFile(join(cwd, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));
  const cmd = install(cwd, withTailwind);
  const isBun = cmd === "bun";
  console.log("✨ \x1b[32mSetup completed.\x1b[0m");
  console.log("You can now start or build the app with the following commands:");
  console.log("");
  console.log(`cd ${appName}`);
  console.log(`${cmd} dev${isBun ? "    " : ""}   \x1b[90m# start the app in development mode.\x1b[0m`);
  console.log(`${cmd} start${isBun ? "    " : ""} \x1b[90m# build and start the app in production mode.\x1b[0m`);
  console.log(`${cmd}${isBun ? " run" : ""} build \x1b[90m# build the app for production.\x1b[0m`);
  console.log("");
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string) {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const line = await rl.question("\x1b[34m?\x1b[0m " + prompt + " \x1b[90m(y/N)\x1b[0m ");
    const yes = /^y(es)?$/i.test(line.trim());
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[1A\x1b[2K\r");
    }
    return yes;
  } finally {
    rl.close();
  }
}
