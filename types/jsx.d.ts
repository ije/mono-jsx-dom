import type { HTML } from "./html.d.ts";

export type ChildPrimitiveType = JSX.Element | string | number | bigint | boolean | null | undefined;
export type ChildType = MaybeArray<MaybeGetter<ChildPrimitiveType>>;
export type MaybeArray<T> = T | T[];
export type MaybeGetter<T> = T | { get: () => T };
export type MaybePromiseOrGenerator<T> = T | Promise<T> | Generator<T> | AsyncGenerator<T>;

export interface BaseAttributes {
  /**
   * The children of the element.
   */
  children?: MaybeArray<ChildType>;
  /**
   * The key of the element.
   * @deprecated The prop `key` is ignored in mono-jsx.
   */
  key?: string | number;
  /**
   * The `slot` attribute assigns a slot in a [shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM) shadow tree to an element: An element with a `slot` attribute is assigned to the slot created by the `<slot>` element whose name attribute's value matches that slot attribute's value.
   */
  slot?: string;
  /**
   * The `portal` attribute is used to mount the component to a specified DOM element.
   * @mono-jsx-dom
   */
  // portal?: HTMLElement;
}

export interface AsyncComponentAttributes {
  /**
   * Catch errors in an async component.
   */
  catch?: (err: any) => JSX.Element;
  /**
   * The loading spinner for an async component.
   */
  pending?: JSX.Element;
}

export type VNode = readonly [
  tag: string | symbol | ComponentType<any>,
  props: Record<string, any>,
  $vnode: symbol,
];

export interface ComponentType<P = {}> {
  (props: P): MaybePromiseOrGenerator<VNode | string | null>;
}

export interface MonoBuiltinElements {
  /**
   * A built-in element of mono-jsx-dom that toggles the visibility of its children.
   * @mono-jsx-dom
   */
  show: BaseAttributes & {
    /**
     * Show the children if the value is truthy.
     */
    when?: any;
    /**
     * Enables view transition for the children.
     */
    // viewTransition?: string | boolean;
  };

  /**
   * A built-in element of mono-jsx-dom that toggles the visibility of its children.
   * @mono-jsx-dom
   */
  hidden: BaseAttributes & {
    /**
     * Hide the children if the value is truthy.
     */
    when?: any;
    /**
     * Enables view transition for the children.
     */
    // viewTransition?: string | boolean;
  };

  /**
   * A a built-in element of mono-jsx-dom that chooses one of its children based on the `slot` attribute to display.
   * It is similar to a switch statement in programming languages.
   * @mono-jsx-dom
   */
  switch: BaseAttributes & {
    /**
     * Which child to display.
     */
    value?: string | number | boolean | null;
    /**
     * Enables view transition for the children.
     */
    // viewTransition?: string | boolean;
  };
}

export interface Atom<T> {
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  map(callback: (value: T extends (infer V)[] ? V : T, index: number) => ChildPrimitiveType): ChildPrimitiveType[];
  ref(): T;
  ref<V>(callback: (value: T) => V): V;
}

declare global {
  namespace JSX {
    type ElementType<P = any> =
      | {
        [K in keyof IntrinsicElements]: P extends IntrinsicElements[K] ? K : never;
      }[keyof IntrinsicElements]
      | ComponentType<P>;
    type Raw = (template: MaybeGetter<string> | TemplateStringsArray, ...values: unknown[]) => Element;
    interface CustomAttributes {}
    interface HtmlCustomAttributes {}
    interface BuiltinElements {}
    interface CustomElements {}
    interface Element extends VNode, Response {}
    interface IntrinsicAttributes extends BaseAttributes, AsyncComponentAttributes {}
    interface IntrinsicElements extends HTML.Elements, HTML.SVGElements, HTML.CustomElements, JSX.BuiltinElements, MonoBuiltinElements {}
  }

  /**
   * mono-jsx-dom component scope.
   */
  type FC<Signals = {}, Refs = Record<string, HTMLElement>> =
    & {
      /**
       * The `refs` object stores variables in clide side.
       */
      readonly refs: Refs;
      /**
       * Initializes the signals.
       */
      init(initValue: Signals): void;
      /**
       * Creates an atom signal.
       */
      atom: <T>(initValue: T) => Atom<T>;
      /**
       * Creates a signal store.
       */
      store: <T extends Record<string, unknown>>(initValue: T) => T;
      /**
       * Creates a computed signal.
       */
      computed<T = unknown>(fn: () => T): T;
      /**
       * A shortcut for `this.computed(fn)`.
       */
      $<T = unknown>(fn: () => T): T;
      /**
       * Creates a side effect.
       * **The effect function is only called on client side.**
       */
      effect(fn: () => (() => void) | void): void;
    }
    & Omit<Signals, "refs" | "init" | "atom" | "store" | "computed" | "$" | "effect">;

  /**
   *  Defines the `this.refs` type.
   */
  type WithRefs<T, R extends {}> = T extends FC<infer S> ? FC<S, R> : never;

  /**
   * The JSX namespace object.
   * @mono-jsx-dom
   */
  var JSX: {
    customElements: {
      /**
       * Defines a built-in custom element.
       * @mono-jsx-dom
       */
      define: (tagName: string, fc: ComponentType<any>) => void;
    };
  };

  /**
   * Creates XSS-unsafed HTML content.
   * @mono-jsx-dom
   */
  var html: JSX.Raw;
  /**
   * An alias to `html`.
   * @mono-jsx-dom
   */
  var css: JSX.Raw;
  /**
   * An alias to `html`.
   * @mono-jsx-dom
   */
  var js: JSX.Raw;
}
