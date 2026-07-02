"use client";

import { useState, useEffect } from "react";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState({
    gemini_api_key: "",
    gemini_model: "gemini-3.0-flash-preview",
    picnic_username: "",
    picnic_password: "",
    picnic_country_code: "NL",
    default_num_nights: "5",
    default_servings: "4",
    default_calories: "600",
    week_title_format: "weeknumber",
    exclude_staples_from_budget: "true",
    deals_enabled: "false",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Picnic connection state
  const [picnicConnected, setPicnicConnected] = useState<boolean | null>(null);
  const [twoFactorNeeded, setTwoFactorNeeded] = useState(false);
  const [twoFactorCodeSent, setTwoFactorCodeSent] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings((prev) => ({ ...prev, ...data }));
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/picnic/2fa")
      .then((r) => r.json())
      .then((data) => {
        setPicnicConnected(!!data.authenticated);
        setTwoFactorNeeded(!!data.needsTwoFactor);
      })
      .catch(() => {});
  }, []);

  const handleConnect = async () => {
    setConnectLoading(true);
    setConnectError("");
    try {
      const res = await fetch("/api/picnic/2fa", { method: "POST" });
      const data = await res.json();
      setPicnicConnected(!!data.authenticated);
      setTwoFactorNeeded(!!data.needsTwoFactor);
      if (!data.authenticated && !data.needsTwoFactor) {
        setConnectError(data.error || "Failed to connect");
      }
      window.dispatchEvent(new Event("picnic:status-changed"));
    } catch {
      setConnectError("Failed to connect");
    }
    setConnectLoading(false);
  };

  const handleSendTwoFactorCode = async () => {
    setTwoFactorLoading(true);
    setTwoFactorError("");
    try {
      const res = await fetch("/api/picnic/2fa/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTwoFactorError(data.error || "Failed to send code");
      } else {
        setTwoFactorCodeSent(true);
        // Re-check 2FA state in case it resolved (e.g. 2FA not actually needed)
        fetch("/api/picnic/2fa")
          .then((r) => r.json())
          .then((d) => setTwoFactorNeeded(!!d.needsTwoFactor))
          .catch(() => {});
      }
    } catch {
      setTwoFactorError("Failed to send code");
    }
    setTwoFactorLoading(false);
  };

  const handleVerifyTwoFactor = async () => {
    if (!twoFactorCode.trim()) return;
    setTwoFactorLoading(true);
    setTwoFactorError("");
    try {
      const res = await fetch("/api/picnic/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: twoFactorCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTwoFactorError(data.error || "Verification failed");
      } else {
        setPicnicConnected(true);
        setTwoFactorNeeded(false);
        setTwoFactorCodeSent(false);
        setTwoFactorCode("");
        window.dispatchEvent(new Event("picnic:status-changed"));
      }
    } catch {
      setTwoFactorError("Verification failed");
    }
    setTwoFactorLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save settings");
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
        // Re-verify the Picnic connection — saving changed credentials resets
        // the session, and the user should see the resulting state right away.
        if (settings.picnic_username) {
          handleConnect();
        }
      }
    } catch {
      setError("Failed to save settings");
    }
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="p-12"><Spinner /></div>
        ) : (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Gemini AI
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={settings.gemini_api_key}
                    onChange={(e) =>
                      setSettings({ ...settings, gemini_api_key: e.target.value })
                    }
                    onFocus={() => {
                      // Masked placeholder from GET — clear so the user can't
                      // accidentally save an edited mask as their key
                      if (settings.gemini_api_key.includes("...")) {
                        setSettings({ ...settings, gemini_api_key: "" });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="AIza..."
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Model
                  </label>
                  <select
                    value={settings.gemini_model}
                    onChange={(e) =>
                      setSettings({ ...settings, gemini_model: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash-lite">
                      Gemini 2.5 Flash Lite
                    </option>
                    <option value="gemini-3.0-flash-preview">Gemini 3 Flash (Preview)</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro (Preview)</option>
                    {![
                      "gemini-2.5-flash",
                      "gemini-2.5-pro",
                      "gemini-2.5-flash-lite",
                      "gemini-3.0-flash-preview",
                      "gemini-3-pro-preview",
                    ].includes(settings.gemini_model) && (
                      <option value={settings.gemini_model}>
                        {settings.gemini_model} (current)
                      </option>
                    )}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  Picnic Grocery
                </h3>
                {picnicConnected !== null && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                      picnicConnected
                        ? "bg-green-50 text-green-700"
                        : twoFactorNeeded
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        picnicConnected
                          ? "bg-green-500"
                          : twoFactorNeeded
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />
                    {picnicConnected
                      ? "Connected"
                      : twoFactorNeeded
                        ? "2FA required"
                        : "Not connected"}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Username / Email
                  </label>
                  <input
                    type="text"
                    value={settings.picnic_username}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        picnic_username: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={settings.picnic_password}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        picnic_password: e.target.value,
                      })
                    }
                    onFocus={() => {
                      if (settings.picnic_password === "********") {
                        setSettings({ ...settings, picnic_password: "" });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Country
                  </label>
                  <select
                    value={settings.picnic_country_code}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        picnic_country_code: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="NL">Netherlands</option>
                    <option value="DE">Germany</option>
                    <option value="BE">Belgium</option>
                  </select>
                </div>
              </div>

              {settings.picnic_username && !twoFactorNeeded && (
                <div className="mt-4">
                  <Button
                    variant="secondary"
                    onClick={handleConnect}
                    disabled={connectLoading}
                  >
                    {connectLoading
                      ? "Connecting..."
                      : picnicConnected
                        ? "Re-check connection"
                        : "Connect to Picnic"}
                  </Button>
                  {connectError && (
                    <p className="text-xs text-red-600 mt-2">{connectError}</p>
                  )}
                </div>
              )}

              {twoFactorNeeded && (
                <div className="mt-4 p-3 rounded-lg border bg-amber-50 border-amber-200">
                  <p className="text-sm font-medium text-amber-800 mb-2">
                    Two-factor authentication required
                  </p>
                  <p className="text-xs text-amber-700 mb-3">
                    Your Picnic account has 2FA enabled. Click &quot;Send SMS code&quot; to receive a verification code, then enter it below.
                  </p>
                  {!twoFactorCodeSent ? (
                    <Button
                      variant="secondary"
                      onClick={handleSendTwoFactorCode}
                      disabled={twoFactorLoading}
                    >
                      {twoFactorLoading ? "Sending..." : "Send SMS code"}
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value)}
                        placeholder="6-digit code"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        onKeyDown={(e) => { if (e.key === "Enter") handleVerifyTwoFactor(); }}
                      />
                      <Button
                        onClick={handleVerifyTwoFactor}
                        disabled={twoFactorLoading || !twoFactorCode.trim()}
                      >
                        {twoFactorLoading ? "Verifying..." : "Verify"}
                      </Button>
                    </div>
                  )}
                  {twoFactorError && (
                    <p className="text-xs text-red-600 mt-2">{twoFactorError}</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Week Defaults
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Default Number of Nights
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={7}
                    value={settings.default_num_nights}
                    onChange={(e) =>
                      setSettings({ ...settings, default_num_nights: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Default Servings per Meal
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={settings.default_servings}
                    onChange={(e) =>
                      setSettings({ ...settings, default_servings: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Default Calories per Serving
                  </label>
                  <input
                    type="number"
                    min={300}
                    max={1200}
                    step={50}
                    value={settings.default_calories}
                    onChange={(e) =>
                      setSettings({ ...settings, default_calories: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Target calories per serving for generated recipes (default: 600)
                  </p>
                </div>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.exclude_staples_from_budget !== "false"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          exclude_staples_from_budget: e.target.checked ? "true" : "false",
                        })
                      }
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-600">
                      Exclude pantry staples from recipe budget
                    </span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">
                    When enabled, staple items you already have at home won&apos;t count toward the budget constraint
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Week Title Format
                  </label>
                  <select
                    value={settings.week_title_format}
                    onChange={(e) =>
                      setSettings({ ...settings, week_title_format: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="weeknumber">Week number (Week 7, 2026)</option>
                    <option value="date">Date (Maandag 16 Feb)</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                Experimental Features
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                These features are in development and may behave unexpectedly.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.deals_enabled === "true"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          deals_enabled: e.target.checked ? "true" : "false",
                        })
                      }
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-600">
                      Deals — discover Picnic promotions
                    </span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">
                    Scans your frequent items for active deals via the Picnic product pages. Shows a Deals page and injects on-sale products into the meal planning prompt. Makes additional API calls that may trigger rate limiting.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-green-600 bg-green-50 p-3 rounded-lg">
                Settings saved successfully!
              </p>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
