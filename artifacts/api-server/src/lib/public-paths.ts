/** Public branding is independent from the stable workspace package names. */
export const APP_BASE_PATH = "/opusevents";
export const LEGACY_APP_BASE_PATH = "/eventops-live";
export const SIGN_IN_PATH = `${APP_BASE_PATH}/sign-in`;
export const RECEIPT_AUTH_PATH = `${APP_BASE_PATH}/api/receipt-auth`;

/** Keep bookmarked page paths and query strings while replacing the old prefix. */
export function canonicalAppPath(path: string): string {
  return path
    .replace(/^\/eventops-live(?=\/|\?|$)/i, APP_BASE_PATH)
    .replace(/^\/opusevents(?=\?|$)/i, `${APP_BASE_PATH}/`);
}

/** Only allow receipt sign-in to return to a manager/worker booking page. */
export function receiptReturnPath(value: unknown): string {
  if (typeof value !== "string") return SIGN_IN_PATH;
  const path = canonicalAppPath(value);
  return /^\/opusevents\/(manager|worker)\/bookings\/EV-\d+$/.exec(path)?.[0] === path
    ? path
    : SIGN_IN_PATH;
}
