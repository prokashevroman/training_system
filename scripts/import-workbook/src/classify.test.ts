import { describe, expect, it } from "vitest";
import { classifyLine } from "./classify.js";

/**
 * Each case names the matcher it must hit, so a regression points at one rule
 * rather than at "the classifier". Every line is real workbook text.
 */
describe("ordered matcher list", () => {
  it.each([
    ["Bike to & from work", "commute", "commute.bike-to"],
    ["Bike to & from AH XL", "commute", "commute.bike-to"],
    ["Biking to work, etc. (Total 1 hour 20 minutes)", "commute", "commute.bike-to"],
    ["(+ extra biking)", "commute", "commute.extra-biking"],
    ["Murph preperation (vest 9 kg):", "benchmark", "benchmark.murph"],
    ["Full Murph (vest, total time - 58:52)", "benchmark", "benchmark.murph"],
    ["Half murph (21:13):", "benchmark", "benchmark.murph"],
    ["60% murph (23:11):", "benchmark", "benchmark.murph"],
    ["Cindy 11 rounds:", "benchmark", "benchmark.cindy"],
    ["12 rounds cindy bodyweight:", "benchmark", "benchmark.cindy"],
    ["4 rounds:", "circuit", "circuit.n-rounds-leading"],
    ["8 rounds: 50 jumping jacks & 10 push ups", "circuit", "circuit.n-rounds-leading"],
    ["5 strict pull-ups, 10 push ups (5 rounds)", "circuit", "circuit.n-rounds-parenthetical"],
    ["150 push-ups (15 EMOM)", "circuit", "circuit.emom"],
    ["Back squat 5x5: 1x80, 3x85, 1x90", "strength", "strength.set-notation"],
    ["Back squat, 4 sets: 80kg x6", "strength", "strength.sets-notation"],
    ["Bent over barbell row 5x10 (38 kg)", "strength", "strength.qualified-row"],
    ["Seated cable row, 3x10 (35kg)", "strength", "strength.qualified-row"],
    ["120 push-ups (10 kg)", "strength", "strength.movement-keyword"],
    ["11 strict pull ups", "strength", "strength.movement-keyword"],
    ["Sled push (75 kg approx)", "strength", "strength.movement-keyword"],
    ["Row machine: 1000m, 4:31, 2:14.9/500m", "rowing", "rowing.machine"],
    ["10 kkal row", "rowing", "rowing.machine"],
    ["10 minutes rowing on 7, 120 kkal total", "rowing", "rowing.machine"],
    ["Ski machine, 1000m, pace 1:54", "ski_erg", "ski.erg"],
    ["Swimming training", "swimming", "swimming"],
    ["First 12.5 meters front crawl", "swimming", "swimming"],
    ["10 km outdoor run", "running", "running"],
    ["Treadmil - 50 min (3.54 km)", "running", "running"],
    ["Beach run - 4km", "running", "running"],
    ["walking treadmill 4.5 km", "walking", "walking.hiking"],
    ["Treadmill walk 70 minutes (was sick first half of the week)", "walking", "walking.hiking"],
    ["19+K steps walking (14km)", "walking", "walking.hiking"],
    ["Hiking uphill - 8km", "walking", "walking.hiking"],
    ["45 minutes VO2 cardio (Air bike)", "cycling", "cycling"],
    ["easy bike ride", "cycling", "cycling"],
    ["Rolling and stretching legs (49 minutes)", "mobility", "mobility"],
    ["Massage 1.5 hours", "mobility", "mobility"],
    ["Surfing training (2 hours)", "sport", "sport.outdoor"],
    ["light kayaking", "sport", "sport.outdoor"],
    ["Dance training with a lot of lifts", "dance", "dance"],
    ["cadencia - 159", "metric", "metric.spanish-cadence"],
    ["fc promedio - 152lpm", "metric", "metric.spanish-heart-rate"],
    ["Frec. cardiaca - 148", "metric", "metric.spanish-heart-rate"],
    ["6:49 per km", "metric", "metric.bare-pace"],
    ["6:53", "metric", "metric.bare-pace"],
    ["1142m - altitude gain", "metric", "metric.elevation"],
    ["Total time: 38:11", "metric", "metric.total-time"],
    ["Fast intervals pace: 4:52 - 4:32", "metric", "metric.interval-pace-list"],
    ["2.76 miles, 30:26 (6:51 per km, Apple watch showed much slower)", "running", "running.miles"],
    ["quality of some squats wasn't deep enough", "note", "note.prose"],
    ["Heart rate went up in the beginning because was nervous", "note", "note.prose"],
    ["Warm-up", "note", "fallback.note"],
  ])("classifies %o as %s via %s", (line, kind, matcher) => {
    const c = classifyLine(line);
    expect({ kind: c.kind, matcher: c.matcher }).toEqual({ kind, matcher });
  });
});

describe("order-dependent disambiguations", () => {
  /**
   * These four pairs are the reason the list is ordered. Each pair would
   * collapse to the wrong answer if the matchers were reordered.
   */
  it("prefers commute over cycling for a bike commute", () => {
    expect(classifyLine("Bike to & from work").kind).toBe("commute");
    expect(classifyLine("Bike 1 hour total").kind).toBe("cycling");
  });

  it("prefers benchmark over circuit for a named workout", () => {
    expect(classifyLine("12 rounds cindy bodyweight:").kind).toBe("benchmark");
    expect(classifyLine("12 rounds:").kind).toBe("circuit");
  });

  it("prefers walking over running when a treadmill is walked on", () => {
    expect(classifyLine("walking treadmill 4.5 km").kind).toBe("walking");
    expect(classifyLine("Treadmill easy run 6 km, speed = 7.0").kind).toBe("running");
  });

  it("distinguishes a barbell row from a rowing machine", () => {
    expect(classifyLine("Bent over barbell row 5x10 (38 kg)").kind).toBe("strength");
    expect(classifyLine("Rowing machine 15 minutes").kind).toBe("rowing");
  });

  /**
   * R22C6 ends a stretching line with "...after half Murph if done
   * consistently". An unanchored /murph/ turns recovery work into a benchmark.
   */
  it("ignores a Murph mentioned mid-sentence", () => {
    const line =
      "Rolling and stretching shoulder and lads 20 minutes total (noticeably helps recovery after half Murph if done consistently)";
    expect(classifyLine(line).kind).toBe("mobility");
  });
});

describe("objective inference", () => {
  it.each([
    ["Bike to & from work", "commute"],
    ["Rolling and stretching legs (49 minutes)", "recovery"],
    ["45 minutes VO2 cardio (Air bike)", "vo2max"],
    ["Norwegian VO2 max running training:", "vo2max"],
    ["Easy run: 3.35 km, zone 2, less than 7 min per km", "aerobic_base"],
    ["Back squat 5x5: 1x80", "max_strength"],
    ["Murph preperation (vest 9 kg):", "race_specific"],
  ])("infers %o -> %s", (line, objective) => {
    expect(classifyLine(line).objective).toBe(objective);
  });
});

describe("edge cases", () => {
  it("returns a zero-confidence unknown for an empty line", () => {
    expect(classifyLine("   ")).toMatchObject({ kind: "unknown", confidence: 0 });
  });

  it("maps every session-carrying kind to a modality", () => {
    for (const line of ["Swimming training", "10 km outdoor run", "Bike to & from work"]) {
      expect(classifyLine(line).modality).not.toBeNull();
    }
  });

  it("gives metric and note lines no modality, so they cannot start a session", () => {
    expect(classifyLine("cadencia - 159").modality).toBeNull();
    expect(classifyLine("Warm-up").modality).toBeNull();
  });
});
