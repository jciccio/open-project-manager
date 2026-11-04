import { z } from "zod";

export const MAX_PROJECT_NAME_LENGTH = 200;

export const PROJECT_NAME_REQUIRED_ERROR = "Project name is required";

export const ProjectNameSchema = z
  .string({ error: PROJECT_NAME_REQUIRED_ERROR })
  .trim()
  .min(1, PROJECT_NAME_REQUIRED_ERROR)
  .max(MAX_PROJECT_NAME_LENGTH, `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`);
