import { NextRequest, NextResponse } from "next/server";
import { fetchRandomPack } from "@/lib/objkt";

export const dynamic = "force-dynamic";

function getRequestCount(body: unknown): unknown {
  if (!body || typeof body !== "object" || !("count" in body)) return undefined;
  return body.count;
}

async function handleGeneratePack(countParam: unknown) {
  const count = Math.min(Math.max(Number(countParam) || 5, 3), 10);

  try {
    const cards = await fetchRandomPack(count);
    if (!cards || cards.length === 0) {
      return NextResponse.json(
        { error: "Failed to generate pack. Please try again." },
        { status: 500 }
      );
    }

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
