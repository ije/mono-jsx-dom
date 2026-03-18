import type { Atom } from "./jsx.d.ts";

/**
 * Creates an atom signal.
 */
export const atom: <T>(initValue: T) => Atom<T>;

/**
 * Creates a signal store.
 */
export const store: <T extends Record<string, unknown>>(initValue: T) => T;
