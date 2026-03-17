import { VNode } from "./types/jsx.d.ts";
import { $vnode } from "./symbols.ts";

export const regexpIsNonDimensional =
  /^(-|f[lo].*[^se]$|g.{5,}[^ps]$|z|o[pr]|(W.{5})?[lL]i.*(t|mp)$|an|(bo|s).{4}Im|sca|m.{6}[ds]|ta|c.*[st]$|wido|ini)/; // copied from https://github.com/preactjs/preact/blob/main/compat/src/util.js

export const isString = (v: unknown): v is string => typeof v === "string";
export const isFunction = (v: unknown): v is Function => typeof v === "function";
export const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && (v.constructor === Object || v.constructor === undefined);
export const toHyphenCase = (k: string) => k.replace(/[a-z][A-Z]/g, (m) => m.charAt(0) + "-" + m.charAt(1).toLowerCase());
export const createTextNode = (text = "") => document.createTextNode(text);
export const createElement = (tag: string) => document.createElement(tag);
export const isVNode = (v: unknown): v is VNode => Array.isArray(v) && v.length === 3 && v[2] === $vnode;
export const onAbort = (signal: AbortSignal | undefined, callback: () => void) => signal?.addEventListener("abort", callback);
export const setAttribute = (el: Element, name: string, value: unknown) => {
  switch (typeof value) {
    case "boolean":
      el.toggleAttribute(name, value);
      break;
    case "number":
    case "string":
      el.setAttribute(name, String(value));
      break;
  }
};
/** calculates the hash code (32-bit) of a string. */
export const hashCode = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

// Fastest way for creating null-prototype objects in JavaScript
// copyied from https://github.com/h3js/rou3/blob/main/src/_utils.ts
// by @pi0
export const NullPrototypeObject = /* @__PURE__ */ (() => {
  function ONP() {}
  ONP.prototype = Object.create(null);
  return ONP;
})() as unknown as { new(): Record<string, any> };

export const createStyleElement = (css: (string | null)[]) => {
  const hash = hashCode(css.join("")).toString(36);
  const className = "css-" + hash;
  if (!document.getElementById(className)) {
    const styleEl = document.head.appendChild(createElement("style"));
    styleEl.id = className;
    styleEl.textContent = css.map(v => v === null ? "." + className : v).join("");
  }
  return className;
};

/**
 * Escapes special characters and HTML entities in a given html string.
 * Use `document.createElement("div").textContent = text` instead of `escapeHTML` in browser.
 */
export const domEscapeHTML = (text: string): string => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};
