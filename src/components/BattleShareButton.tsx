"use client";

import { trackFunnelEvent } from "@/lib/analytics";
import { battleShareLink } from "@/lib/share";
import ShareLinkButton from "./ShareLinkButton";

/**
 * Shares a won battle's page (#81). The token is the whole link, so there is
 * nothing to create first: it arrived with the battle's result.
 */
export default function BattleShareButton({
  token,
  against,
  variant,
}: {
  token: string;
  against: "trainer" | "collector";
  variant: "icon" | "corner";
}) {
  return (
    <ShareLinkButton
      url={battleShareLink(token)}
      label="Share this win"
      fieldLabel="Battle link, copy it manually"
      onShared={() => trackFunnelEvent({ name: "battle_shared", against })}
      variant={variant}
    />
  );
}
