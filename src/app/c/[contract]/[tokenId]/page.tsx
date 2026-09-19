import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RARITY_CONFIG } from "@/components/rarityStyles";
import {
  getArtistProfileUrl,
  getCollectionUrl,
  getObjktThumbnailUrl,
  type NFTCard,
} from "@/lib/objkt";
import { loadSharedCard, parseCardRef } from "@/lib/share";

/** Prices and listings move; a token's identity does not. */
export const revalidate = 3600;

type Props = { params: Promise<{ contract: string; tokenId: string }> };

function cardPath(card: Pick<NFTCard, "contract_address" | "token_id">): string {
  return `/c/${card.contract_address}/${card.token_id}`;
}

function summarize(card: NFTCard): string {
  const parts = [`${RARITY_CONFIG[card.rarity].label} on TzDeck`];
  if (card.editions !== undefined) {
    parts.push(card.editions === 1 ? "1 edition" : `${card.editions} editions`);
  }
  if (card.price_xtz !== undefined) parts.push(`listed at ${card.price_xtz} tez`);
  return `${parts.join(" · ")}.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contract, tokenId } = await params;
  const ref = parseCardRef(contract, tokenId);
  const card = ref ? await loadSharedCard(ref) : null;
  if (!card) return { title: "Card not found" };

  const title = `${card.name} by ${card.artist_alias}`;
  const description = summarize(card);

  // og:image and twitter:image are deliberately absent: file-based metadata
  // outranks this object, so opengraph-image.tsx fills them in with the URL
  // that carries Next's cache-busting query.
  return {
    title,
    description,
    alternates: { canonical: cardPath(card) },
    openGraph: {
      type: "website",
      siteName: "TzDeck",
      url: cardPath(card),
      locale: "en_US",
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedCardPage({ params }: Props) {
  const { contract, tokenId } = await params;
  const ref = parseCardRef(contract, tokenId);
  if (!ref) notFound();

  const card = await loadSharedCard(ref);
  if (!card) notFound();

  const rarity = RARITY_CONFIG[card.rarity];
  const artistUrl = getArtistProfileUrl(card.artist_address);

  return (
    <main className="flex min-h-screen flex-col items-center bg-surface-0 px-4 py-8 sm:py-14">
      <Link
        href="/"
        className="font-display text-xl font-bold tracking-tight text-text-primary transition-colors hover:text-accent-hover"
      >
        TzDeck
      </Link>

      <article
        className={`mt-8 w-full max-w-[420px] overflow-hidden rounded-2xl bg-surface-1 ${rarity.ring} ${rarity.glow}`}
      >
        <div className="aspect-square w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getObjktThumbnailUrl(card)}
            alt={card.name}
            width={400}
            height={400}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="flex flex-col gap-5 p-6">
          <div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${rarity.badge}`}
            >
              {rarity.label}
            </span>
            <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight text-text-primary">
              {card.name}
            </h1>
            <p className="mt-2 text-sm font-medium text-accent-hover">
              {artistUrl ? (
                <a href={artistUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {card.artist_alias}
                </a>
              ) : (
                card.artist_alias
              )}
            </p>
            {card.collection_name && (
              <p className="mt-1 text-xs text-text-muted">
                <a
                  href={getCollectionUrl(card.contract_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {card.collection_name}
                </a>
              </p>
            )}
          </div>

          <dl className="flex gap-6 border-t border-border-subtle pt-4 text-sm">
            <div>
              <dt className="text-xs text-text-tertiary">Editions</dt>
              <dd className="mt-1 font-bold tabular-nums text-text-primary">
                {card.editions ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-tertiary">Listed</dt>
              <dd className="mt-1 font-bold tabular-nums text-accent-hover">
                {card.price_xtz !== undefined ? `ꜩ ${card.price_xtz}` : "Not listed"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2">
            <a
              href={card.objkt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="button-primary w-full px-4 py-3 text-sm font-bold"
            >
              Collect on OBJKT
            </a>
            <Link href="/" className="button-secondary w-full px-4 py-3 text-sm font-semibold">
              Open a pack on TzDeck
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
