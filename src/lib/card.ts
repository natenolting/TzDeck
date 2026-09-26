import type { CardRarity } from "./rarity";

export interface NFTCard {
  listing_id?: number;
  token_id: string;
  contract_address: string;
  name: string;
  description?: string;
  artifact_uri?: string;
  display_uri?: string;
  thumbnail_uri?: string;
  artist_alias?: string;
  artist_address?: string;
  collection_name?: string;
  editions?: number;
  price_mutez?: number;
  price_xtz?: number;
  objkt_url: string;
  rarity: CardRarity;
  quantity_owned?: number;
  /** OBJKT's media type for the artifact, e.g. "image/png" or "video/mp4". */
  mime?: string;
}

/**
 * Container formats the browser `<video>` element can actually decode. About
 * 6.5% of active listings are video, and nearly all of that is mp4 -- but
 * video/quicktime (0.6%) frequently will not play, so it is deliberately absent
 * here and those tokens keep showing their poster image instead of a dead
 * player.
 */
const PLAYABLE_VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/ogg"]);

export function isPlayableVideo(
  card: Pick<NFTCard, "mime" | "artifact_uri">,
): boolean {
  if (!card.mime || !card.artifact_uri) return false;
  return PLAYABLE_VIDEO_MIMES.has(card.mime.toLowerCase());
}

/**
 * Whether a token's artifact is worth keeping in an <img> failover chain.
 *
 * An unknown mime stays true on purpose: wishlists saved before the field
 * existed carry none, and that is exactly the behaviour they had. A known
 * non-image artifact is dropped -- handing a 124MB mp4 to an <img> can only
 * fail, slowly, on whatever connection the viewer happens to have.
 */
export function isImageArtifact(card: Pick<NFTCard, "mime">): boolean {
  if (!card.mime) return true;
  return card.mime.toLowerCase().startsWith("image/");
}

export function formatShortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getArtistProfileUrl(artistAddress?: string): string | undefined {
  return artistAddress ? `https://objkt.com/users/${artistAddress}` : undefined;
}

/**
 * The collection name worth showing beside the artist, if any.
 *
 * Solo artists routinely name a collection after themselves, so rendering both
 * prints the same words twice in a row, which reads as a fault rather than a
 * fact. Roughly one active listing in five does this.
 */
export function distinctCollectionName(
  card: Pick<NFTCard, "artist_alias" | "collection_name">,
): string | undefined {
  const collection = card.collection_name?.trim();
  if (!collection) return undefined;
  const artist = card.artist_alias?.trim() ?? "";
  return collection.toLowerCase() === artist.toLowerCase() ? undefined : collection;
}

/** A token's OBJKT page, where a collector can buy it. */
export function getObjktAssetUrl(contractAddress: string, tokenId: string): string {
  return `https://objkt.com/asset/${contractAddress}/${tokenId}`;
}

export function getCollectionUrl(contractAddress: string): string {
  return `https://objkt.com/collection/${contractAddress}`;
}

/**
 * OBJKT's own pre-resized still of a token, addressed by key alone.
 *
 * This is the server-side counterpart to the client's IPFS failover chain, and
 * it is a better answer wherever a single blocking fetch has to succeed:
 * measured over 300 active listings it answered 300/300 with a p50 of 105KB in
 * 491ms, where an IPFS gateway ladder is several seconds of retries. It also
 * returns a still poster for video tokens, so no caller has to special-case
 * mime. `thumb400` and `thumb288` are the only derivatives that exist;
 * `display` and `artifact` both 404.
 *
 * Animated GIF and WebP are the exception: every derivative returns the full
 * animation, around 1.7MB, so a caller with a byte budget has to reject them.
 */
export function getObjktThumbnailUrl(
  card: Pick<NFTCard, "contract_address" | "token_id">,
  variant: "thumb288" | "thumb400" = "thumb400",
): string {
  return `https://assets.objkt.media/file/assets-003/${card.contract_address}/${card.token_id}/${variant}`;
}

/**
 * A token's edition count, or undefined when upstream can't give one. OBJKT
 * reports a null supply for tokens it hasn't indexed and 0 for fully burned
 * ones, and TzKT sends counts as strings. None of those gaps is a count: the
 * rarity ladders read 1 as a 1 of 1, so filling one in with 1 (or letting 0
 * through, which the battle seed rounds up to 1) grades an unknown token as
 * the scarcest tier there is. Undefined grades on price alone, or Common.
 */
export function normalizeEditions(raw: unknown): number | undefined {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : undefined;
}
