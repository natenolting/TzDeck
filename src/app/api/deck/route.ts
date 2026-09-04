import { NextRequest, NextResponse } from "next/server";
import { fetchUserHoldings } from "@/lib/objkt";

// Worst case is two sequential upstream calls (objkt, then tzkt as fallback),
// so the 300s platform default only serves to bill a hung request.
export const maxDuration = 20;

// Holdings are public and drift on the order of minutes, so let the CDN absorb
// repeat loads of the same wallet rather than paying for an invocation each
// time. The cache key includes `?address=`, so wallets stay separate.
const HOLDINGS_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Wallet address is required" },
      { status: 400 }
    );
  }

  try {
    const tokens = await fetchUserHoldings(address);
    return NextResponse.json(
      { tokens },
      { headers: { "Cache-Control": HOLDINGS_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("Error in deck API:", error);
    return NextResponse.json(
      { error: "Failed to fetch deck" },
      { status: 500 }
    );
  }
}
