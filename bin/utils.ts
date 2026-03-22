import { argv, exit, stdin, stdout } from "node:process";
import { access, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

export async function input(prompt: string, placeholder = ""): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const line = await rl.question("\x1b[34m?\x1b[0m " + prompt + ":" + (placeholder ? " \x1b[90m" + placeholder + "\x1b[0m" : ""));
    if (stdout.isTTY) {
      stdout.write(`\x1b[1A\r\x1b[34m?\x1b[0m ${prompt} "\x1b[32m${line.trim()}\x1b[0m"\x1b[K\n`);
    }
    return line.trim() || placeholder;
  } finally {
    rl.close();
  }
}

export async function confirm(prompt: string): Promise<boolean> {
  const hint = "\x1b[34m?\x1b[0m " + prompt + " \x1b[90m(y/N)\x1b[0m ";

  if (stdin.isTTY) {
    stdout.write(hint);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    try {
      const yes = await new Promise<boolean>((resolve) => {
        stdin.once("data", (buf: Uint8Array | string) => {
          const c = typeof buf === "string" ? buf.charCodeAt(0) : buf[0]!;
          switch (c) {
            case 3: // Ctrl+C
              exit(130);
              break;
            case 89: // Y
            case 121: // y
              resolve(true);
              break;
            default:
              resolve(false);
              break;
          }
        });
      });
      if (stdout.isTTY) {
        const answer = yes ? "\x1b[32myes\x1b[0m" : "\x1b[90mno\x1b[0m";
        stdout.write(`\r\x1b[2K\x1b[34m?\x1b[0m ${prompt} ${answer}\n`);
      }
      return yes;
    } finally {
      stdin.setRawMode(wasRaw ?? false);
    }
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const line = await rl.question(hint);
    const t = line.trim();
    const yes = t === "" || /^y(es)?$/i.test(t);
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
