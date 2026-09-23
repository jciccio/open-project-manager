import { z } from "zod";

export const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 50_000;

export const PrioritySchema = z.enum(PRIORITIES);

const DueDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" });

const cardFields = {
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable(),
  priority: PrioritySchema,
  points: z.number().nullable(),
  owner: z.string().max(200).nullable(),
  dueDate: DueDateSchema.nullable(),
  parentId: z.string().nullable(),
  typeId: z.string().nullable(),
  labelIds: z.array(z.string()),
  assigneeIds: z.array(z.string()),
};

export const CardCreateSchema = z.strictObject({
  projectId: z.string().min(1),
  columnId: z.string().min(1),
  title: cardFields.title,
  description: cardFields.description.optional(),
  priority: cardFields.priority.optional(),
  points: cardFields.points.optional(),
  owner: cardFields.owner.optional(),
  dueDate: cardFields.dueDate.optional(),
  parentId: cardFields.parentId.optional(),
  typeId: cardFields.typeId.optional(),
  labelIds: cardFields.labelIds.optional(),
  assigneeIds: cardFields.assigneeIds.optional(),
});

export const CardUpdateSchema = z.strictObject({
  columnId: z.string().min(1).optional(),
  title: cardFields.title.optional(),
  description: cardFields.description.optional(),
  priority: cardFields.priority.optional(),
  points: cardFields.points.optional(),
  owner: cardFields.owner.optional(),
  dueDate: cardFields.dueDate.optional(),
  order: z.number().int().optional(),
  parentId: cardFields.parentId.optional(),
  typeId: cardFields.typeId.optional(),
  labelIds: cardFields.labelIds.optional(),
  assigneeIds: cardFields.assigneeIds.optional(),
});

export const CardReorderSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.string().min(1), order: z.number().int(), columnId: z.string().min(1).optional() }))
    .min(1),
});
