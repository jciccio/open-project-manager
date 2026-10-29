import { z } from "zod";

export const FilterJsonSchema = z.string().refine(
  (value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  },
  { message: "filterJson must be a JSON object" }
);

export const MAX_VIEW_NAME_LENGTH = 200;

const viewName = z.string().trim().min(1, "View name is required").max(MAX_VIEW_NAME_LENGTH);

export const SavedViewCreateSchema = z.object({
  name: viewName,
  filterJson: FilterJsonSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const SavedViewUpdateSchema = z.object({
  name: viewName.optional(),
  filterJson: FilterJsonSchema.optional(),
  isDefault: z.boolean().optional(),
});
