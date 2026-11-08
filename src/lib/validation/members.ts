import { z } from "zod";
import type { ProjectRole } from "@/lib/permissions";

export const PROJECT_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const satisfies readonly ProjectRole[];

export const ProjectRoleSchema = z.enum(PROJECT_ROLES);
