import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// False during the server render and hydration, true afterwards. Use it to
// render values that depend on the browser (timezone, locale data) without a
// hydration mismatch.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
