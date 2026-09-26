import { formatShortAddress, getObjktAssetUrl, normalizeEditions, type NFTCard } from "./card";
import { convertIpfsUrl } from "./ipfs";
import { rarityFor } from "./rarity";

/** A token as TOKEN_FIELDS selects it. */
export interface ObjktRawToken {
  name: string | null;
  token_id: string;
  fa_contract: string;
  display_uri: string | null;
  artifact_uri: string | null;
  thumbnail_uri: string | null;
  supply: number | null;
  description?: string | null;
  mime?: string | null;
  creators?: Array<{ holder: { alias: string | null; address: string } }>;
  fa?: { name: string | null };
}

/**
 * A token as PULL_TOKEN_FIELDS selects it. The filter fields are always
 * present, though OBJKT can still send null, which the filter fails closed on.
 */
export interface PullToken extends ObjktRawToken {
  pk: number | null;
  flag: string | null;
  creators: Array<{ verified: boolean | null; holder: { alias: string | null; address: string; flag: string | null } }>;
  fa: { name: string | null; live: boolean | null };
}

interface NormalizeTokenOptions {
  listingId?: number;
  priceMutez?: number;
  quantityOwned?: number;
}

export function normalizeObjktToken(
  token: ObjktRawToken,
  options: NormalizeTokenOptions = {},
): NFTCard {
  const editions = normalizeEditions(token.supply);
  const priceXtz = options.priceMutez !== undefined
    ? options.priceMutez / 1_000_000
    : undefined;
  const artist = token.creators?.[0]?.holder;
  const displayUri = token.display_uri || token.thumbnail_uri || token.artifact_uri || "";

  return {
    listing_id: options.listingId,
    token_id: token.token_id,
    contract_address: token.fa_contract,
    name: token.name?.trim() || `OBJKT #${token.token_id}`,
    description: token.description || undefined,
    display_uri: convertIpfsUrl(displayUri),
    artifact_uri: convertIpfsUrl(token.artifact_uri || undefined),
    thumbnail_uri: convertIpfsUrl(token.thumbnail_uri || displayUri),
    // Names, aliases and collection titles are trimmed here rather than at each
    // surface. OBJKT carries stray leading and trailing whitespace often enough
    // that it reaches places HTML cannot re-flow: an aria-label reading
    // "Share  Butterfly of Hope", a document title, an OG card.
    artist_alias: artist?.alias?.trim() || (artist?.address
      ? formatShortAddress(artist.address)
      : "Unknown Artist"),
    artist_address: artist?.address || undefined,
    collection_name: token.fa?.name?.trim() || "Tezos Art",
    editions,
    price_mutez: options.priceMutez,
    price_xtz: priceXtz !== undefined ? Number(priceXtz.toFixed(3)) : undefined,
    objkt_url: getObjktAssetUrl(token.fa_contract, token.token_id),
    rarity: rarityFor(editions, priceXtz),
    quantity_owned: options.quantityOwned,
    mime: token.mime || undefined,
  };
}

export interface ObjktListingRow {
  id: number;
  price: number;
  token: ObjktRawToken;
}

export interface PullListingRow extends ObjktListingRow {
  token: PullToken;
}

interface TzktTokenBalance {
  balance?: number | string;
  token?: {
    tokenId?: number | string;
    token_id?: number | string;
    totalSupply?: number | string;
    contract?: {
      address?: string;
      alias?: string;
    };
    metadata?: {
      name?: string;
      description?: string;
      artifactUri?: string;
      displayUri?: string;
      thumbnailUri?: string;
      editions?: number | string;
      creators?: string[];
      artist?: string;
      collectionName?: string;
    };
  };
}

type TzktBalanceWithMetadata = TzktTokenBalance & {
  token: NonNullable<TzktTokenBalance["token"]> & { metadata: NonNullable<NonNullable<TzktTokenBalance["token"]>["metadata"]> };
};

export function isTzktTokenBalance(value: unknown): value is TzktBalanceWithMetadata {
  if (!value || typeof value !== "object") return false;
  const token = (value as { token?: unknown }).token;
  if (!token || typeof token !== "object") return false;
  const metadata = (token as { metadata?: unknown }).metadata;
  return Boolean(metadata && typeof metadata === "object");
}

const TEZOS_ADDRESS = /^(tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * A TzKT balance in OBJKT's shape, so both indexers' cards go through one
 * normalizer and look alike. TZIP metadata lists a creator by address or by
 * plain name, so a name becomes the alias rather than a mangled address.
 */
export function tzktToRawToken({ token }: TzktBalanceWithMetadata): ObjktRawToken {
  const { metadata } = token;
  const creator = metadata.creators?.[0] || metadata.artist;
  return {
    name: metadata.name ?? null,
    token_id: String(token.tokenId || token.token_id || "0"),
    fa_contract: token.contract?.address || "",
    display_uri: metadata.displayUri ?? null,
    artifact_uri: metadata.artifactUri ?? null,
    thumbnail_uri: metadata.thumbnailUri ?? null,
    supply: normalizeEditions(token.totalSupply) ?? normalizeEditions(metadata.editions) ?? null,
    description: metadata.description ?? null,
    creators: creator
      ? [{ holder: TEZOS_ADDRESS.test(creator) ? { alias: null, address: creator } : { alias: creator, address: "" } }]
      : [],
    fa: { name: token.contract?.alias || metadata.collectionName || null },
  };
}
