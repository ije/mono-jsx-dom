import type { ComponentType, VNode } from "./types/jsx.d.ts";
import { atom, jsx, render, store } from "./jsx-runtime.mjs";

export function defineComponent(name: string, Component: ComponentType, attachShadow?: boolean | { mode: "open" | "closed" }) {
  customElements.define(
    name,
    class extends HTMLElement {
      #ac: AbortController | undefined;
      connectedCallback() {
        this.#ac ??= new AbortController();
        const props = Object.fromEntries(this.getAttributeNames().map(name => [name, this.getAttribute(name)]));
        if (attachShadow) {
          const shadowRoot = this.attachShadow(typeof attachShadow === "boolean" ? { mode: "open" } : attachShadow);
          render(null as any, jsx(Component, props) as unknown as VNode, shadowRoot, this.#ac.signal);
        } else {
          this.mount(jsx(Component, props) as unknown as VNode, this.#ac.signal);
        }
      }
      disconnectedCallback() {
        this.#ac?.abort();
      }
    },
  );
}

export { atom, store };
