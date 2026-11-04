import { z } from "zod";

export const MAX_COMMENT_LENGTH = 50_000;

export const COMMENT_EMPTY_ERROR = "Comment content cannot be empty";

export const CommentContentSchema = z
  .string({ error: COMMENT_EMPTY_ERROR })
  .trim()
  .min(1, COMMENT_EMPTY_ERROR)
  .max(MAX_COMMENT_LENGTH, `Comment content must be ${MAX_COMMENT_LENGTH} characters or fewer`);
