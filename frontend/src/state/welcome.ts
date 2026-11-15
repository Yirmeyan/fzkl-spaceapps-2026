/** Written once the visitor has closed the welcome window. */
export const WELCOME_KEY = "spx-welcome-seen";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

/**
 * Should the welcome window open by itself?
 *
 * Not when the address starts something on its own, the guided tour or the animation
 * of the years: that visitor came to watch. Not when the window was closed before.
 */
export function welcomesAtOpening(search: string, storage: Reader | null): boolean {
  const query = new URLSearchParams(search);
  if (query.get("demo") === "1" || query.get("years") === "1") return false;
  try {
    return storage?.getItem(WELCOME_KEY) !== "1";
  } catch {
    // A browser that refuses its storage remembers nothing: the window opens each time.
    return true;
  }
}

export function rememberWelcome(storage: Writer | null): void {
  try {
    storage?.setItem(WELCOME_KEY, "1");
  } catch {
    // Nothing to write in: the window comes back at the next opening.
  }
}

/** The storage of the browser, or nothing where it is refused. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
