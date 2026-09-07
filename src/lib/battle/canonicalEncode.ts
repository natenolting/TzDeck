/**
 * A fixed, explicitly-ordered JSON-array encoding of positional primitives --
 * not a naive delimiter-free concatenation, which a follow-up review flagged
 * as ambiguous (variable-length fields can collide across a boundary with no
 * framing). JSON.stringify on an array of primitives escapes and delimits
 * every element unambiguously. Shared, byte-identical between client and
 * server -- deliberately has no runtime-specific dependencies (no
 * `node:crypto`) so it can be imported from browser code (WalletContext)
 * without pulling Node built-ins into a client bundle.
 */
export function canonicalEncode(fields: ReadonlyArray<string | number | boolean>): string {
  return JSON.stringify(fields);
}
