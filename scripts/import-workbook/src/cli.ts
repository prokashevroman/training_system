import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCells,
  countRows,
  createServiceClient,
  validateCell,
  type ApplyConfig,
} from "./apply.js";
import { parseCell, PARSER_VERSION } from "./parse.js";
import { reconcile, renderReport, renderReviewQueue } from "./reconcile.js";
import { loadStagedCells } from "./staging.js";

/**
 * The importer CLI.
 *
 *   pnpm import:run -- <stage> [flags]
 *
 * Stages mirror the brief's pipeline: inspect | extract | preparse | parse |
 * validate | apply | reconcile. `inspect` and `extract` shell out to the
 * Python side, which owns xlsx reading; everything downstream is TypeScript
 * working from data/staging/cells.jsonl.
 *
 * Defaults are deliberately safe: --dry-run is on unless --local or --remote
 * is given, so no invocation writes to a database by accident.
 */

const IMPORTER_VERSION = "0.1.0";
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PKG = fileURLToPath(new URL("..", import.meta.url));

type Stage =
  "inspect" | "extract" | "preparse" | "parse" | "validate" | "apply" | "reconcile" | "counts";

const STAGES: Stage[] = [
  "inspect",
  "extract",
  "preparse",
  "parse",
  "validate",
  "apply",
  "reconcile",
  "counts",
];

interface Flags {
  stage: Stage;
  dryRun: boolean;
  remote: boolean;
  batchSize: number;
  fromEntry: string | null;
  ai: boolean;
}

function parseArgs(argv: string[]): Flags {
  // A bare `--` is pnpm's argument separator, not a flag and not a stage.
  const positional = argv.filter((a) => a !== "--" && !a.startsWith("--"));
  const has = (name: string) => argv.includes(`--${name}`);
  const value = (name: string): string | null => {
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
  };

  // `apply` is the default so the documented `pnpm import:run -- --local`
  // works: pnpm inserts a bare `--` separator, which leaves no positional
  // stage at all. With a `parse` default that invocation silently did nothing
  // but re-parse, and reported success.
  const stage = (positional[0] ?? "apply") as Stage;
  if (!STAGES.includes(stage)) {
    throw new Error(`Unknown stage "${stage}". Expected one of: ${STAGES.join(" | ")}`);
  }

  const remote = has("remote");
  const local = has("local");
  // Writing requires an explicit --local or --remote. Everything else is dry.
  const dryRun = has("dry-run") || (!local && !remote);

  if (has("ai")) {
    throw new Error(
      "--ai is reserved for Phase 4. The deterministic parser is the only parser wired up today; unparseable text is flagged for review rather than guessed at.",
    );
  }

  return {
    stage,
    dryRun,
    remote,
    batchSize: Number(value("batch-size") ?? 25),
    fromEntry: value("from-entry"),
    ai: false,
  };
}

function runPython(script: string): number {
  const result = spawnSync("uv", ["run", "--project", PKG, "python", `${PKG}/python/${script}`], {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Could not run uv — is it installed? ${result.error.message}`);
  }
  return result.status ?? 1;
}

function loadImportEnv(): { url: string; key: string; userId: string } {
  const envPath = `${PKG}/.env.import`;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] && !process.env[m[1]])
        process.env[m[1]] = m[2]!.trim().replace(/^["']|["']$/g, "");
    }
  }

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const userId = process.env.IMPORT_USER_ID ?? "";
  const missing = [
    !url && "SUPABASE_URL",
    !key && "SUPABASE_SERVICE_ROLE_KEY",
    !userId && "IMPORT_USER_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Copy scripts/import-workbook/.env.import.example to .env.import and fill it in (the values come from \`supabase status\`).`,
    );
  }
  return { url, key, userId };
}

