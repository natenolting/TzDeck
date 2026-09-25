"use client";

import { trackFunnelEvent } from "@/lib/analytics";
import type { NFTCard } from "@/lib/objkt";
import { shareLink } from "@/lib/share";
import ShareLinkButton from "./ShareLinkButton";

/**
 * Shares a card's own page. The clipboard gets the bare URL: no caption, no
 * campaign parameter. The preview itself already carries the name, the artist
 * and the rarity, and X, Discord and Telegram each autolink surrounding text
 * differently, so prefixed copy would be a tone decision made on the
 * recipient's behalf.
 *
 * `icon` is the square treatment beside a primary action, where a label would
 * dilute the one control meant to lead. `corner` is the header treatment on a
 * shared card's own page, where this sits beside the wordmark rather than among
 * the calls to action.
 */
export default function ShareCardButton({
  card,
  variant,
}: {
  card: NFTCard;
  variant: "icon" | "corner";
}) {
  return (
    <ShareLinkButton
      url={shareLink(card)}
      label={`Share ${card.name}`}
      fieldLabel="Card link, copy it manually"
      onShared={() => trackFunnelEvent({ name: "card_shared", rarity: card.rarity })}
      variant={variant}
    />
  );
}
