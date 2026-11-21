/** The colour theme. Light is the default; dark is a choice the user makes with the toggle. */
export type Theme = "light" | "dark";

/** Remembers the choice so the server renders the right theme and there's no flash on load. */
export const THEME_COOKIE = "fy_theme";

/** Anything other than an explicit "dark" means light, including no cookie at all. */
export function parseTheme(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** The cookie that stores `theme` for a year. First-party and only ever read by our own pages. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * The radius a circle centred on (x, y) needs to cover the whole viewport, for the theme switch's
 * reveal animation.
 */
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}
