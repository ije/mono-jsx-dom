import process from "node:process";
import { dirname, join } from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const files = {
  "package.json": JSON.stringify(
    {
      name: "mono-app",
      version: "0.0.0",
      private: true,
      scripts: {
        dev: "mono-jsx-dom dev",
        build: "mono-jsx-dom build",
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
  fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/data/word") {
      return new Response("world")
    }
    return server.fetch(req);
  },
}
`,
};

function install(cwd: string) {
  let npm = "npm";
  if ("Bun" in globalThis) {
    npm = "bun";
  }
  spawnSync(npm, ["add", "mono-jsx-dom"], { stdio: "pipe", cwd });
  spawnSync(npm, ["add", "-D", "esbuild", "tailwindcss", "oxide-wasm"], { stdio: "pipe", cwd });
  return npm;
}

export async function init(appName = "mono-app") {
  const cwd = join(process.cwd(), appName);
  await ensureDir(cwd);
  await Promise.all(
    Object.entries(files).map(async ([filename, content]) => {
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
  const npm = install(cwd);
  console.log("\x1b[32m✅ Setup complete.\x1b[0m");
  console.log("");
  console.log(`cd ${appName}`);
  console.log(`${npm} run dev   \x1b[90m# start the app in development mode.\x1b[0m`);
  console.log(`${npm} run build \x1b[90m# build the app for production.\x1b[0m`);
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
