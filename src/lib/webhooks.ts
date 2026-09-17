import crypto from "crypto";
import { db } from "@/lib/db";

export async function triggerWebhooks(
  projectId: string,
  event: string,
  payload: Record<string, unknown>
) {
  try {
    const webhooks = await db.webhook.findMany({
      where: { projectId, isActive: true },
    });
    if (webhooks.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    });

    for (const webhook of webhooks) {
      let events: string[] = [];
      try {
        events = JSON.parse(webhook.eventsJson);
      } catch {
        events = [];
      }
      if (!events.includes(event)) continue;

      const signature = crypto.createHmac("sha256", webhook.secret).update(body).digest("hex");
      const deliveryId = crypto.randomUUID();

      // Fire-and-forget: not awaited, so delivery latency/failures never affect
      // the mutation's response to the user. This only works because the app
      // runs as a long-lived Node process (Dockerfile: CMD ["node", "server.js"]),
      // not a serverless/edge function whose execution context freezes once the
      // response is sent.
      fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OPM-Event": event,
          "X-OPM-Signature": `sha256=${signature}`,
          "X-OPM-Delivery": deliveryId,
        },
        body,
        signal: AbortSignal.timeout(5000),
      })
        .then((res) => {
          if (!res.ok) {
            console.error(
              `Webhook delivery non-2xx (webhook=${webhook.id}, event=${event}): ${res.status}`
            );
          }
        })
        .catch((err) => {
          console.error(`Webhook delivery failed (webhook=${webhook.id}, event=${event}):`, err);
        });
    }
  } catch (err) {
    console.error("Error triggering webhooks:", err);
  }
}
