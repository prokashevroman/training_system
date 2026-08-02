import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural guard on the public barrel.
 *
 * `packages/domain` is imported by the browser app, so anything reachable from
 * `index.ts` must be bundleable. Re-exporting a module that imports `node:url`
 * broke the Vite build with a message that points at rollup internals rather
 * than at the real cause, so it is cheaper to catch here.
 *
 * The generators (`sql-enums.ts`, `seed-sql.ts`) legitimately use Node APIs —
 * they just must not be reachable from the barrel. Their scripts and drift
 * tests import them by path instead.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

function readSource(file: string): string {
  return readFileSync(`${SRC}${file}`, "utf8");
}

/** Modules the barrel re-exports, resolved to their source file names. */
function barrelModules(): string[] {
  return [...readSource("index.ts").matchAll(/export \* from "\.\/([\w-]+)\.js";/g)].map(
    (m) => `${m[1]}.ts`,
  );
}

describe("public barrel", () => {
  it("re-exports at least the core model modules", () => {
    const modules = barrelModules();
    for (const expected of ["enums.ts", "units.ts", "session.ts", "activity.ts", "warnings.ts"]) {
      expect(modules).toContain(expected);
    }
  });

  it("reaches no module that imports a Node built-in", () => {
    for (const file of barrelModules()) {
      const source = readSource(file);
      expect(source, `${file} is reachable from index.ts and imports a Node built-in`).not.toMatch(
        /from "node:/,
      );
    }
  });

  it("keeps the SQL generators out of the barrel", () => {
    const modules = barrelModules();
    expect(modules).not.toContain("sql-enums.ts");
    expect(modules).not.toContain("seed-sql.ts");
  });

  it("leaves no source module unexported by accident", () => {
    // Anything that is neither a test, a generator, nor the barrel itself
    // should be reachable — otherwise it is dead code or a missed export.
    const known = new Set([...barrelModules(), "index.ts", "sql-enums.ts", "seed-sql.ts"]);
    const orphans = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => !known.has(f));
    expect(orphans).toEqual([]);
  });
});
