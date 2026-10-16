import { z } from "zod";
import { INVALID_COLOR_ERROR, isHexColor } from "@/lib/colors";

export const MAX_LABEL_DESCRIPTION_LENGTH = 2_000;

const labelFields = {
  color: z.string({ error: INVALID_COLOR_ERROR }).refine(isHexColor, INVALID_COLOR_ERROR),
  description: z
    .string({ error: "Label description must be text" })
    .max(MAX_LABEL_DESCRIPTION_LENGTH, `Label description must be at most ${MAX_LABEL_DESCRIPTION_LENGTH} characters`)
    .nullable(),
};

export const LabelDetailsSchema = z.object({
  color: labelFields.color.optional(),
  description: labelFields.description.optional(),
});

export type LabelDetailsInput = z.infer<typeof LabelDetailsSchema>;

export function parseLabelDetails(
  input: unknown
): { success: true; data: LabelDetailsInput } | { success: false; error: string } {
  const parsed = LabelDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  const description = parsed.data.description?.trim();
  return {
    success: true,
    data: {
      ...parsed.data,
      ...(parsed.data.description === undefined ? {} : { description: description || null }),
    },
  };
}
