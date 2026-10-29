import { z } from "zod";
import { INVALID_COLOR_ERROR, isHexColor } from "@/lib/colors";

export const MAX_CARD_TYPE_NAME_LENGTH = 100;
export const MAX_CARD_TYPE_ICON_LENGTH = 50;

const cardTypeFields = {
  name: z.string().trim().min(1, "Type name is required").max(MAX_CARD_TYPE_NAME_LENGTH),
  icon: z.string().trim().min(1).max(MAX_CARD_TYPE_ICON_LENGTH),
  color: z.string().refine(isHexColor, INVALID_COLOR_ERROR),
};

export const CardTypeCreateSchema = z.strictObject({
  name: cardTypeFields.name,
  icon: cardTypeFields.icon.optional(),
  color: cardTypeFields.color.optional(),
});

export const CardTypeUpdateSchema = z.strictObject({
  name: cardTypeFields.name.optional(),
  icon: cardTypeFields.icon.optional(),
  color: cardTypeFields.color.optional(),
});
