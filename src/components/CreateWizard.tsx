"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import NumberStepper from "./ui/NumberStepper";
import Spinner from "./ui/Spinner";
import PreviousRecipePicker from "./PreviousRecipePicker";
import { LeftoverItem } from "@/lib/types";

function getISOWeekTitle() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const weekNum = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
  return `Week ${weekNum}, ${now.getFullYear()}`;
}

function getNextMondayTitle() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + daysUntilMonday);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Maandag ${monday.getDate()} ${months[monday.getMonth()]}`;
}

export default function CreateWizard() {
  const router = useRouter();
  const [defaultTitle, setDefaultTitle] = useState(getISOWeekTitle());
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [numNights, setNumNights] = useState(5);
  const [servings, setServings] = useState(4);
  const [style, setStyle] = useState("");
  const [budget, setBudget] = useState("");
  const [healthy, setHealthy] = useState("");
  const [leftovers, setLeftovers] = useState<LeftoverItem[]>([]);
  const [reusedIds, setReusedIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.default_num_nights) setNumNights(parseInt(data.default_num_nights) || 5);
        if (data.default_servings) setServings(parseInt(data.default_servings) || 4);
        if (data.week_title_format === "date") {
          setDefaultTitle(getNextMondayTitle());
        }
      })
      .catch(() => {});
  }, []);

  const toggleRecipe = (id: number) => {
    setReusedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || defaultTitle,
          num_nights: numNights,
          servings,
          preferences: {
            style: style || undefined,
            budget: budget || undefined,
            healthy: healthy || undefined,
            leftovers: leftovers.filter((l) => l.name.trim()) || undefined,
          },
          reused_recipe_ids: reusedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create week");
        setCreating(false);
        return;
      }
      router.push(`/week/${data.id}`);
    } catch {
      setError("Failed to create week");
      setCreating(false);
    }
  };

  if (creating) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Spinner size="lg" />
        <p className="text-gray-600">
          Generating recipes and matching products...
        </p>
        <p className="text-sm text-gray-400">This may take a minute</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">
        Create New Week
      </h1>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full transition-colors ${
              s <= step ? "bg-green-500" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Week Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultTitle}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <NumberStepper
            label="Number of Nights"
            value={numNights}
            onChange={setNumNights}
            min={1}
            max={7}
          />
          <NumberStepper
            label="Servings per Meal"
            value={servings}
            onChange={setServings}
            min={1}
            max={12}
          />
          <div className="flex justify-end">
            <Button onClick={() => setStep(2)}>Next</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cuisine Style
            </label>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="e.g. Italian, Asian, Mixed"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Budget
            </label>
            <select
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">Any</option>
              <option value="budget">Budget-friendly (~€2-3 p.p.)</option>
              <option value="moderate">Moderate (~€4-5 p.p.)</option>
              <option value="premium">Premium (~€6-8 p.p.)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Healthiness
            </label>
            <select
              value={healthy}
              onChange={(e) => setHealthy(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">Any</option>
              <option value="healthy">Healthy</option>
              <option value="balanced">Balanced</option>
              <option value="comfort">Comfort food</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Leftover Ingredients
            </label>
            <div className="space-y-2">
              {leftovers.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => {
                      const updated = [...leftovers];
                      updated[idx] = { ...item, name: e.target.value };
                      setLeftovers(updated);
                    }}
                    placeholder="e.g. courgette"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                  <input
                    type="number"
                    value={item.amount || ""}
                    onChange={(e) => {
                      const updated = [...leftovers];
                      updated[idx] = { ...item, amount: parseInt(e.target.value) || 0 };
                      setLeftovers(updated);
                    }}
                    placeholder="Amount"
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                  <select
                    value={item.unit}
                    onChange={(e) => {
                      const updated = [...leftovers];
                      updated[idx] = { ...item, unit: e.target.value as LeftoverItem["unit"] };
                      setLeftovers(updated);
                    }}
                    className="w-20 px-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="gr">gr</option>
                    <option value="ml">ml</option>
                    <option value="stuk">stuk</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setLeftovers(leftovers.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 p-1"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLeftovers([...leftovers, { name: "", amount: 0, unit: "gr" }])}
              className="mt-2 text-sm text-green-600 hover:text-green-700 font-medium"
            >
              + Add leftover
            </button>
            <p className="text-xs text-gray-400 mt-1">
              Ingredients you want to use up with approximate quantities
            </p>
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Next</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">
              Reuse Previous Recipes (optional)
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {reusedIds.length} of {numNights} selected &middot;{" "}
              {numNights - reusedIds.length} will be generated by AI
            </p>
            <PreviousRecipePicker
              selectedIds={reusedIds}
              onToggle={toggleRecipe}
              maxSelectable={numNights}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={handleCreate}>Create Week</Button>
          </div>
        </div>
      )}
    </div>
  );
}
