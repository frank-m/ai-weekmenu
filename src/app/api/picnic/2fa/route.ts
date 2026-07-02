import { NextResponse } from "next/server";
import { getPicnicAuthState, checkPicnicConnection } from "@/lib/picnic";
import { getSetting } from "@/lib/db";

function credentialsConfigured(): boolean {
  const username = getSetting("picnic_username") || process.env.PICNIC_USERNAME || "";
  const password = getSetting("picnic_password") || process.env.PICNIC_PASSWORD || "";
  return !!username && !!password;
}

export async function GET() {
  const state = getPicnicAuthState();
  return NextResponse.json({ ...state, configured: credentialsConfigured() });
}

/**
 * Verifies the Picnic connection end-to-end: logs in if needed and makes a
 * cheap authenticated call, so a stale restored auth key is detected here
 * instead of failing silently during ingredient matching later.
 */
export async function POST() {
  if (!credentialsConfigured()) {
    return NextResponse.json({
      authenticated: false,
      needsTwoFactor: false,
      hasClient: false,
      configured: false,
      error: "Picnic credentials not configured",
    });
  }
  const state = await checkPicnicConnection();
  return NextResponse.json({ ...state, configured: true });
}
