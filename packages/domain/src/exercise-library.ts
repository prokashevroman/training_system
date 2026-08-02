import type { MovementPattern } from "./enums.js";
import type { Exercise, ExerciseAlias } from "./exercise.js";

/**
 * The canonical exercise vocabulary, defined once in TypeScript.
 *
 * `supabase/seed.sql` is GENERATED from this file (`pnpm gen:seed-sql`) because
 * the import parser resolves aliases in TypeScript while the database stores the
 * same aliases for the UI. Two hand-maintained copies would drift immediately;
 * `exercise-library.test.ts` diffs the committed seed against the renderer.
 *
 * APPARATUS IS NOT AN EXERCISE. The workbook writes `5 pull ups on climbers
 * bar`, `5 pull ups on pull up station hotel`, `Deadlift with Hex bar`,
 * `15 kkal bike (rogue)`. Those all resolve to the same canonical movement; the
 * hardware goes into {@link ExerciseRef.apparatus} (see {@link APPARATUS_ALIASES})
 * so that trends can be split by apparatus later without inventing a slug per
 * piece of gym furniture. Only genuinely different movements get their own row —
 * strict vs kipping vs wide-grip vs weighted pull-up are different movements;
 * `pull-up-on-climbers-bar` is not.
 */

interface ExerciseSeed {
  slug: string;
  name: string;
  pattern: MovementPattern;
  primary?: readonly string[];
  secondary?: readonly string[];
  equipment?: readonly string[];
  unilateral?: boolean;
  bodyweight?: boolean;
}

function ex(seed: ExerciseSeed): Exercise {
  return {
    slug: seed.slug,
    name: seed.name,
    movementPattern: seed.pattern,
    primaryMuscles: [...(seed.primary ?? [])],
    secondaryMuscles: [...(seed.secondary ?? [])],
    equipment: [...(seed.equipment ?? [])],
    isUnilateral: seed.unilateral ?? false,
    isBodyweight: seed.bodyweight ?? false,
    isActive: true,
  };
}

