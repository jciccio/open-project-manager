import { z } from "zod";
import type { ProjectVisibility } from "@/lib/permissions";

export const MAX_PROJECT_NAME_LENGTH = 200;

export const PROJECT_NAME_REQUIRED_ERROR = "Project name is required";

export const ProjectNameSchema = z
  .string({ error: PROJECT_NAME_REQUIRED_ERROR })
  .trim()
  .min(1, PROJECT_NAME_REQUIRED_ERROR)
  .max(MAX_PROJECT_NAME_LENGTH, `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`);

export const PROJECT_VISIBILITIES = ["PRIVATE", "INTERNAL"] as const satisfies readonly ProjectVisibility[];

export const ProjectVisibilitySchema = z.enum(PROJECT_VISIBILITIES);
