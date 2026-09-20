"use client";

import { useEffect, useState } from "react";

import { shareLink } from "@/lib/share";
import type { NFTCard } from "@/lib/objkt";
import { CheckIcon, ShareIcon } from "./icons";

/**
 * Puts the card's link where a person can paste it.
 *
 * The clipboard gets the bare URL: no caption, no campaign parameter. The
 * preview itself already carries the name, the artist and the rarity, and X,
 * Discord and Telegram each autolink surrounding text differently, so prefixed
 * copy would be a tone decision made on the recipient's behalf.
 *
 * `icon` is the square treatment beside a primary action, where the label would
 * dilute the one control meant to lead.
 *
 * `corner` is the header treatment on a shared card's own page, where this sits
 * beside the wordmark rather than among the calls to action. Everyone who lands
 * there arrived because someone shared the link, which makes them the likeliest
 * person to share it onward.
 */
export default function ShareCardButton({
  card,
  variant = "action",
}: {
  card: NFTCard;
  variant?: "action" | "corner" | "icon";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = shareLink(card);

    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch (err) {
        // A dismissed share sheet is a decision, not a failure.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission and no share sheet leaves nothing to do but
      // leave the button alone, rather than claim a copy that did not happen.
    }
  }

  const look = {
    corner:
      "min-h-11 gap-1.5 rounded-lg px-3 text-xs text-text-tertiary hover:bg-surface-2 hover:text-text-secondary",
    icon: "h-11 w-11 rounded-xl border border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary",
    action:
      "gap-2 rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm text-text-secondary hover:bg-surface-3",
  }[variant];

  return (
    <button
      type="button"
      onClick={share}
      aria-label={`Share ${card.name}`}
      className={`flex shrink-0 items-center justify-center font-semibold transition-colors ${look}`}
    >
      {copied ? <CheckIcon className="h-4 w-4" /> : <ShareIcon className="h-4 w-4" />}
      <span role="status" className={variant === "icon" ? "sr-only" : undefined}>
        {copied ? "Copied" : "Share"}
      </span>
    </button>
  );
}
