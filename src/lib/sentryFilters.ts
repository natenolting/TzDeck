/**
 * Errors thrown by browser extensions running on our pages, not by TzDeck.
 * Wallet extensions inject scripts into every page they load on, and Sentry
 * reports their uncaught errors as if they were ours. TzDeck never uses
 * MetaMask (it's a Tezos app), yet "MetaMask extension not found" from
 * MetaMask's injected inpage.js reached Sentry.
 */

/** An event whose stack frames all come from one of these URLs is dropped. */
export const EXTENSION_DENY_URLS: RegExp[] = [
  /^(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i,
  /^chrome:\/\//i,
  // MetaMask's injected script, as Sentry shows it once the extension origin is rewritten.
  /\/scripts\/inpage\.js/i,
];

/** Messages matched as substrings; for extension errors whose frames don't carry an extension URL. */
export const EXTENSION_IGNORE_ERRORS: string[] = [
  "MetaMask extension not found",
  "Failed to connect to MetaMask",
];
