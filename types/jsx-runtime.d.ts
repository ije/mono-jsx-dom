import type { ComponentType, VNode } from "./jsx.d.ts";

export const html: JSX.Raw;
export const JSX: typeof globalThis.JSX;
export const Fragment: (props: {}) => VNode;
export const jsx: (tag: string | ComponentType, props: Record<string, unknown>, key?: string | number) => VNode;
export const render: (scope: null, node: VNode, container: HTMLElement | DocumentFragment | ShadowRoot, aboutSignal?: AbortSignal) => void;

// aliases
export { html as css, html as js, jsx as jsxDEV, jsx as jsxs };

declare global {
  interface HTMLElement {
    /**
     * Mounts a VNode to the DOM element.
     *
     * @mono-jsx-dom
     */
    mount(node: VNode, aboutSignal?: AbortSignal): void;
  }
}
