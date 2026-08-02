export * from "./enums.js";
export * from "./units.js";
export * from "./warnings.js";
export * from "./exercise.js";
export * from "./exercise-library.js";
export * from "./strength.js";
export * from "./cardio.js";
export * from "./circuit.js";
export * from "./benchmark.js";
export * from "./benchmark-library.js";
export * from "./activity.js";
export * from "./session.js";
export * from "./workbook.js";

// `sql-enums.ts` and `seed-sql.ts` are deliberately NOT re-exported here. They
// are build-time generators that import `node:url`, and this barrel is imported
// by the browser app — re-exporting them drags Node into the bundle and breaks
// the Vite build with "fileURLToPath is not exported by __vite-browser-external".
// The generator scripts and their drift tests import those modules by path.
