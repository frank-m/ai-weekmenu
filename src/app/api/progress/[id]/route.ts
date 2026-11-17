import { NextResponse } from "next/server";
import { getProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ message: getProgress(params.id) });
}
