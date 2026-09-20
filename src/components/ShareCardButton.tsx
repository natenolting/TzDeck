"use client";

import { useEffect, useRef, useState } from "react";

import { trackFunnelEvent } from "@/lib/analytics";
import { shareLink } from "@/lib/share";
import type { NFTCard } from "@/lib/objkt";
import { CheckIcon, ShareIcon } from "./icons";

/**
 * Copies the link the old way, for browsers that refuse the async clipboard.
 *
 * `navigator.clipboard` needs a permission that a locked-down browser, an
 * embedded webview or a non-secure origin can decline outright. `execCommand`
 * is deprecated and still works in most of those, so it is worth one try
 * before giving up and asking the reader to copy by hand.
 */
function copyTheOldWay(text: string): boolean {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Puts the card's link where a person can paste it.
 *
 * The clipboard gets the bare URL: no caption, no campaign parameter. The
 * preview itself already carries the name, the artist and the rarity, and X,
 * Discord and Telegram each autolink surrounding text differently, so prefixed
 * copy would be a tone decision made on the recipient's behalf.
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
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (manualUrl) fieldRef.current?.select();
  }, [manualUrl]);

  async function share() {
    const url = shareLink(card);
    setManualUrl(null);

    if (navigator.share) {
      try {
        await navigator.share({ url });
        trackFunnelEvent({ name: "card_shared", rarity: card.rarity });
        return;
      } catch (err) {
        // A dismissed share sheet is a decision, not a failure.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackFunnelEvent({ name: "card_shared", rarity: card.rarity });
      return;
    } catch {
      // Permission denied, or no clipboard at all. Try the old way.
    }

    if (copyTheOldWay(url)) {
      setCopied(true);
      trackFunnelEvent({ name: "card_shared", rarity: card.rarity });
      return;
    }

    // Nothing could reach the clipboard. Show the link rather than leave a
    // button that appears to do nothing at all.
    setManualUrl(url);
  }

  const look =
    variant === "icon"
      ? "h-11 w-11 rounded-xl border border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      : "min-h-11 gap-1.5 rounded-lg px-3 text-xs text-text-tertiary hover:bg-surface-2 hover:text-text-secondary";

  const panelAnchor =
    variant === "icon" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <span className="relative inline-flex shrink-0">
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

      {manualUrl && (
        <span
          className={`absolute right-0 z-20 flex w-[min(16rem,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-border-strong bg-surface-3 p-3 shadow-xl ${panelAnchor}`}
        >
          <span className="text-2xs text-text-tertiary">
            Your browser blocked the clipboard. Copy this link:
          </span>
          <input
            ref={fieldRef}
            readOnly
            value={manualUrl}
            aria-label="Card link, copy it manually"
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // The modal closes on Escape, and dismissing this is not that.
              event.stopPropagation();
              setManualUrl(null);
            }}
            className="w-full rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary"
          />
        </span>
      )}
    </span>
  );
}
