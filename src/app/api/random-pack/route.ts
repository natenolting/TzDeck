import { NextRequest, NextResponse } from "next/server";
import { fetchRandomPack } from "@/lib/objkt";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const countParam = searchParams.get("count");
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 5, 3), 10);
    const address = body?.address;

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
      address,
    });
  } catch (error) {
    console.error("Error in /api/random-pack POST:", error);
    return NextResponse.json(
      { error: "Failed to generate booster pack" },
      { status: 500 }
    );
  }
}
