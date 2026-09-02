import type { NextConfig } from "next";

// Headroom above MAX_ATTACHMENT_BYTES (src/lib/attachmentStorage.ts) for form
// encoding overhead - the actual size limit is enforced in uploadAttachment.
const maxAttachmentMb = process.env.MAX_ATTACHMENT_BYTES
  ? Math.ceil(parseInt(process.env.MAX_ATTACHMENT_BYTES, 10) / (1024 * 1024))
  : 10;

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: `${maxAttachmentMb + 1}mb`,
    },
  },
};

export default nextConfig;