/** The workbook actually in data/source — the same one the extractor read. */
function sourceWorkbookName(): string {
  const dir = `${ROOT}data/source`;
  const books = readdirSync(dir).filter((n) => n.endsWith(".xlsx") && !n.startsWith("~$"));
  if (books.length !== 1) {
    throw new Error(`Expected exactly one .xlsx in ${dir}, found ${books.length}.`);
  }
  return books[0]!;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  process.stdout.write(`Wrote ${path.replace(ROOT, "")}\n`);
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const log = (m: string) => process.stdout.write(`${m}\n`);

  switch (flags.stage) {
    case "inspect":
      return runPython("inspect_workbook.py");

    case "extract":
      return runPython("extract.py");

    case "preparse": {
      // Normalization and splitting only — proves the corpus regroups cleanly
      // without running any parser.
      const cells = loadStagedCells();
      let units = 0;
      for (const c of cells) {
        units += parseCell({
          sheet: c.sheet,
          row: c.row,
          col: c.col,
          localDate: c.local_date,
          rawText: c.raw_text,
        }).sessions.length;
      }
      log(`${cells.length} cells -> ${units} session units`);
      return 0;
    }

    case "parse":
    case "validate": {
      const cells = loadStagedCells();
      let failures = 0;
      let sessions = 0;
      for (const c of cells) {
        const result = parseCell({
          sheet: c.sheet,
          row: c.row,
          col: c.col,
          localDate: c.local_date,
          rawText: c.raw_text,
        });
        sessions += result.sessions.length;
        const validation = validateCell(result);
        if (!validation.ok) {
          failures += 1;
          for (const e of validation.errors) log(`  INVALID ${e}`);
        }
      }
      log(`${cells.length} cells -> ${sessions} sessions, ${failures} invalid`);
      return failures === 0 ? 0 : 1;
    }

    case "apply": {
      const cells = loadStagedCells();

      if (flags.dryRun) {
        const summary = await applyCells(
          cells,
          {
            supabaseUrl: "",
            serviceRoleKey: "",
            userId: "00000000-0000-0000-0000-000000000000",
            fileName: "",
            importerVersion: IMPORTER_VERSION,
            parserVersion: PARSER_VERSION,
            dryRun: true,
            batchSize: flags.batchSize,
            fromEntry: flags.fromEntry,
          },
          log,
        );
        log(
          `DRY RUN — nothing written. ${summary.cellsScanned} cells, ${summary.sessionsCreated} sessions, ${summary.entriesReviewRequired} need review, ${summary.entriesFailed} failed.`,
        );
        return summary.entriesFailed === 0 ? 0 : 1;
      }

      const env = loadImportEnv();
      if (flags.remote) {
        log("!! Applying to a REMOTE Supabase project with a service-role key.");
      }
      const config: ApplyConfig = {
        supabaseUrl: env.url,
        serviceRoleKey: env.key,
        userId: env.userId,
        fileName: sourceWorkbookName(),
        importerVersion: IMPORTER_VERSION,
        parserVersion: PARSER_VERSION,
        dryRun: false,
        batchSize: flags.batchSize,
        fromEntry: flags.fromEntry,
      };

      const summary = await applyCells(cells, config, log);
      log(
        `Applied ${summary.entriesApplied}/${summary.cellsScanned} cells, ${summary.sessionsCreated} sessions, ${summary.entriesFailed} failed.`,
      );
      const counts = await countRows(createServiceClient(config), env.userId);
      log(`Row counts: ${JSON.stringify(counts, null, 2)}`);
      return summary.entriesFailed === 0 ? 0 : 1;
    }

    case "counts": {
      const env = loadImportEnv();
      const client = createServiceClient({
        supabaseUrl: env.url,
        serviceRoleKey: env.key,
      } as ApplyConfig);
      log(JSON.stringify(await countRows(client, env.userId), null, 2));
      return 0;
    }

    case "reconcile": {
      const report = reconcile(loadStagedCells());
      write(`${ROOT}docs/reports/import-reconciliation.md`, renderReport(report));
      write(
        `${ROOT}docs/reports/review-queue.json`,
        `${JSON.stringify(renderReviewQueue(report), null, 2)}\n`,
      );
      const unconsumed = report.dispositions.unconsumed ?? 0;
      log(
        `${report.cellsDiscovered} cells, ${report.sessions} sessions, ${report.sourceLines} source lines, ${unconsumed} unconsumed, ${report.entriesNeedingReview} need review.`,
      );
      return 0;
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
