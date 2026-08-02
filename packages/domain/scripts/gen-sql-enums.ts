/**
 * Emits `supabase/migrations/0001_extensions_and_enums.sql` from the Zod enums
 * in `src/enums.ts`.
 *
 * The migration is generated rather than hand-written so the database and the
 * application cannot drift. `enums.test.ts` re-renders and diffs against the
 * committed file, so adding an enum value without regenerating fails the test
 * suite rather than failing at 3am against production data.
 *
 *   pnpm gen:sql-enums
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATION_0001_PATH, renderMigration0001 } from "../src/sql-enums.js";

const sql = renderMigration0001();
mkdirSync(dirname(MIGRATION_0001_PATH), { recursive: true });
writeFileSync(MIGRATION_0001_PATH, sql, "utf8");

process.stdout.write(`Wrote ${MIGRATION_0001_PATH}\n`);
