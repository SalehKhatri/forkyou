/** True if `tz` is an IANA zone the runtime understands (e.g. "America/New_York"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const seconds = (n: number) => n * 1000;
export const days = (n: number) => n * 86_400_000;
