import type { ComponentType, VNode } from "./types/jsx.d.ts";
import { atom, jsx, render, store } from "./jsx-runtime.mjs";

export function register(
  name: string,
  Component: ComponentType,
  shadow?: boolean | { mode?: "open" | "closed"; style?: string | CSSStyleSheet },
) {
  customElements.define(
    name,
    class extends HTMLElement {
      #ac: AbortController | undefined;
      connectedCallback() {
        const props = Object.fromEntries(this.getAttributeNames().map(name => [name, this.getAttribute(name)]));
        this.#ac ??= new AbortController();
        if (shadow) {
          const { mode = "open", style } = typeof shadow === "boolean" ? {} : shadow;
          const shadowRoot = this.attachShadow({ mode });
          if (style) {
            let styleSheet = new CSSStyleSheet();
            if (typeof style === "string") {
              styleSheet.replaceSync(style);
            } else {
              styleSheet = style;
            }
            shadowRoot.adoptedStyleSheets = [styleSheet as CSSStyleSheet];
          }
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
