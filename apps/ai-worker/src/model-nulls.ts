import type { ZodTypeAny } from "zod";

/**
 * Lets Zod's own defaults absorb the `null`s a model sends for unstated fields.
 *
 * A Zod default fires only when a key is *absent*. Models do not omit keys —
 * instructed not to invent data, they emit `null` — so every
 * `Enum.schema.default(...)` field in the draft tree is a latent 422. This was
 * found the expensive way: `setType`, then `objective`/`intensity`, then
 * `circuit.format`, each fixed individually while twenty more waited. Deleting
 * the key is what turns "the model said nothing" into the schema's own answer.
 *
 * Deliberately narrow. A key is dropped only when the value is `null`, the
 * field declares a default, and the field would reject `null` anyway — so a
 * genuinely nullable field keeps its null, and a wrong non-null value still
 * reaches validation and the repair pass.
 */

interface ZodDef {
  readonly typeName?: string;
  readonly innerType?: ZodTypeAny;
  readonly schema?: ZodTypeAny;
  readonly type?: ZodTypeAny;
}

const WRAPPERS = new Set(["ZodDefault", "ZodOptional", "ZodNullable", "ZodEffects", "ZodBranded"]);

function definitionOf(schema: ZodTypeAny): ZodDef {
  return schema._def as ZodDef;
}

/** Peels wrappers off to reach the object/array underneath. */
function coreType(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let depth = 0; depth < 20; depth += 1) {
    const def = definitionOf(current);
    if (def.typeName === undefined || !WRAPPERS.has(def.typeName)) return current;
    const inner = def.innerType ?? def.schema;
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

function declaresDefault(schema: ZodTypeAny): boolean {
  let current = schema;
  for (let depth = 0; depth < 20; depth += 1) {
    const def = definitionOf(current);
    if (def.typeName === "ZodDefault") return true;
    if (def.typeName === undefined || !WRAPPERS.has(def.typeName)) return false;
    const inner = def.innerType ?? def.schema;
    if (inner === undefined) return false;
    current = inner;
  }
  return false;
}

export function dropNullsWhereDefaulted(schema: ZodTypeAny, value: unknown): unknown {
  const core = coreType(schema);
  const typeName = definitionOf(core).typeName;

  if (typeName === "ZodArray" && Array.isArray(value)) {
    const element = definitionOf(core).type;
    if (element === undefined) return value;
    return value.map((item) => dropNullsWhereDefaulted(element, item));
  }

  if (
    typeName === "ZodObject" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const shape = (core as unknown as { shape: Record<string, ZodTypeAny> }).shape;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const field = shape[key];
      // Unknown keys pass through untouched: the schema decides their fate.
      if (field === undefined) {
        result[key] = child;
        continue;
      }
      if (child === null && declaresDefault(field) && !field.safeParse(null).success) continue;
      result[key] = dropNullsWhereDefaulted(field, child);
    }
    return result;
  }

  return value;
}
