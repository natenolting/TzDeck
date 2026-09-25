import { track } from "@vercel/analytics";

import type { CardRarity } from "./objkt";

/**
 * Every custom analytics event this app is allowed to send.
 *
 * The union is closed on purpose. A wallet address, a contract address, a
 * token id or a card key has no field to travel in, so the privacy rule from
 * issue #73 -- none of those may ever reach Vercel Analytics -- fails to
 * compile rather than relying on a reviewer noticing. Adding a variant is a
 * deliberate edit to this type, which is where the rule gets re-read.
 *
 * These events are therefore anonymous and aggregate: they say how often a
 * step happened, never who took it. Wallet-level truth lives in Postgres and
 * is read by `npm run funnel`, which never leaves the database.
 */
export type FunnelEvent =
  | { name: "pack_opened"; packSize: number }
  | { name: "card_inspected"; rarity: CardRarity }
  | { name: "card_shared"; rarity: CardRarity }
  | { name: "demo_battle_started"; source: "deck" | "pack" }
  | { name: "demo_battle_replayed"; source: "deck" | "pack" }
  | { name: "wallet_connect_started" }
  | { name: "wallet_connected" };

/** The only supported way to send a custom event. Direct `track` imports are an eslint error. */
export function trackFunnelEvent(event: FunnelEvent): void {
  const { name, ...properties } = event;

  // The two wallet events carry nothing. `track(name)` sends no `data` key at
  // all, where `track(name, {})` would send an empty one.
  if (Object.keys(properties).length === 0) {
    track(name);
    return;
  }

  track(name, properties);
}
