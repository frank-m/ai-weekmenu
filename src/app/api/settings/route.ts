import { NextResponse } from "next/server";
import { getAllSettings, getSetting, setSetting } from "@/lib/db";
import { testApiKey } from "@/lib/gemini";

export const dynamic = "force-dynamic";
import { resetPicnicClient } from "@/lib/picnic";

export async function GET() {
  try {
    const settings = getAllSettings();
    // Mask sensitive values
    const masked = { ...settings };
    if (masked.gemini_api_key) {
      masked.gemini_api_key = masked.gemini_api_key.slice(0, 8) + "...";
    }
    if (masked.picnic_password) {
      masked.picnic_password = "********";
    }
    // Internal session token — must never reach the browser
    delete masked.picnic_auth_key;
    return NextResponse.json(masked);
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const allowedKeys = [
      "gemini_api_key",
      "gemini_model",
      "picnic_username",
      "picnic_password",
      "picnic_country_code",
      "default_num_nights",
      "default_servings",
      "default_calories",
      "week_title_format",
      "exclude_staples_from_budget",
      "deals_enabled",
    ];

    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.includes(key)) continue;
      if (typeof value !== "string") continue;

      // Don't overwrite with masked values from GET, and treat an empty
      // secret as "unchanged" (the form clears masked values on focus)
      if (key === "gemini_api_key" && (value.includes("...") || !value)) continue;
      if (key === "picnic_password" && (value === "********" || !value)) continue;

      if (key === "gemini_api_key" && value) {
        const valid = await testApiKey(value);
        if (!valid) {
          return NextResponse.json(
            { error: "Invalid Gemini API key" },
            { status: 400 }
          );
        }
      }

      // Only drop the Picnic session when a credential actually changed —
      // resetting unconditionally wiped the stored auth key on every save,
      // silently logging the user out (and forcing a fresh 2FA cycle).
      if (key.startsWith("picnic_") && getSetting(key) !== value) {
        resetPicnicClient();
      }

      setSetting(key, value);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
