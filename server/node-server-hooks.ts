import { argv } from "node:process";
import { registerHooks } from "node:module";

const serverHook = `
import { serve as serve$ } from "mono-jsx-dom/node-fetch-server";
import(import.meta.url).then(m => serve$(m.default));
`;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (result.source && "file://" + argv[1] === url) {
      const source = typeof result.source === "string"
        ? result.source
        : new TextDecoder().decode(result.source);
      return { ...result, source: source + serverHook };
    }
    return result;
  },
});
