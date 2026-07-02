"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import SettingsModal from "./SettingsModal";

export type PicnicStatus = "checking" | "connected" | "2fa" | "disconnected" | "unconfigured";

const STATUS_STYLES: Record<PicnicStatus, { dot: string; label: string; title: string }> = {
  checking: { dot: "bg-gray-300 animate-pulse", label: "Picnic", title: "Checking Picnic connection..." },
  connected: { dot: "bg-green-500", label: "Picnic", title: "Picnic connected" },
  "2fa": { dot: "bg-amber-500", label: "Picnic: 2FA", title: "Picnic needs two-factor verification — click to fix" },
  disconnected: { dot: "bg-red-500", label: "Picnic: offline", title: "Picnic is not connected — ingredients won't be matched. Click to fix." },
  unconfigured: { dot: "bg-gray-400", label: "Picnic: setup", title: "Picnic credentials not configured — click to set up" },
};

export default function Navbar() {
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [dealsEnabled, setDealsEnabled] = useState(false);
  const [picnicStatus, setPicnicStatus] = useState<PicnicStatus>("checking");

  const checkPicnic = useCallback(async () => {
    try {
      const res = await fetch("/api/picnic/2fa", { method: "POST" });
      const data = await res.json();
      if (data.needsTwoFactor) {
        setPicnicStatus("2fa");
        window.dispatchEvent(new Event("picnic:2fa-required"));
      } else if (data.authenticated) {
        setPicnicStatus("connected");
      } else if (data.configured === false) {
        setPicnicStatus("unconfigured");
      } else {
        setPicnicStatus("disconnected");
      }
    } catch {
      setPicnicStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    checkPicnic();

    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setDealsEnabled(data?.deals_enabled === "true"))
      .catch(() => {});

    const openHandler = () => setShowSettings(true);
    const statusHandler = () => checkPicnic();
    window.addEventListener("picnic:2fa-required", openHandler);
    window.addEventListener("picnic:status-changed", statusHandler);
    return () => {
      window.removeEventListener("picnic:2fa-required", openHandler);
      window.removeEventListener("picnic:status-changed", statusHandler);
    };
  }, [checkPicnic]);

  const status = STATUS_STYLES[picnicStatus];

  const sectionLinks = (
    <>
      <Link href="/recipes" className="text-sm text-gray-600 hover:text-gray-900 font-medium" onClick={() => setShowMobileMenu(false)}>
        My Recipes
      </Link>
      {dealsEnabled && (
        <Link href="/deals" className="text-sm text-gray-600 hover:text-gray-900 font-medium" onClick={() => setShowMobileMenu(false)}>
          Deals
        </Link>
      )}
      <Link href="/frequent-items" className="text-sm text-gray-600 hover:text-gray-900 font-medium" onClick={() => setShowMobileMenu(false)}>
        Frequent Items
      </Link>
      <Link href="/staples" className="text-sm text-gray-600 hover:text-gray-900 font-medium" onClick={() => setShowMobileMenu(false)}>
        Staples
      </Link>
      <Link href="/exclusions" className="text-sm text-gray-600 hover:text-gray-900 font-medium" onClick={() => setShowMobileMenu(false)}>
        Exclusions
      </Link>
    </>
  );

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center gap-3">
            <div className="flex items-center gap-6 min-w-0">
              <Link
                href="/"
                className="text-xl font-bold text-green-600 flex items-center gap-2 shrink-0"
              >
                <span className="text-2xl">🍽️</span>
                <span className="hidden sm:inline">Weekmenu</span>
              </Link>
              <div className="hidden md:flex items-center gap-4">
                {sectionLinks}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-colors"
                title={status.title}
                aria-label={status.title}
              >
                <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                <span className="text-xs font-medium text-gray-600">{status.label}</span>
              </button>
              <Link
                href="/create"
                className="bg-green-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
              >
                + New Week
              </Link>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                title="Settings"
                aria-label="Settings"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setShowMobileMenu((v) => !v)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                title="Menu"
                aria-label="Menu"
                aria-expanded={showMobileMenu}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {showMobileMenu ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
          {showMobileMenu && (
            <div className="md:hidden flex flex-col gap-3 pb-4 border-t border-gray-100 pt-3">
              {sectionLinks}
            </div>
          )}
        </div>
      </nav>
      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false);
            window.dispatchEvent(new Event("picnic:status-changed"));
          }}
        />
      )}
    </>
  );
}
