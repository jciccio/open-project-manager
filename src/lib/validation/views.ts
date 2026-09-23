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