/** Canonical exercises. Order is the seed insert order; keep it stable. */
export const EXERCISES: readonly Exercise[] = [
  // --- Squat and knee-dominant ---------------------------------------------
  ex({
    slug: "back-squat",
    name: "Back squat",
    pattern: "squat",
    primary: ["quadriceps", "glutes"],
    secondary: ["spinal erectors", "adductors", "core"],
    equipment: ["barbell", "squat rack"],
  }),
  ex({
    slug: "front-squat",
    name: "Front squat",
    pattern: "squat",
    primary: ["quadriceps", "glutes"],
    secondary: ["upper back", "core"],
    equipment: ["barbell", "dumbbell"],
  }),
  ex({
    slug: "air-squat",
    name: "Air squat",
    pattern: "squat",
    primary: ["quadriceps", "glutes"],
    secondary: ["calves", "core"],
    bodyweight: true,
  }),
  ex({
    slug: "goblet-squats",
    name: "Goblet squats",
    pattern: "squat",
    primary: ["quadriceps", "glutes"],
    secondary: ["core"],
    equipment: ["dumbbell", "kettlebell"],
  }),
  ex({
    slug: "sumo-squats",
    name: "Sumo squats",
    pattern: "squat",
    primary: ["quadriceps", "adductors"],
    secondary: ["glutes"],
    bodyweight: true,
  }),
  ex({
    slug: "wall-sit",
    name: "Wall sit (hold)",
    pattern: "squat",
    primary: ["quadriceps"],
    secondary: ["glutes"],
    equipment: ["wall"],
    bodyweight: true,
  }),
  ex({
    slug: "jump-squats",
    name: "Jump squats",
    pattern: "power",
    primary: ["quadriceps", "glutes"],
    secondary: ["calves"],
    bodyweight: true,
  }),
  ex({
    slug: "bulgarian-split-squats",
    name: "Bulgarian split squats",
    pattern: "unilateral_leg",
    primary: ["quadriceps", "glutes"],
    secondary: ["adductors", "core"],
    equipment: ["dumbbell", "bench"],
    unilateral: true,
  }),
  ex({
    slug: "step-ups",
    name: "Step-ups",
    pattern: "unilateral_leg",
    primary: ["quadriceps", "glutes"],
    secondary: ["calves", "core"],
    equipment: ["box", "dumbbell"],
    unilateral: true,
  }),
  ex({
    slug: "forward-lunges",
    name: "Forward lunges",
    pattern: "unilateral_leg",
    primary: ["quadriceps", "glutes"],
    secondary: ["hamstrings"],
    equipment: ["dumbbell"],
    unilateral: true,
    bodyweight: true,
  }),
  ex({
    slug: "lateral-lunges",
    name: "Lateral lunges",
    pattern: "unilateral_leg",
    primary: ["adductors", "glutes"],
    secondary: ["quadriceps"],
    unilateral: true,
    bodyweight: true,
  }),

  // --- Hinge ----------------------------------------------------------------
  ex({
    slug: "deadlift",
    name: "Deadlift",
    pattern: "hinge",
    primary: ["hamstrings", "glutes", "spinal erectors"],
    secondary: ["lats", "traps", "forearms"],
    // Barbell, hex bar and dumbbell loading are apparatus, not new exercises.
    equipment: ["barbell", "hex bar", "dumbbell"],
  }),
  ex({
    slug: "romanian-deadlift",
    name: "Romanian deadlift",
    pattern: "hinge",
    primary: ["hamstrings", "glutes"],
    secondary: ["spinal erectors", "lats"],
    equipment: ["barbell", "dumbbell"],
  }),
  ex({
    slug: "single-leg-rdl",
    name: "Single-leg RDL",
    pattern: "hinge",
    primary: ["hamstrings", "glutes"],
    secondary: ["core"],
    equipment: ["dumbbell"],
    unilateral: true,
  }),
  ex({
    slug: "hip-thrusts",
    name: "Hip thrusts (floor)",
    pattern: "hinge",
    primary: ["glutes"],
    secondary: ["hamstrings"],
    equipment: ["mat"],
    bodyweight: true,
  }),
  ex({
    slug: "cable-leg-curl",
    name: "Cable leg curl",
    pattern: "hinge",
    primary: ["hamstrings"],
    secondary: ["calves"],
    equipment: ["cable machine"],
    unilateral: true,
  }),
  ex({
    slug: "kb-swings",
    name: "Dumbbell/kettlebell swings",
    pattern: "power",
    primary: ["glutes", "hamstrings"],
    secondary: ["shoulders", "core"],
    equipment: ["dumbbell", "kettlebell"],
  }),

  // --- Horizontal push ------------------------------------------------------
  ex({
    slug: "bench-press",
    name: "Bench press",
    pattern: "horizontal_push",
    primary: ["chest"],
    secondary: ["triceps", "front delts"],
    equipment: ["barbell", "bench"],
  }),
  ex({
    slug: "incline-dumbbell-press",
    name: "Incline dumbbell press",
    pattern: "horizontal_push",
    primary: ["chest"],
    secondary: ["front delts", "triceps"],
    equipment: ["dumbbell", "bench"],
  }),
  ex({
    slug: "floor-press",
    name: "DB/KB floor press",
    pattern: "horizontal_push",
    primary: ["chest", "triceps"],
    secondary: ["front delts"],
    equipment: ["dumbbell", "kettlebell", "mat"],
  }),
  ex({
    slug: "push-ups",
    name: "Push-ups",
    pattern: "horizontal_push",
    primary: ["chest", "triceps"],
    secondary: ["front delts", "core"],
    bodyweight: true,
  }),
  ex({
    slug: "parallette-push-ups",
    name: "Parallette push-ups",
    pattern: "horizontal_push",
    primary: ["chest", "triceps"],
    secondary: ["front delts", "core"],
    equipment: ["parallettes"],
    bodyweight: true,
  }),
  ex({
    slug: "dips",
    name: "Dips",
    pattern: "vertical_push",
    primary: ["chest", "triceps"],
    secondary: ["front delts"],
    equipment: ["parallel bars"],
    bodyweight: true,
  }),

  // --- Horizontal pull ------------------------------------------------------
  ex({
    slug: "bent-over-rows",
    name: "Bent-over row",
    pattern: "horizontal_pull",
    primary: ["lats", "rhomboids"],
    secondary: ["biceps", "spinal erectors"],
    equipment: ["barbell", "dumbbell"],
  }),
  ex({
    slug: "chest-supported-row",
    name: "Chest-supported row",
    pattern: "horizontal_pull",
    primary: ["lats", "rhomboids"],
    secondary: ["biceps", "rear delts"],
    equipment: ["dumbbell", "bench"],
  }),
  ex({
    slug: "seated-cable-row",
    name: "Seated cable row",
    pattern: "horizontal_pull",
    primary: ["lats", "rhomboids"],
    secondary: ["biceps", "rear delts"],
    equipment: ["cable machine"],
  }),
  ex({
    slug: "single-arm-row",
    name: "Single-arm supported row",
    pattern: "horizontal_pull",
    primary: ["lats"],
    secondary: ["biceps", "rear delts"],
    equipment: ["dumbbell", "bench"],
    unilateral: true,
  }),
  ex({
    slug: "renegade-rows",
    name: "Renegade rows",
    pattern: "horizontal_pull",
    primary: ["lats"],
    secondary: ["core", "biceps"],
    equipment: ["dumbbell"],
    unilateral: true,
  }),
  ex({
    slug: "reverse-fly",
    name: "Reverse fly",
    pattern: "horizontal_pull",
    primary: ["rear delts"],
    secondary: ["rhomboids", "traps"],
    equipment: ["dumbbell"],
  }),
  ex({
    slug: "cable-rear-delt-fly",
    name: "Single-arm cable rear-delt fly",
    pattern: "horizontal_pull",
    primary: ["rear delts"],
    secondary: ["rhomboids"],
    equipment: ["cable machine"],
    unilateral: true,
  }),

  // --- Vertical pull --------------------------------------------------------
  ex({
    slug: "pull-ups",
    name: "Pull-ups",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["biceps", "forearms", "core"],
    equipment: ["pull-up bar"],
    bodyweight: true,
  }),
  ex({
    slug: "pull-ups-strict",
    name: "Strict pull-ups",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["biceps", "forearms"],
    equipment: ["pull-up bar"],
    bodyweight: true,
  }),
  ex({
    slug: "pull-ups-kipping",
    name: "Kipping pull-ups",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["core", "hip flexors", "shoulders"],
    equipment: ["pull-up bar"],
    bodyweight: true,
  }),
  ex({
    slug: "pull-ups-wide-grip",
    name: "Wide-grip pull-ups",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["rhomboids", "biceps"],
    equipment: ["pull-up bar"],
    bodyweight: true,
  }),
  ex({
    slug: "pull-ups-weighted",
    name: "Weighted strict pull-ups",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["biceps", "forearms"],
    equipment: ["pull-up bar", "weight vest", "dip belt"],
  }),
  ex({
    slug: "muscle-up",
    name: "Muscle-up",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["triceps", "chest", "core"],
    equipment: ["pull-up bar", "rings"],
    bodyweight: true,
  }),
  ex({
    slug: "lat-pulldown",
    name: "Lat pulldown",
    pattern: "vertical_pull",
    primary: ["lats"],
    secondary: ["biceps", "rhomboids"],
    equipment: ["cable machine"],
  }),
  ex({
    slug: "dead-hang",
    name: "Dead hang",
    pattern: "vertical_pull",
    primary: ["forearms"],
    secondary: ["lats", "shoulders"],
    equipment: ["pull-up bar"],
    bodyweight: true,
  }),
  ex({
    slug: "cable-biceps-curl",
    name: "Cable biceps curl",
    pattern: "vertical_pull",
    primary: ["biceps"],
    secondary: ["forearms"],
    equipment: ["cable machine"],
  }),
  ex({
    slug: "hammer-curls",
    name: "DB/KB hammer curls",
    pattern: "vertical_pull",
    primary: ["biceps"],
    secondary: ["forearms"],
    equipment: ["dumbbell", "kettlebell"],
  }),

  // --- Vertical push --------------------------------------------------------
  ex({
    slug: "overhead-press",
    name: "DB/KB overhead press",
    pattern: "vertical_push",
    primary: ["shoulders"],
    secondary: ["triceps", "core"],
    equipment: ["dumbbell", "kettlebell", "bench"],
  }),
  ex({
    slug: "cable-lateral-raise",
    name: "Single-arm cable lateral raise",
    pattern: "vertical_push",
    primary: ["side delts"],
    secondary: ["traps"],
    equipment: ["cable machine"],
    unilateral: true,
  }),
  ex({
    slug: "rope-triceps-pressdown",
    name: "Rope triceps pressdown",
    pattern: "vertical_push",
    primary: ["triceps"],
    secondary: ["forearms"],
    equipment: ["cable machine"],
  }),
  ex({
    slug: "skull-crusher",
    name: "Two-handed skull crusher",
    pattern: "vertical_push",
    primary: ["triceps"],
    secondary: ["front delts"],
    equipment: ["dumbbell", "mat"],
  }),
  ex({
    slug: "clean-and-press",
    name: "DB/KB clean and press",
    pattern: "power",
    primary: ["shoulders", "glutes"],
    secondary: ["quadriceps", "triceps"],
    equipment: ["dumbbell", "kettlebell"],
  }),
  ex({
    slug: "windmills",
    name: "DB/KB windmills",
    pattern: "mobility",
    primary: ["obliques", "shoulders"],
    secondary: ["hamstrings"],
    equipment: ["dumbbell", "kettlebell"],
    unilateral: true,
  }),

  // --- Power and conditioning movements ------------------------------------
  ex({
    slug: "thrusters",
    name: "Thrusters",
    pattern: "power",
    primary: ["quadriceps", "shoulders"],
    secondary: ["glutes", "triceps"],
    equipment: ["dumbbell", "barbell"],
  }),
  ex({
    slug: "burpees",
    name: "Burpee variations",
    pattern: "power",
    primary: ["chest", "quadriceps"],
    secondary: ["core", "shoulders"],
    bodyweight: true,
  }),
  ex({
    slug: "devil-press",
    name: "Devil press",
    pattern: "power",
    primary: ["shoulders", "hamstrings"],
    secondary: ["chest", "glutes"],
    equipment: ["dumbbell"],
  }),
  ex({
    slug: "wall-ball",
    name: "Wall ball shots",
    pattern: "power",
    primary: ["quadriceps", "shoulders"],
    secondary: ["glutes", "chest"],
    equipment: ["wall ball", "wall"],
  }),
  ex({
    slug: "man-makers",
    name: "Man makers",
    pattern: "power",
    primary: ["chest", "shoulders"],
    secondary: ["core", "quadriceps"],
    equipment: ["dumbbell"],
  }),
  ex({
    slug: "jumping-jacks",
    name: "Jumping jacks",
    pattern: "locomotion",
    primary: ["calves", "shoulders"],
    secondary: ["quadriceps"],
    bodyweight: true,
  }),
  ex({
    slug: "high-knees",
    name: "High knees",
    pattern: "locomotion",
    primary: ["hip flexors", "calves"],
    secondary: ["quadriceps"],
    bodyweight: true,
  }),
  ex({
    slug: "rope-jumps",
    name: "Rope jumps",
    pattern: "locomotion",
    primary: ["calves"],
    secondary: ["shoulders"],
    equipment: ["jump rope"],
    bodyweight: true,
  }),

  // --- Carry ----------------------------------------------------------------
  ex({
    slug: "farmer-carry",
    name: "Farmer carry",
    pattern: "carry",
    primary: ["forearms", "traps"],
    secondary: ["core", "glutes"],
    equipment: ["dumbbell", "kettlebell"],
  }),
  ex({
    slug: "overhead-carry",
    name: "Overhead carry (hold)",
    pattern: "carry",
    primary: ["shoulders"],
    secondary: ["core", "traps"],
    equipment: ["dumbbell", "kettlebell"],
  }),
  ex({
    slug: "sled-push",
    name: "Sled push",
    pattern: "carry",
    primary: ["quadriceps", "glutes"],
    secondary: ["calves", "core"],
    equipment: ["sled"],
  }),

  // --- Core -----------------------------------------------------------------
  ex({
    slug: "plank",
    name: "Plank",
    pattern: "core",
    primary: ["abs"],
    secondary: ["shoulders", "glutes"],
    bodyweight: true,
  }),
  ex({
    slug: "shoulder-taps",
    name: "Shoulder taps (plank)",
    pattern: "core",
    primary: ["abs", "shoulders"],
    secondary: ["chest"],
    bodyweight: true,
  }),
  ex({
    slug: "russian-twists",
    name: "Russian twists",
    pattern: "core",
    primary: ["obliques"],
    secondary: ["abs", "hip flexors"],
    equipment: ["dumbbell"],
    bodyweight: true,
  }),
  ex({
    slug: "kneeling-cable-crunch",
    name: "Kneeling cable crunch",
    pattern: "core",
    primary: ["abs"],
    secondary: ["obliques"],
    equipment: ["cable machine"],
  }),
  ex({
    slug: "core-abs",
    name: "Core ABS",
    pattern: "core",
    primary: ["abs"],
    secondary: ["obliques", "hip flexors"],
    bodyweight: true,
  }),
  ex({
    slug: "superman",
    name: "Superman",
    pattern: "core",
    primary: ["spinal erectors", "glutes"],
    secondary: ["shoulders"],
    bodyweight: true,
  }),

  // --- Locomotion and machines ---------------------------------------------
  ex({
    slug: "outdoor-run",
    name: "Outdoor run",
    pattern: "locomotion",
    primary: ["quadriceps", "hamstrings", "calves"],
    secondary: ["glutes", "core"],
    bodyweight: true,
  }),
  ex({
    slug: "treadmill-run",
    name: "Treadmill run",
    pattern: "locomotion",
    primary: ["quadriceps", "hamstrings", "calves"],
    secondary: ["glutes", "core"],
    equipment: ["treadmill"],
    bodyweight: true,
  }),
  ex({
    slug: "treadmill-walk",
    name: "Treadmill walk",
    pattern: "locomotion",
    primary: ["calves", "glutes"],
    secondary: ["quadriceps"],
    equipment: ["treadmill"],
    bodyweight: true,
  }),
  ex({
    slug: "walk",
    name: "Walk",
    pattern: "locomotion",
    primary: ["calves", "glutes"],
    secondary: ["quadriceps"],
    bodyweight: true,
  }),
  ex({
    slug: "hike",
    name: "Hike",
    pattern: "locomotion",
    primary: ["quadriceps", "glutes", "calves"],
    secondary: ["core"],
    bodyweight: true,
  }),
  ex({
    slug: "bike-ride",
    name: "Bike ride",
    pattern: "locomotion",
    primary: ["quadriceps", "glutes"],
    secondary: ["hamstrings", "calves"],
    equipment: ["bicycle"],
  }),
  ex({
    slug: "air-bike",
    name: "Air bike",
    pattern: "locomotion",
    primary: ["quadriceps", "shoulders"],
    secondary: ["glutes", "lats"],
    equipment: ["air bike"],
  }),
  ex({
    slug: "row-erg",
    name: "Rowing machine",
    pattern: "locomotion",
    primary: ["lats", "quadriceps"],
    secondary: ["hamstrings", "biceps", "core"],
    equipment: ["rowing machine"],
  }),
  ex({
    slug: "ski-erg",
    name: "Ski machine",
    pattern: "locomotion",
    primary: ["lats", "triceps"],
    secondary: ["core", "quadriceps"],
    equipment: ["ski erg"],
  }),
  ex({
    slug: "swim",
    name: "Swimming",
    pattern: "locomotion",
    primary: ["lats", "shoulders"],
    secondary: ["core", "quadriceps"],
    bodyweight: true,
  }),
  ex({
    slug: "surfing",
    name: "Surfing",
    pattern: "locomotion",
    primary: ["shoulders", "lats"],
    secondary: ["core", "quadriceps"],
    equipment: ["surfboard"],
  }),
  ex({
    slug: "kayaking",
    name: "Kayaking",
    pattern: "locomotion",
    primary: ["lats", "shoulders"],
    secondary: ["core", "biceps"],
    equipment: ["kayak"],
  }),
  ex({
    slug: "dance",
    name: "Dance training",
    pattern: "locomotion",
    primary: ["quadriceps", "calves"],
    secondary: ["core", "shoulders"],
    bodyweight: true,
  }),

  // --- Mobility and recovery ------------------------------------------------
  ex({
    slug: "stretching",
    name: "Stretching",
    pattern: "mobility",
    equipment: ["mat"],
    bodyweight: true,
  }),
  ex({
    slug: "foam-rolling",
    name: "Foam rolling",
    pattern: "mobility",
    equipment: ["foam roller"],
    bodyweight: true,
  }),
  ex({
    slug: "joint-mobility",
    name: "Joint mobility",
    pattern: "mobility",
    bodyweight: true,
  }),
  ex({
    // The workbook rolls and stretches `shoulder and lads` after every Murph
    // block. `lads` is a consistent misspelling of LATS, and it is a body area,
    // so it resolves here rather than to a lat *training* movement.
    slug: "lat-stretch",
    name: "Lat stretch and release",
    pattern: "mobility",
    primary: ["lats"],
    secondary: ["shoulders"],
    equipment: ["foam roller"],
    bodyweight: true,
  }),
  ex({
    slug: "massage",
    name: "Massage",
    pattern: "mobility",
  }),
] as const;

