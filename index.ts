import type { ComponentType, VNode } from "./types/jsx.d.ts";
import { atom, jsx, store } from "./jsx-runtime.mjs";

export function defineComponent(name: string, Component: ComponentType) {
  customElements.define(
    name,
    class extends HTMLElement {
      #ac: AbortController | undefined;
      connectedCallback() {
        this.#ac ??= new AbortController();
        const props = Object.fromEntries(this.getAttributeNames().map(name => [name, this.getAttribute(name)]));
        this.mount(jsx(Component, props) as unknown as VNode, this.#ac.signal);
      }
      disconnectedCallback() {
        this.#ac?.abort();
      }
    },
  );
}

export { atom, store };
