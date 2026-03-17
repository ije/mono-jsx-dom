import { access, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const appTSX = `
function App(this: FC) {
  return <div>Hello, world!</div>;
}

document.body.mount(<App />);
`;

async function install() {
  let npm = "npm";
  if ("Bun" in globalThis) {
    npm = "bun";
  } else if (await exists("pnpm-lock.yaml")) {
    npm = "pnpm";
  }
  spawnSync(npm, ["add", "mono-jsx-dom"], { stdio: "pipe" });
}

export async function setup() {
  await install();
  if (!await exists("app.tsx")) {
    await writeFile("app.tsx", appTSX);
  }
  let tsConfig = Object.create(null);
  try {
    const data = await readFile("tsconfig.json", "utf8");
    tsConfig = JSON.parse(data);
  } catch {
    // ignore
  }
  const compilerOptions = tsConfig.compilerOptions ?? (tsConfig.compilerOptions = {});
  if (compilerOptions.jsx === "react-jsx" && compilerOptions.jsxImportSource === "mono-jsx-dom") {
    console.log("%cmono-jsx-dom already setup.", "color:grey");
    return;
  }
  compilerOptions.lib ??= ["dom", "es2022"];
  compilerOptions.module ??= "es2022";
  compilerOptions.moduleResolution ??= "bundler";
  compilerOptions.allowImportingTsExtensions ??= true;
  compilerOptions.noEmit ??= true;
  compilerOptions.jsx = "react-jsx";
  compilerOptions.jsxImportSource = "mono-jsx-dom";
  await writeFile("tsconfig.json", JSON.stringify(tsConfig, null, 2));
  console.log("✅ mono-jsx-dom setup complete.");
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
