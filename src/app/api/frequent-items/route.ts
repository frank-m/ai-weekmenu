import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FrequentItem } from "@/lib/types";

export async function GET() {
  try {
    const db = getDb();
    const items = db
      .prepare("SELECT * FROM frequent_items ORDER BY name")
      .all() as FrequentItem[];
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: {
      picnic_id: string;
      name: string;
      image_id?: string;
      price?: number;
      unit_quantity?: string;
      quantity?: number;
    } = await request.json();

    const db = getDb();

    // Check if already exists
    const existing = db
      .prepare("SELECT id, quantity FROM frequent_items WHERE picnic_id = ?")
      .get(body.picnic_id) as { id: number; quantity: number } | undefined;

    if (existing) {
      // Increment quantity
      db.prepare(
        "UPDATE frequent_items SET quantity = quantity + 1 WHERE id = ?"
      ).run(existing.id);
      return NextResponse.json({ id: existing.id }, { status: 200 });
    }

    const result = db
      .prepare(
        "INSERT INTO frequent_items (picnic_id, name, image_id, price, unit_quantity, quantity) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        body.picnic_id,
        body.name,
        body.image_id || "",
        body.price || 0,
        body.unit_quantity || "",
        body.quantity || 1
      );

    return NextResponse.json(
      { id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body: {
      id: number;
      quantity?: number;
      picnic_id?: string;
      name?: string;
      image_id?: string;
      price?: number;
      unit_quantity?: string;
    } = await request.json();
    const db = getDb();

    if (body.picnic_id) {
      // Bundle swap: update all product fields
      db.prepare(
        "UPDATE frequent_items SET picnic_id = ?, name = ?, image_id = ?, price = ?, unit_quantity = ? WHERE id = ?"
      ).run(
        body.picnic_id,
        body.name || "",
        body.image_id || "",
        body.price || 0,
        body.unit_quantity || "",
        body.id
      );
    } else if (body.quantity !== undefined) {
      if (body.quantity < 1) {
        db.prepare("DELETE FROM frequent_items WHERE id = ?").run(body.id);
      } else {
        db.prepare("UPDATE frequent_items SET quantity = ? WHERE id = ?").run(
          body.quantity,
          body.id
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const db = getDb();
    db.prepare("DELETE FROM frequent_items WHERE id = ?").run(Number(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
