import type { Atom, ComponentType } from "./jsx.d.ts";

/**
 * Creates an atom signal.
 */
export const atom: <T>(initValue: T) => Atom<T>;

/**
 * Creates a signal store.
 */
export const store: <T extends Record<string, unknown>>(initValue: T) => T;

/**
 * Defines a custom element with the given name and component.
 */
export const register: (
  name: string,
  Component: ComponentType<any>,
  shadow?: boolean | { mode?: "open" | "closed"; style?: string },
) => void;