// --- Aliases ----------------------------------------------------------------

interface AliasSeed {
  slug: string;
  /** Ordinary English variants observed in the workbook. */
  en?: readonly string[];
  /** Language-neutral shorthand: `DL`, `RDL`, `MU`. */
  abbr?: readonly string[];
  /** Known misspellings. Resolved by the parser, never suggested by the UI. */
  misspellings?: readonly string[];
}

/**
 * Every alias below is text that actually appears in the source workbook, or a
 * near-variant the voice/manual entry paths will produce. Aliases must be
 * unique after lowercasing (migration 0003 enforces this with a unique index on
 * `lower(alias)`), so ambiguous bare words are deliberately left out: `bike`
 * means the air bike in `VO2 cardio (Bike)` and a commute in `Bike to & from
 * work`, so only the qualified forms are registered.
 */
const ALIAS_SEEDS: readonly AliasSeed[] = [
  { slug: "back-squat", en: ["back squat", "back squats"] },
  { slug: "front-squat", en: ["front squat", "front squats"] },
  {
    slug: "air-squat",
    en: ["air squats", "air squat", "squats", "squat", "bodyweight squats", "weighted squats"],
  },
  { slug: "goblet-squats", en: ["goblet squats", "goblet squat"] },
  { slug: "sumo-squats", en: ["sumo squats", "sumo squat"] },
  { slug: "wall-sit", en: ["wall sit", "wall sits"] },
  { slug: "jump-squats", en: ["jump squats", "jump squat", "squat jumps"] },
  {
    slug: "bulgarian-split-squats",
    en: ["bulgarian split squat", "bulgarian split squats", "split squat"],
  },
  { slug: "step-ups", en: ["box step-ups", "box step ups", "step-ups", "step ups", "step up"] },
  {
    slug: "forward-lunges",
    en: ["forward lunges", "forward lunge", "lunges", "lunge", "lunges with dumbbells"],
  },
  { slug: "lateral-lunges", en: ["lateral lunges", "lateral lunge", "side lunges"] },
  {
    slug: "deadlift",
    // Apparatus qualifiers, not new exercises: hex/trap bar and dumbbell
    // loading are recorded in ExerciseRef.apparatus.
    en: [
      "deadlift",
      "deadlifts",
      "test deadlifts",
      "deadlift with hex bar",
      "deadlifts with hex bar",
      "hex bar deadlift",
      "trap bar deadlift",
      "deadlifts with db",
      "deadlift with db",
      "dumbbell deadlift",
      "db deadlifts",
    ],
    abbr: ["dl"],
    misspellings: ["deadlifw", "deadlifw with hex bar", "dead lift"],
  },
  {
    slug: "romanian-deadlift",
    en: ["romanian deadlift", "barbell romanian deadlift", "romanian deadlifts"],
    abbr: ["rdl"],
  },
  {
    slug: "single-leg-rdl",
    en: ["single-leg rdl", "single leg rdl", "single-leg romanian deadlift"],
  },
  { slug: "hip-thrusts", en: ["hip thrusts", "hip thrust", "glute bridge"] },
  { slug: "cable-leg-curl", en: ["cable leg curl", "leg curl", "leg curls"] },
  {
    slug: "kb-swings",
    en: ["dumbbell swings", "db swings", "kettlebell swings", "kb swings", "swings"],
  },
  { slug: "bench-press", en: ["bench press", "barbell bench press"] },
  { slug: "incline-dumbbell-press", en: ["incline dumbbell press", "incline db press"] },
  { slug: "floor-press", en: ["floor press", "dumbbell floor press", "db floor press"] },
  {
    slug: "push-ups",
    en: ["push ups", "push-ups", "pushups", "push up", "push-up", "max push ups"],
  },
  {
    slug: "parallette-push-ups",
    en: ["parallettes", "parallette push ups", "push ups on parallettes"],
    misspellings: ["paralets", "push ups without paralets"],
  },
  { slug: "dips", en: ["dips", "dip", "tricep dips", "dips attempts"] },
  {
    slug: "bent-over-rows",
    en: [
      "bent over barbell row",
      "bent-over barbell row",
      "barbell row",
      "bent over row",
      "bent over rows",
      "bent-over rows",
    ],
  },
  { slug: "chest-supported-row", en: ["chest-supported row", "chest supported row"] },
  {
    slug: "seated-cable-row",
    // `low row` is the same horizontal pull on a different machine; the pin
    // setting (`value = 6`) is preserved by load_scope = machine_setting.
    en: ["seated cable row", "low row", "cable row", "seated row"],
  },
  { slug: "single-arm-row", en: ["single-arm supported row", "single arm row", "one arm row"] },
  { slug: "renegade-rows", en: ["renegade rows", "renegade row"] },
  { slug: "reverse-fly", en: ["reverse fly", "reverse flies"] },
  {
    slug: "cable-rear-delt-fly",
    en: [
      "single-arm cable rear-delt fly",
      "single arm cable rear delt fly",
      "cable rear-delt fly",
      "rear delt fly",
    ],
  },
  {
    slug: "pull-ups",
    en: ["pull ups", "pull-ups", "pull up", "pull-up", "pullups", "chin ups"],
  },
  {
    slug: "pull-ups-strict",
    en: [
      "strict pull ups",
      "strict pull-ups",
      "pull ups strict",
      "pull-ups strict",
      "strict pull up",
      "strict pull-up",
    ],
  },
  {
    slug: "pull-ups-kipping",
    en: [
      "pull kipping",
      "kipping pull-up",
      "kipping pull ups",
      "kipping pull-ups",
      "kipping",
      "pull ups kipping",
    ],
  },
  {
    slug: "pull-ups-wide-grip",
    en: ["wide grip pull ups", "wide-grip pull ups", "wide grip pull-up", "wide-grip pull-up"],
  },
  {
    slug: "pull-ups-weighted",
    en: ["weighted strict pull-up", "weighted pull-up", "weighted pull ups", "weighted pull-ups"],
  },
  { slug: "muscle-up", en: ["muscle up", "muscle-up", "muscle ups"], abbr: ["mu"] },
  { slug: "lat-pulldown", en: ["lat pulldown", "lat pull down", "lat pulldowns"] },
  { slug: "dead-hang", en: ["dead hang", "deadhang", "bar hang"] },
  { slug: "cable-biceps-curl", en: ["cable biceps curl", "cable bicep curl", "cable curl"] },
  {
    slug: "hammer-curls",
    en: ["bicep hammer exercise", "hammer curls", "hammer curl", "db hammer curls"],
  },
  {
    slug: "overhead-press",
    // `strict press` in the workbook is the dumbbell overhead press; `seated`
    // and `75 degrees` are position context, not separate movements.
    en: [
      "overhead press",
      "strict press",
      "seated dumbbell overhead press",
      "seated db overhead press",
      "db overhead press",
      "shoulder press",
    ],
  },
  {
    slug: "cable-lateral-raise",
    en: [
      "single-arm lateral raise cable",
      "single arm lateral raise cable",
      "cable lateral raise",
      "lateral raise",
    ],
  },
  {
    slug: "rope-triceps-pressdown",
    en: ["rope triceps pressdown", "rope tricep pressdown", "triceps pressdown", "rope pressdown"],
  },
  { slug: "skull-crusher", en: ["skull crusher", "skull crushers"] },
  { slug: "clean-and-press", en: ["clean and press", "clean & press"] },
  { slug: "windmills", en: ["windmills", "windmill"] },
  { slug: "thrusters", en: ["thrusters", "thruster", "dumbbell thrusters", "db thrusters"] },
  { slug: "burpees", en: ["burpees", "burpee"] },
  { slug: "devil-press", en: ["devil press", "devils press", "devil presses"] },
  { slug: "wall-ball", en: ["wall balls", "wall ball", "wall ball shots"] },
  { slug: "man-makers", en: ["man makers", "man maker"] },
  { slug: "jumping-jacks", en: ["jumping jacks", "jumping jack"] },
  { slug: "high-knees", en: ["high knees"] },
  { slug: "rope-jumps", en: ["rope jumps", "jump rope", "skipping"] },
  { slug: "farmer-carry", en: ["farmer carry", "farmers carry", "farmer's carry"] },
  { slug: "overhead-carry", en: ["overhead carry", "overhead hold"] },
  { slug: "sled-push", en: ["sled push", "sled pushes", "sled"] },
  { slug: "plank", en: ["plank", "planks"] },
  { slug: "shoulder-taps", en: ["shoulder taps", "plank shoulder taps"] },
  { slug: "russian-twists", en: ["russian twists", "russian twist"] },
  { slug: "kneeling-cable-crunch", en: ["kneeling cable crunch", "cable crunch"] },
  { slug: "core-abs", en: ["abs", "core abs", "crunches"] },
  { slug: "superman", en: ["superman", "supermans"] },
  {
    slug: "outdoor-run",
    en: ["outdoor run", "run", "running", "easy run", "beach run", "jog", "easy jog"],
  },
  {
    slug: "treadmill-run",
    en: [
      "treadmill run",
      "treadmill easy run",
      "treadmill",
      "hotel treadmill run",
      "run on a treadmill",
    ],
    misspellings: ["treadmil"],
  },
  { slug: "treadmill-walk", en: ["treadmill walk", "walking treadmill", "treadmill walking"] },
  { slug: "walk", en: ["walk", "walking", "steps walking"] },
  { slug: "hike", en: ["hike", "hiking", "hiking uphill", "hiking downhill", "mini hike"] },
  {
    slug: "bike-ride",
    en: [
      "bike to & from work",
      "bike to and from work",
      "biking to work",
      "bike ride",
      "easy bike ride",
      "biking",
      "extra biking",
    ],
  },
  {
    slug: "air-bike",
    // `(rogue)` is the brand of the machine — apparatus, not a movement.
    en: ["air bike", "airbike", "rogue bike", "assault bike", "echo bike", "bike (rogue)"],
    misspellings: ["kkal bike", "kkal rogue bike"],
  },
  {
    slug: "row-erg",
    en: ["row machine", "rowing machine", "rowing", "row", "erg row", "concept2 row"],
    misspellings: ["kkal row"],
  },
  { slug: "ski-erg", en: ["ski machine", "ski erg", "skierg"] },
  { slug: "swim", en: ["swimming", "swimming training", "swim", "front crawl"] },
  { slug: "surfing", en: ["surfing", "surfing training", "surf"] },
  { slug: "kayaking", en: ["kayaking", "light kayaking", "kayak"] },
  { slug: "dance", en: ["dance training", "dance", "dancing"] },
  { slug: "stretching", en: ["stretching", "stretch", "rolling and stretching"] },
  {
    slug: "foam-rolling",
    en: ["foam rolling", "rolling", "rolling shoulders", "rolling buttocks"],
  },
  { slug: "joint-mobility", en: ["joint mobility", "mobility"] },
  {
    slug: "lat-stretch",
    en: ["lat stretch", "lats stretch", "rolling lats"],
    misspellings: ["lads", "rolling lads", "stretching lads"],
  },
  { slug: "massage", en: ["massage", "deep tissue massage", "sports massage"] },
];

