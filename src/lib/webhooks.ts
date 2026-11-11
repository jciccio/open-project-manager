import crypto from "crypto";
import { db } from "@/lib/db";

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 10 : 1000;

async function deliverWithRetry(
  webhookId: string,
  url: string,
  event: string,
  body: string,
  signature: string,
  deliveryId: string
) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OPM-Event": event,
          "X-OPM-Signature": `sha256=${signature}`,
          "X-OPM-Delivery": deliveryId,
          "X-OPM-Attempt": String(attempt),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        return;
      }

      // If server returned 4xx (except 429 Too Many Requests), client error is permanent
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error(
          `Webhook delivery non-2xx (webhook=${webhookId}, event=${event}): ${res.status}`
        );
        return;
      }

      console.error(
        `Webhook delivery non-2xx attempt ${attempt}/${MAX_ATTEMPTS} (webhook=${webhookId}, event=${event}): ${res.status}`
      );
    } catch (err) {
      console.error(
        `Webhook delivery failed attempt ${attempt}/${MAX_ATTEMPTS} (webhook=${webhookId}, event=${event}):`,
        err
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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

      // Fire-and-forget: delivery runs asynchronously with retry so latency/failures
      // never affect the mutation's response to the user.
      deliverWithRetry(webhook.id, webhook.url, event, body, signature, deliveryId).catch((err) => {
        console.error(`Webhook delivery worker failed (webhook=${webhook.id}, event=${event}):`, err);
      });
    }
  } catch (err) {
    console.error("Error triggering webhooks:", err);
  }
}
