import { NextRequest, NextResponse } from "next/server";
import { effectiveStats, levelForXp } from "@/lib/battle/rules";
import { fetchAllProgressForWallet, fetchWallet } from "@/lib/battle/store";

// Public wallet game status can be read without a write signature; internal
// attempt signatures, leases, and worker tokens are never returned here.
export const maxDuration = 10;

const NO_STORE_CACHE_CONTROL = "no-store";

function effectiveCount(count: number, resetAt: string, now: Date): number {
  return new Date(resetAt) <= now ? 0 : count;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address_required" }, { status: 400 });
  }

  try {
    const now = new Date();
    const [wallet, progress] = await Promise.all([fetchWallet(address), fetchAllProgressForWallet(address)]);

    const cards = progress.map((row) => {
      const level = levelForXp(Number(row.xp));
      const stats = effectiveStats(
        { editions: row.seed_editions, descriptionLength: row.seed_description_length },
        level,
      );
      return {
        cardKey: row.card_key,
        xp: Number(row.xp),
        level,
        power: stats.power,
        hp: stats.hp,
        recoveryUntil: row.recovery_until,
        recoveryReason: row.recovery_reason,
      };
    });

    return NextResponse.json(
      {
        optedIn: wallet?.opted_in ?? false,
        effectiveAttackCount: wallet ? effectiveCount(wallet.attack_count, wallet.attack_reset_at, now) : 0,
        attackResetAt: wallet?.attack_reset_at ?? null,
        effectiveDefenseCount: wallet ? effectiveCount(wallet.defense_count, wallet.defense_reset_at, now) : 0,
        defenseResetAt: wallet?.defense_reset_at ?? null,
        holdingsRefreshedAt: wallet?.holdings_refreshed_at ?? null,
        cards,
      },
      { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("Error in battle status route:", error);
    return NextResponse.json({ error: "status_unavailable" }, { status: 500 });
  }
}
