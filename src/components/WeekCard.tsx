import Link from "next/link";
import Badge from "./ui/Badge";
import { Week } from "@/lib/types";

interface WeekCardProps {
  week: Week;
}

export default function WeekCard({ week }: WeekCardProps) {
  const date = new Date(week.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link href={`/week/${week.id}`}>
      <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md hover:border-green-200 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-gray-900 text-lg">{week.title}</h3>
          <span className="text-xs text-gray-500">{date}</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {week.num_nights} nights &middot; {week.servings} servings
        </p>
        <div className="flex flex-wrap gap-2">
          {week.preferences?.style && (
            <Badge color="blue">{week.preferences.style}</Badge>
          )}
          {week.preferences?.budget && (
            <Badge color="yellow">{week.preferences.budget}</Badge>
          )}
          {week.preferences?.healthy && (
            <Badge color="green">{week.preferences.healthy}</Badge>
          )}
        </div>
      </div>
    </Link>
  );
}
