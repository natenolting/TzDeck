import { NextRequest, NextResponse } from "next/server";
import { fetchRandomPack } from "@/lib/objkt";
import { loadDenylist, scheduleExclusionWrite } from "@/lib/pullStore";

// The pack is drawn server-side, so a shared CDN cache would hand every visitor
// the same "random" pack for the life of the entry. Stays uncached on purpose.
export const dynamic = "force-dynamic";

// One GraphQL call, plus a fallback query when the windows come back empty.
export const maxDuration = 20;

function getRequestCount(body: unknown): unknown {
  if (!body || typeof body !== "object" || !("count" in body)) return undefined;
  return body.count;
}

async function handleGeneratePack(countParam: unknown) {
  const count = Math.min(Math.max(Number(countParam) || 5, 3), 10);

  try {
    // Never throws: a database failure degrades the filter to the three OBJKT
    // rules rather than failing the pack.
    const denylist = await loadDenylist();
    const { cards, excluded } = await fetchRandomPack(count, denylist);

    if (!cards || cards.length === 0) {
      return NextResponse.json(
        { error: "Failed to generate pack. Please try again." },
        { status: 500 }
      );
    }

    // Runs once the response has been sent, so recording an audit trail never
    // makes a draw slower. Bounded by this route's maxDuration.
    scheduleExclusionWrite(excluded);

    return NextResponse.json({
      cards,
      timestamp: Date.now(),
      packSize: cards.length,
    });
  } catch (error) {
    console.error("Error in /api/random-pack:", error);
    return NextResponse.json(
      { error: "Failed to generate booster pack" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return handleGeneratePack(searchParams.get("count"));
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => ({}));
  return handleGeneratePack(getRequestCount(body));
}
