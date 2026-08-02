import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LoadScopeEnum, ModalityEnum, SQL_ENUMS } from "./enums.js";
import { MIGRATION_0001_PATH, renderMigration0001 } from "./sql-enums.js";

describe("SQL enum generation", () => {
  /**
   * The drift guard. If this fails, run `pnpm gen:sql-enums` — an enum value
   * was added or renamed in TypeScript without regenerating the migration.
   */
  it("matches the committed migration 0001 byte for byte", () => {
    const committed = readFileSync(MIGRATION_0001_PATH, "utf8");
    expect(committed).toBe(renderMigration0001());
  });

  it("gives every enum a unique SQL type name", () => {
    const names = SQL_ENUMS.map((e) => e.sqlName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses snake_case identifiers Postgres will not need quoted", () => {
    for (const e of SQL_ENUMS) {
      expect(e.sqlName).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const v of e.values) expect(v).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("has no duplicate values within an enum", () => {
    for (const e of SQL_ENUMS) {
      expect(new Set(e.values).size, `${e.sqlName} has duplicate values`).toBe(e.values.length);
    }
  });
});

describe("load scope", () => {
  /**
   * These five are the distinctions the corpus actually makes. Losing any of
   * them turns a machine pin setting or a per-hand dumbbell weight into a
   * bogus barbell load in every strength trend.
   */
  it("keeps the scopes the source workbook distinguishes", () => {
    expect(LoadScopeEnum.values).toContain("total");
    expect(LoadScopeEnum.values).toContain("per_hand");
    expect(LoadScopeEnum.values).toContain("added_bodyweight");
    expect(LoadScopeEnum.values).toContain("machine_setting");
    expect(LoadScopeEnum.values).toContain("unknown");
  });
});

describe("modality", () => {
  it("covers every modality observed in the workbook", () => {
    // surfing/kayaking -> sport_outdoor, air bike -> cycling, ski machine -> ski_erg
    for (const m of [
      "strength",
      "running",
      "cycling",
      "rowing",
      "ski_erg",
      "swimming",
      "hybrid_conditioning",
      "mobility_recovery",
      "walking_hiking",
      "sport_outdoor",
      "dance",
    ]) {
      expect(ModalityEnum.values).toContain(m);
    }
  });

  it("rejects an unknown modality at the schema boundary", () => {
    expect(ModalityEnum.schema.safeParse("crossfit").success).toBe(false);
  });
});
