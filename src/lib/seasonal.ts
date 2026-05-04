export type Season = "spring" | "summer" | "autumn" | "winter";

export const SEASON_LABELS: Record<Season, { name: string; range: string }> = {
  spring: { name: "Lente",  range: "maart–mei" },
  summer: { name: "Zomer",  range: "juni–augustus" },
  autumn: { name: "Herfst", range: "september–november" },
  winter: { name: "Winter", range: "december–februari" },
};

// 0-indexed month: Spring=2-4, Summer=5-7, Autumn=8-10, Winter=11/0/1
export function getCurrentSeason(): Season {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

export const SEASONAL_PRODUCE: Record<Season, string[]> = {
  spring: ["asperges","spinazie","sla","radijs","postelein","rucola","rabarber","nieuwe aardappelen","prei","koolrabi","broccoli","doperwten","tuinbonen"],
  summer: ["courgette","komkommer","tomaten","paprika","sperziebonen","bloemkool","mais","aubergine","venkel","aardbeien","frambozen","kersen","bessen"],
  autumn: ["pompoen","knolselderij","wortels","rode bieten","rode kool","savooiekool","spruitjes","paddenstoelen","witlof","appels","peren"],
  winter: ["spruitjes","boerenkool","pastinaak","witlof","prei","knolselderij","rode kool","uien","aardappelen"],
};

export function getSeasonalProduce(): { season: Season; produce: string[] } {
  const season = getCurrentSeason();
  return { season, produce: SEASONAL_PRODUCE[season] };
}
