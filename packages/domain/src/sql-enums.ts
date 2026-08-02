import { fileURLToPath } from "node:url";
import { renderEnumDdl } from "./enums.js";

/** Absolute path to the generated migration, resolved from this file. */
export const MIGRATION_0001_PATH = fileURLToPath(
  new URL("../../../supabase/migrations/0001_extensions_and_enums.sql", import.meta.url),
);

/**
 * The complete text of migration 0001. Kept next to the enums so the generator
 * script and the drift test render byte-identical output.
 */
export function renderMigration0001(): string {
  return `-- 0001_extensions_and_enums.sql
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: pnpm gen:sql-enums
--
-- Source of truth: packages/domain/src/enums.ts
-- packages/domain/src/enums.test.ts fails if this file drifts from it.
--
-- Closed vocabularies are native Postgres enums. Open, user-extensible
-- vocabularies (exercises, aliases, tags, benchmark definitions) are reference
-- tables instead — see migrations 0003 and 0006.

create extension if not exists "pgcrypto";

${renderEnumDdl()}`;
}
