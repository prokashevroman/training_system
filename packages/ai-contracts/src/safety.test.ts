import { describe, expect, it } from "vitest";
import { SafetyFlagSchema, blocksHardSession, detectSafetyFlags } from "./safety.js";

describe("detectSafetyFlags", () => {
  it("returns nothing for ordinary training talk", () => {
    expect(detectSafetyFlags("Legs are sore but squats felt strong today")).toEqual([]);
  });

  it("flags chest pain and blocks a hard session", () => {
    const flags = detectSafetyFlags("Felt some chest pain during the last interval");
    expect(flags.map((f) => f.code)).toEqual(["chest_pain"]);
    expect(flags[0]?.sourceFragment).toBe("chest pain");
    expect(flags[0]?.message).not.toMatch(/diagnos/i);
    expect(blocksHardSession(flags)).toBe(true);
  });

  it("flags several distinct symptoms in a stable order", () => {
    const flags = detectSafetyFlags("I was dizzy and had a fever, plus a sprained ankle");
    expect(flags.map((f) => f.code)).toEqual(["dizziness", "fever_or_illness", "injury"]);
  });

  it("produces schema-valid flags", () => {
    for (const flag of detectSafetyFlags("shortness of breath and sharp pain")) {
      expect(() => SafetyFlagSchema.parse(flag)).not.toThrow();
    }
  });

  it("rejects a flag with an unknown code", () => {
    expect(() =>
      SafetyFlagSchema.parse({ code: "vibes_off", sourceFragment: "x", message: "y" }),
    ).toThrow();
  });

  it("does not block when no flag fired", () => {
    expect(blocksHardSession([])).toBe(false);
  });
});
