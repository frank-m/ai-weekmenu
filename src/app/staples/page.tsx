"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

export default function StaplesPage() {
  const [staples, setStaples] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  const fetchStaples = () => {
    fetch("/api/staples")
      .then((r) => r.json())
      .then((data) => {
        setStaples(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStaples();
  }, []);

  const handleAdd = async () => {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    await fetch("/api/staples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setNewName("");
    fetchStaples();
  };

  const handleRemove = async (name: string) => {
    await fetch("/api/staples", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    fetchStaples();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Staple Ingredients</h1>
        <Link
          href="/"
          className="text-sm text-gray-600 hover:text-gray-900 font-medium"
        >
          Back
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Staple ingredients are basic pantry items you always have at home. They
        are separated from recipe-specific ingredients when generating your
        weekly menu.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add a staple ingredient..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        <Button onClick={handleAdd} disabled={!newName.trim()}>
          Add
        </Button>
      </div>

      <div className="space-y-1">
        {staples.map((name) => (
          <div
            key={name}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50"
          >
            <span className="text-sm text-gray-900">{name}</span>
            <button
              onClick={() => handleRemove(name)}
              className="text-red-400 hover:text-red-600 p-1"
              title="Remove"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
