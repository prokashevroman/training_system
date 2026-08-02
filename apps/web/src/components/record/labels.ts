/**
 * Display names for enum values.
 *
 * Only values whose humanized form would be wrong or ambiguous are listed;
 * everything else falls through to snake_case → Sentence case. Keeping the map
 * sparse means adding an enum value cannot leave a blank label behind.
 */
const OVERRIDES: Record<string, string> = {
  // Modality
  ski_erg: "Ski erg",
  mobility_recovery: "Mobility / recovery",
  walking_hiking: "Walking / hiking",
  sport_outdoor: "Outdoor sport",
  // Objective
  vo2max: "VO2max",
  tempo_threshold: "Tempo / threshold",
  // Set type
  warmup: "Warm-up",
  amrap: "AMRAP",
  // Load unit
  kg: "kg",
  lb: "lb",
  none: "no unit",
  // Load scope — worded as the athlete would read a set back, matching how
  // `formatLoad` prints it, so the choice and the printed result agree.
  total: "Total load",
  per_hand: "Each hand",
  per_side: "Each side",
  added_bodyweight: "Added to bodyweight",
  machine_setting: "Machine setting (no kg)",
};

export function enumLabel(value: string): string {
  const override = OVERRIDES[value];
  if (override) return override;
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