function toAliases(seeds: readonly AliasSeed[]): ExerciseAlias[] {
  const out: ExerciseAlias[] = [];
  for (const seed of seeds) {
    for (const alias of seed.en ?? []) {
      out.push({ alias, exerciseSlug: seed.slug, language: "en", isMisspelling: false });
    }
    for (const alias of seed.abbr ?? []) {
      out.push({ alias, exerciseSlug: seed.slug, language: "abbr", isMisspelling: false });
    }
    for (const alias of seed.misspellings ?? []) {
      out.push({ alias, exerciseSlug: seed.slug, language: "en", isMisspelling: true });
    }
  }
  return out;
}

/** Free text -> canonical slug. Seeded into `exercise_aliases`. */
export const EXERCISE_ALIASES: readonly ExerciseAlias[] = toAliases(ALIAS_SEEDS);

// --- Resolution helpers -----------------------------------------------------

/** Lowercase, collapse whitespace, drop surrounding punctuation. */
export function normalizeAliasKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/^[^a-z0-9(]+|[^a-z0-9)]+$/g, "")
    .trim();
}

const aliasIndex = new Map<string, string>();
for (const a of EXERCISE_ALIASES) aliasIndex.set(normalizeAliasKey(a.alias), a.exerciseSlug);
for (const e of EXERCISES) if (!aliasIndex.has(e.slug)) aliasIndex.set(e.slug, e.slug);

