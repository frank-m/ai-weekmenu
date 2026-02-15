"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Week } from "@/lib/types";
import WeekCard from "@/components/WeekCard";
import Spinner from "@/components/ui/Spinner";

export default function HomePage() {
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/weeks")
      .then((r) => r.json())
      .then((data) => {
        setWeeks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Your Weeks</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/recipes"
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            My Recipes
          </Link>
          <Link
            href="/frequent-items"
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            Frequent Items
          </Link>
          <Link
            href="/staples"
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            Staples
          </Link>
          <Link
            href="/create"
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            + New Week
          </Link>
        </div>
      </div>

      {weeks.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">🍽️</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            No weeks yet
          </h2>
          <p className="text-gray-500 mb-6">
            Create your first weekly dinner menu to get started.
          </p>
          <Link
            href="/create"
            className="inline-flex bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
          >
            Create Your First Week
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {weeks.map((week) => (
            <WeekCard key={week.id} week={week} />
          ))}
        </div>
      )}
    </div>
  );
}
