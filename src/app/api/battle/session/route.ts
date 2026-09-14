import { NextRequest, NextResponse } from "next/server";
import { getPublicProtocolInfo, issueNonce } from "@/lib/battle/auth";
import { getClientIp } from "@/lib/battle/requestAuth";
import { checkRateLimit } from "@/lib/battle/store";

// Issuance itself is pure computation, no database write -- unauthenticated
// callers get no wallet identity to key a budget on, so an IP-keyed check is
// the only fence available here; it costs one indexed upsert, far cheaper
// than the write-per-issuance the original design (Key Technical Decisions)
// avoided, and this is the one route every signing flow hits unauthenticated.
export const maxDuration = 5;

const NO_STORE_CACHE_CONTROL = "no-store";
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;

export async function GET(request: NextRequest) {
  const withinBudget = await checkRateLimit(`session:${getClientIp(request)}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS);
  if (!withinBudget) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const envelope = issueNonce();
    return NextResponse.json({ ...envelope, ...getPublicProtocolInfo() }, {
      headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("Error issuing battle session nonce:", error);
    return NextResponse.json(
      { error: "Failed to issue session nonce" },
      { status: 500 }
    );
  }
}
