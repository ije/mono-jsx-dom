import { argv, cwd } from "node:process";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { confirm, ensureDir, exists, input } from "./utils.ts";

const bun = "Bun" in globalThis;

const template = {
  ".gitignore": [
    ".DS_Store",
    "node_modules/",
    "dist/",
  ].join("\n"),
  "package.json": JSON.stringify(
    {
      name: "mono-app",
      version: "0.0.0",
      private: true,
      scripts: {
        dev: (bun ? "bun --bun" : "") + " mono-jsx-dom dev",
        build: (bun ? "bun --bun" : "") + " mono-jsx-dom build",
        start: bun ? "bun --bun mono-jsx-dom build && bun dist/server.mjs" : "mono-jsx-dom build --node && node dist/server.mjs",
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

/* theme customization, see: https://tailwindcss.com/docs/theme */
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

export async function run() {
  const appName = argv[3] ?? await input("Enter the name of the app:", "mono-app");
  return init(appName);
}

export async function init(appName: string) {
  const appDir = join(cwd(), appName);
  if (await exists(appDir) && !(await confirm(`Directory ${appName} already exists. Overwrite?`))) {
    return;
  }

  const scaffold: Record<string, string> = { ...template };
  const withTailwind = await confirm("Use TailwindCSS for styling?");
  const withWrangler = await confirm("Add Cloudflare Workers integration?");
  if (withWrangler) {
    scaffold["wrangler.jsonc"] = JSON.stringify(
      {
        $schema: "./node_modules/wrangler/config-schema.json",
        name: appName,
        compatibility_date: (new Date()).toISOString().split("T")[0],
        main: "dist/server.mjs",
        build: {
          command: (bun ? "bun run" : "npm") + " build",
        },
        assets: {
          directory: "./public",
          binding: "ASSETS",
        },
      },
      null,
      2,
    );
  }
  if (!withTailwind) {
    scaffold["app/style.css"] = "/* app styles */\n";
  }
  await ensureDir(appDir);
  await Promise.all(
    Object.entries(scaffold).map(async ([filename, content]) => {
      const filepath = join(appDir, filename);
      if (filename === "package.json") {
        const pkg = JSON.parse(content);
        pkg.name = appName;
        if (withWrangler) {
          pkg.scripts.dev = "wrangler dev";
          pkg.scripts.deploy = "wrangler deploy";
          delete pkg.scripts.build;
          delete pkg.scripts.start;
        }
        content = JSON.stringify(pkg, null, 2);
      }
      if (!await exists(filepath)) {
        await ensureDir(dirname(filepath));
        return writeFile(filepath, content);
      }
    }),
  );

  let tsConfig = Object.create(null);
  try {
    const data = await readFile(join(appDir, "tsconfig.json"), "utf8");
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
  await writeFile(join(appDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));

  console.log("\x1b[90mInstalling dependencies...\x1b[0m");
  const cmd = install(appDir, withTailwind, withWrangler);
  const isBun = cmd === "bun";

  console.log("");
  console.log("✨ \x1b[32mSetup completed.\x1b[0m");
  console.log("You can now start or build the app with the following commands:");
  console.log("");
  console.log(`cd ${appName}`);
  console.log(`${cmd} dev${isBun ? "    " : ""}    \x1b[90m# start the app in development mode.\x1b[0m`);
  if (withWrangler) {
    console.log(`${cmd}${isBun ? " run" : ""} deploy \x1b[90m# deploy the app to Cloudflare Workers.\x1b[0m`);
  } else {
    console.log(`${cmd}${isBun ? " run" : ""} build  \x1b[90m# build the app for production.\x1b[0m`);
    console.log(`${cmd} start${isBun ? "    " : ""}  \x1b[90m# build and start the app in production mode.\x1b[0m`);
  }
  console.log("");
}

function install(cwd: string, withTailwind: boolean, withWrangler: boolean) {
  let cmd = "npm";
  if (bun) {
    cmd = "bun";
  }
  spawnSync(cmd, ["add", "mono-jsx-dom"], { cwd });
  const devDeps = ["esbuild"];
  if (withTailwind) {
    devDeps.push("tailwindcss", "oxide-wasm");
  }
  if (withWrangler) {
    devDeps.push("wrangler");
  }
  spawnSync(cmd, ["add", "-D", ...devDeps], { cwd });
  if (withWrangler) {
    spawnSync(cmd, ["wrangler", "types"], { cwd });
  }
  return cmd;
}
