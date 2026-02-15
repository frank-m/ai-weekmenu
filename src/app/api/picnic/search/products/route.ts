import { NextRequest, NextResponse } from "next/server";
import { rawSearch } from "@/lib/picnic";

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const products = await rawSearch(query.trim(), 20);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Product search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
