/**
 * Emits `supabase/seed.sql` from the exercise and benchmark libraries in
 * `src/exercise-library.ts` and `src/benchmark-library.ts`.
 *
 * The seed is generated rather than hand-written because the import parser
 * resolves aliases in TypeScript while the database stores the same aliases for
 * the UI. `exercise-library.test.ts` re-renders and diffs against the committed
 * file, so adding an exercise or alias without regenerating fails the test suite
 * rather than leaving the parser and the database disagreeing.
 *
 *   pnpm gen:seed-sql
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SEED_SQL_PATH, renderSeedSql } from "../src/seed-sql.js";

const sql = renderSeedSql();
mkdirSync(dirname(SEED_SQL_PATH), { recursive: true });
writeFileSync(SEED_SQL_PATH, sql, "utf8");

process.stdout.write(`Wrote ${SEED_SQL_PATH}\n`);
