import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ recipeId: string }> }
) {
  try {
    const { recipeId } = await params;
    const id = parseInt(recipeId);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid recipe id" }, { status: 400 });
    }

    const body: { rating: number | null } = await request.json();
    const rating = body.rating;

    if (rating !== null && rating !== 1 && rating !== -1) {
      return NextResponse.json(
        { error: "rating must be 1, -1, or null" },
        { status: 400 }
      );
    }

    const db = getDb();
    const result = db
      .prepare("UPDATE recipes SET rating = ? WHERE id = ?")
      .run(rating, id);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
