import path from "path";

// Defaults to a repo-local directory for local dev. In Docker this must point
// inside the mounted data volume (already chown'd to the nextjs user) -
// public/ is not writable by the app's non-root user and isn't persisted
// across rebuilds.
export const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "attachments");

export const MAX_ATTACHMENT_BYTES = process.env.MAX_ATTACHMENT_BYTES
  ? parseInt(process.env.MAX_ATTACHMENT_BYTES, 10)
  : 10 * 1024 * 1024; // 10MB

export function getAttachmentFilePath(storageKey: string): string {
  return path.join(UPLOADS_DIR, storageKey);
}

// Types safe to render inline in a browser tab. Everything else is forced to
// a download disposition with a generic content-type - the stored mimeType
// is client-supplied and untrusted. image/svg+xml is deliberately excluded:
// SVG can embed and execute <script>.
const INLINE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export function canRenderInline(mimeType: string | null): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return INLINE_MIME_TYPES.has(normalized);
}

export function contentDispositionHeader(filename: string, inline: boolean): string {
  const safeFilename = filename.replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${safeFilename}"`;
}
