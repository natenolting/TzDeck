import { NextResponse } from "next/server";
import { getPublicProtocolInfo, issueNonce } from "@/lib/battle/auth";

// Pure computation, no database write -- issuance is necessarily
// unauthenticated, so this must cost nothing to call (Key Technical
// Decisions: an earlier design's DB write per issuance was a free-tier
// compute-exhaustion vector).
export const maxDuration = 5;

const NO_STORE_CACHE_CONTROL = "no-store";

export async function GET() {
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
