import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import BattleShareButton from "@/components/BattleShareButton";
import { RARITY_CONFIG } from "@/components/rarityStyles";
import SharedCardArtwork from "@/components/SharedCardArtwork";
import type { ShareSide } from "@/lib/battle/shareToken";
import { trainerAvatarSvg } from "@/lib/battle/trainerAvatar";
import { battleSummary, loadBattleShare, type ResolvedBattleShare } from "@/lib/battleShareServer";
import { calculateSupplyRarity, type CardRarity, type NFTCard } from "@/lib/objkt";
import { battleOgImage } from "@/lib/share";

/**
 * The battle never changes; the cards around it can (a denylisting, a burned
 * token), so the page re-resolves them hourly like a card page does.
 */
export const revalidate = 3600;

type Props = { params: Promise<{ token: string }> };

function winnerName(resolved: ResolvedBattleShare): string {
  return resolved.winnerCard?.name ?? "A card";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const resolved = await loadBattleShare(token);
  if (!resolved) return { title: "Battle not found" };

  const title = `${winnerName(resolved)} won on TzDeck`;
  const description = battleSummary(resolved);
  const image = battleOgImage(token);
  const path = `/b/${token}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "TzDeck", url: path, locale: "en_US", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

function Side({
  heading,
  name,
  detail,
  rarity,
  side,
  art,
}: {
  heading: string;
  name: string;
  detail: string | null;
  rarity: CardRarity | null;
  side: ShareSide;
  art: React.ReactNode;
}) {
  const config = rarity ? RARITY_CONFIG[rarity] : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <p className="text-2xs font-bold uppercase tracking-wider text-text-tertiary">{heading}</p>
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-xl bg-black ${config ? `${config.ring} ${config.glow}` : ""}`}
      >
        {art}
      </div>
      <div className="min-w-0">
        {config && (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-2xs font-bold uppercase tracking-wider ${config.badge}`}>
            {config.label}
          </span>
        )}
        <p className="mt-1.5 truncate font-display text-sm font-bold text-text-primary">{name}</p>
        {detail && <p className="truncate text-xs text-text-secondary">{detail}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 text-xs">
        <div>
          <dt className="text-text-tertiary">Power</dt>
          <dd className="mt-0.5 font-bold tabular-nums text-text-primary">{side.power}</dd>
        </div>
        <div>
          <dt className="text-text-tertiary">HP left</dt>
          <dd className="mt-0.5 font-bold tabular-nums text-text-primary">
            {side.finalHp} / {side.maxHp}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-2 p-4 text-center text-xs text-text-tertiary">
      {text}
    </div>
  );
}

function cardArt(card: NFTCard | null) {
  return card ? <SharedCardArtwork card={card} /> : <Placeholder text="Artwork unavailable" />;
}

const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export default async function BattleResultPage({ params }: Props) {
  const { token } = await params;
  const resolved = await loadBattleShare(token);
  if (!resolved) notFound();

  const { share, winnerCard, opponentCard, opponentRarity } = resolved;
  const isTrainer = share.opponent.kind === "trainer";

  return (
    <main className="flex min-h-screen flex-col items-center bg-surface-0 px-4 py-8 sm:py-14">
      <header className="flex w-full max-w-[560px] items-center justify-between">
        <Link
          href="/"
          className="font-display text-xl font-bold tracking-tight text-text-primary transition-colors hover:text-accent-hover"
        >
          TzDeck
        </Link>
        <BattleShareButton token={token} against={isTrainer ? "trainer" : "collector"} variant="corner" />
      </header>

      <article className="mt-8 w-full max-w-[560px] rounded-2xl border border-border-default bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-success">Victory</h1>
          <p className="text-xs tabular-nums text-text-tertiary">
            {DATE.format(new Date(share.wonAt * 1000))}
          </p>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{battleSummary(resolved)}</p>

        {/* Names cards, never collectors: the opponent didn't choose to be shared. */}
        <div className="mt-5 flex gap-4 sm:gap-6">
          <Side
            heading="Winner"
            name={winnerName(resolved)}
            detail={winnerCard?.artist_alias ? `by ${winnerCard.artist_alias}` : null}
            rarity={winnerCard ? calculateSupplyRarity(winnerCard.editions) : null}
            side={share.winnerSide}
            art={cardArt(winnerCard)}
          />
          <Side
            heading="Opponent"
            name={isTrainer ? `${RARITY_CONFIG[opponentRarity!].label} Trainer` : (opponentCard?.name ?? "Another collector's card")}
            detail={isTrainer ? "TzDeck trainer" : opponentCard?.artist_alias ? `by ${opponentCard.artist_alias}` : null}
            rarity={opponentRarity}
            side={share.opponentSide}
            art={
              share.opponent.kind === "trainer" ? (
                <div
                  className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: trainerAvatarSvg(share.opponent.tier) }}
                />
              ) : (
                cardArt(opponentCard)
              )
            }
          />
        </div>

        <div className="mt-6 flex items-stretch gap-2">
          <Link href="/" className="button-primary flex-1 px-3 py-3 text-center text-sm font-bold">
            Battle on TzDeck
          </Link>
          {winnerCard && (
            <Link
              href={`/c/${winnerCard.contract_address}/${winnerCard.token_id}`}
              className="button-secondary flex-1 px-3 py-3 text-center text-sm font-bold text-text-primary"
            >
              See the winning card
            </Link>
          )}
        </div>
      </article>
    </main>
  );
}
