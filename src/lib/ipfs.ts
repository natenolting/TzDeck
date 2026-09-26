import { CID } from "multiformats/cid";

// Pinata's public gateway now rate-limits every anonymous request (429,
// verified 2026-09-05) -- it is a dead hop, not a real fallback, so it is
// left out rather than kept as a step every retry chain has to burn through.
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://{cid}.ipfs.dweb.link/",
];

export function extractIpfsHash(uri?: string): string | null {
  if (!uri) return null;
  const clean = uri.trim();
  if (clean.startsWith("ipfs://ipfs/")) return clean.slice(12);
  if (clean.startsWith("ipfs://")) return clean.slice(7);
  const subdomain = clean.match(/^https?:\/\/([^.]+)\.ipfs\.[^/?#]+(.*)$/i);
  if (subdomain) return subdomain[1] + (subdomain[2] === "/" ? "" : subdomain[2]);
  const match = clean.match(/\/ipfs\/(.+)/);
  if (match) return match[1];
  try {
    CID.parse(clean.split(/[/?#]/, 1)[0]);
    return clean;
  } catch {
    return null;
  }
}

export function convertIpfsUrl(uri?: string, gatewayIndex = 0): string {
  if (!uri) return "";
  const hash = extractIpfsHash(uri);
  if (hash) {
    const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length];
    if (gateway.includes("{cid}")) {
      const [cid] = hash.split(/[/?#]/, 1);
      const suffix = hash.slice(cid.length);
      try {
        // DNS hostnames require CIDv1/base32, including for legacy Qm… CIDs.
        const hostnameCid = CID.parse(cid).toV1().toString();
        return `${gateway.replace("{cid}", hostnameCid)}${suffix.replace(/^\//, "")}`;
      } catch {
        // Malformed token metadata must not throw during card rendering.
        return uri;
      }
    }
    return `${gateway}${hash}`;
  }
  return uri;
}

export function getCardImageSources(...uris: Array<string | undefined>): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();

  for (const uri of uris) {
    const clean = uri?.trim();
    if (!clean) continue;

    const hash = extractIpfsHash(clean);
    const identity = hash ? `ipfs:${hash}` : `url:${clean}`;
    if (seen.has(identity)) continue;

    seen.add(identity);
    sources.push(clean);
  }

  return sources;
}
