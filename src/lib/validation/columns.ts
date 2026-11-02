import { z } from "zod";
import { COLUMN_GROUPS, resolveColumnGroup, type ColumnGroup } from "@/lib/columnGroups";
import { INVALID_COLOR_ERROR, isHexColor } from "@/lib/colors";

export const MAX_COLUMN_NAME_LENGTH = 200;
export const MAX_COLUMN_DESCRIPTION_LENGTH = 2_000;

export const ColumnGroupSchema = z.enum(COLUMN_GROUPS, {
  error: `Unknown state group. Expected one of ${COLUMN_GROUPS.join(", ")}`,
});

const COLUMN_NAME_REQUIRED_ERROR = "Column name is required";

const columnFields = {
  name: z
    .string({ error: COLUMN_NAME_REQUIRED_ERROR })
    .trim()
    .min(1, COLUMN_NAME_REQUIRED_ERROR)
    .max(MAX_COLUMN_NAME_LENGTH, `Column name must be at most ${MAX_COLUMN_NAME_LENGTH} characters`),
  isDone: z.boolean({ error: "isDone must be true or false" }),
  group: ColumnGroupSchema,
  color: z.string({ error: INVALID_COLOR_ERROR }).refine(isHexColor, INVALID_COLOR_ERROR).nullable(),
  description: z
    .string({ error: "Column description must be text" })
    .max(MAX_COLUMN_DESCRIPTION_LENGTH, `Column description must be at most ${MAX_COLUMN_DESCRIPTION_LENGTH} characters`)
    .nullable(),
};

export const ColumnDetailsSchema = z.object({
  isDone: columnFields.isDone.optional(),
  group: columnFields.group.optional(),
  color: columnFields.color.optional(),
  description: columnFields.description.optional(),
});

export const ColumnCreateSchema = ColumnDetailsSchema.extend({
  name: columnFields.name,
});

export const ColumnUpdateSchema = ColumnDetailsSchema.extend({
  name: columnFields.name.optional(),
  order: z.number({ error: "Column order must be a whole number" }).int().min(0).optional(),
});

export type ColumnDetailsInput = z.infer<typeof ColumnDetailsSchema>;
export type ColumnUpdateInput = z.infer<typeof ColumnUpdateSchema>;

export function formatColumnInputError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

type ParsedColumn<T> = { success: true; data: T; group: ColumnGroup; isDone: boolean } | { success: false; error: string };

function parseColumn<T extends { group?: ColumnGroup; isDone?: boolean }>(
  schema: z.ZodType<T>,
  input: unknown,
  existingGroup?: string
): ParsedColumn<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: formatColumnInputError(parsed.error) };
  const resolved = resolveColumnGroup(parsed.data, existingGroup);
  if (!resolved.success) return resolved;
  return { success: true, data: parsed.data, group: resolved.group, isDone: resolved.isDone };
}

export function parseColumnCreate(input: unknown) {
  return parseColumn(ColumnCreateSchema, input);
}

export function parseColumnUpdate(input: unknown, existingGroup: string) {
  return parseColumn(ColumnUpdateSchema, input, existingGroup);
}