/** Normalized alias -> slug. Exposed for the importer's resolver. */
export const EXERCISE_ALIAS_INDEX: ReadonlyMap<string, string> = aliasIndex;

/** Exact (normalized) alias lookup. Fuzzy matching lives in the importer. */
export function resolveExerciseSlug(text: string): string | null {
  return aliasIndex.get(normalizeAliasKey(text)) ?? null;
}

/**
 * Apparatus vocabulary. `DB`, `Hex bar`, `climbers bar`, `(rogue)` are gym
 * hardware: they qualify a movement without changing it, so they populate
 * {@link ExerciseRef.apparatus} instead of the alias table. Keys are normalized
 * source tokens; values are the canonical apparatus label.
 */
export const APPARATUS_ALIASES: Readonly<Record<string, string>> = {
  db: "dumbbell",
  dbs: "dumbbell",
  dumbbell: "dumbbell",
  dumbbells: "dumbbell",
  dumbell: "dumbbell",
  kb: "kettlebell",
  kettlebell: "kettlebell",
  "hex bar": "hex bar",
  "trap bar": "hex bar",
  barbell: "barbell",
  plate: "plate",
  vest: "weight vest",
  "weight vest": "weight vest",
  "climbers bar": "climbers bar",
  "pull up station": "pull up station",
  "pull up station bar": "pull up station",
  "pull up station hotel": "pull up station",
  parallettes: "parallettes",
  paralets: "parallettes",
  rogue: "rogue",
  treadmill: "treadmill",
  "hotel treadmill": "treadmill",
  cable: "cable machine",
  machine: "machine",
  sled: "sled",
  wall: "wall",
};

/**
 * Non-exercise misspellings the workbook repeats. These are words in prose and
 * units (`kkal`, `lasst`, `preperation`), so they belong to the normalizer, not
 * to the alias table — an exercise alias must point at a real exercise.
 */
export const SOURCE_SPELLING_FIXES: Readonly<Record<string, string>> = {
  deadlifw: "deadlift",
  treadmil: "treadmill",
  preperation: "preparation",
  lasst: "last",
  lads: "lats",
  paralets: "parallettes",
  kkal: "kcal",
  dumbell: "dumbbell",
  wit: "with",
  aroung: "around",
};
