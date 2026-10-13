import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False on the server and during hydration, true afterwards. For view layers
 * that come from device prefs (the server cannot know them): rendering them
 * only once hydrated keeps the server HTML and the first client render equal.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
