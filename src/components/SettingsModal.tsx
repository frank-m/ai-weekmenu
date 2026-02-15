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
    gemini_model: "gemini-2.5-flash",
    picnic_username: "",
    picnic_password: "",
    picnic_country_code: "NL",
    default_num_nights: "5",
    default_servings: "4",
    week_title_format: "weeknumber",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings((prev) => ({ ...prev, ...data }));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
      }
    } catch {
      setError("Failed to save settings");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
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
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro (Preview)</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Picnic Grocery
              </h3>
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
