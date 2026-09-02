import { db } from "@/lib/db";

// Not a Server Action: this is called internally by actions/services after
// they've already authorized the mutation being logged. It must never live
// in a "use server" file - every export there becomes directly callable by
// any authenticated client with no ownership check of its own, which would
// let anyone forge activity history on an arbitrary card.
export async function recordActivity(data: {
  cardId: string;
  actorUserId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}) {
  try {
    return await db.activity.create({
      data: {
        cardId: data.cardId,
        actorUserId: data.actorUserId,
        type: data.type,
        fromValue: data.fromValue !== undefined ? data.fromValue : null,
        toValue: data.toValue !== undefined ? data.toValue : null,
      },
    });
  } catch (err) {
    console.error("Error recording activity:", err);
    return null;
  }
}
