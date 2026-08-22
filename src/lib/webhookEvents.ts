export const WEBHOOK_EVENT_TYPES = [
  "card_created",
  "moved",
  "priority_changed",
  "title_changed",
  "description_changed",
  "points_changed",
  "due_date_changed",
  "type_changed",
  "label_added",
  "label_removed",
  "assigned",
  "unassigned",
  "comment_added",
  "archived",
  "unarchived",
  "project_created",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
