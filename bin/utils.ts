import { argv, stdin, stdout } from "node:process";
import { access, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

export async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const line = await rl.question("\x1b[34m?\x1b[0m " + prompt + " \x1b[90m(y/N)\x1b[0m ");
    const yes = /^y(es)?$/i.test(line.trim());
    if (stdout.isTTY) {
      const answer = yes ? "\x1b[32myes\x1b[0m" : "\x1b[90mno\x1b[0m";
      stdout.write(`\x1b[1A\r\x1b[34m?\x1b[0m ${prompt} ${answer}\x1b[K\n`);
    }
    return yes;
  } finally {
    rl.close();
  }
}

export function parseFlags() {
  const flags: Record<string, string | boolean> = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (arg.includes("=")) {
        const [key, value] = arg.split("=", 2);
        flags[key] = value;
      } else {
        const nextArg = args[i + 1];
        if (!nextArg || nextArg.startsWith("--")) {
          flags[arg] = true;
        } else {
          flags[arg] = nextArg;
          i++;
        }
      }
    }
  }
  return flags;
}

export async function resolveModule(filename: string, exts = [".tsx", ".ts", ".jsx", ".mjs", ".js"]) {
  for (const ext of exts) {
    const path = filename + ext;
    if (await exists(path)) {
      return path;
    }
  }
  return null;
}

export async function exists(filename: string) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string) {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}
