import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { createCard } from "@/actions/cards";
import { uploadAttachment, listAttachments, deleteAttachment } from "@/actions/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachmentStorage";
import { executeMcpTool } from "@/mcp/core";
import { GET as getAttachmentsRoute, POST as postAttachmentRoute } from "@/app/api/v1/cards/[id]/attachments/route";
import { GET as getAttachmentFileRoute, DELETE as deleteAttachmentRoute } from "@/app/api/v1/attachments/[id]/route";
import { NextRequest } from "next/server";

describe("Card Attachments", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let columnId: string;
  let cardId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`attach-user-${Date.now()}`);
    userId = userRes.user.id;
    token = userRes.token;

    const project = await createTestProject(userId, "Attachment Test Project");
    projectId = project.id;

    const column = await createTestColumn(projectId, "To Do", 0);
    columnId = column.id;

    const cardRes = await createCard(
      { projectId, columnId, title: "Attachment Task Card" },
      userId
    );
    cardId = cardRes.data!.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("uploads, lists, and deletes card attachments via Server Actions", async () => {
    const fileBuffer = Buffer.from("Hello world attachment content", "utf-8");

    // 1. Upload attachment
    const uploadRes = await uploadAttachment(
      {
        cardId,
        filename: "test-doc.txt",
        contentBuffer: fileBuffer,
        mimeType: "text/plain",
      },
      userId
    );

    expect(uploadRes.success).toBe(true);
    expect(uploadRes.data?.filename).toBe("test-doc.txt");
    const attachmentId = uploadRes.data!.id;

    // 2. List attachments
    const listRes = await listAttachments(cardId, userId);
    expect(listRes.success).toBe(true);
    expect(listRes.data?.length).toBe(1);
    expect(listRes.data![0].id).toBe(attachmentId);

    // 3. Delete attachment
    const delRes = await deleteAttachment(attachmentId, userId);
    expect(delRes.success).toBe(true);

    const postDelList = await listAttachments(cardId, userId);
    expect(postDelList.data?.length).toBe(0);
  });

  it("points the attachment url at the authenticated download endpoint, not a raw public path", async () => {
    const fileBuffer = Buffer.from("content", "utf-8");
    const uploadRes = await uploadAttachment(
      { cardId, filename: "doc.txt", contentBuffer: fileBuffer, mimeType: "text/plain" },
      userId
    );
    expect(uploadRes.success).toBe(true);
    expect(uploadRes.data?.url).toBe(`/api/v1/attachments/${uploadRes.data!.id}`);
  });

  it("rejects an upload larger than MAX_ATTACHMENT_BYTES", async () => {
    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    const res = await uploadAttachment(
      { cardId, filename: "big.bin", contentBuffer: oversized, mimeType: "application/octet-stream" },
      userId
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceeds/i);

    const listRes = await listAttachments(cardId, userId);
    expect(listRes.data?.length).toBe(0);
  });

  it("supports card attachment CRUD via MCP tools", async () => {
    const base64Content = Buffer.from("MCP attachment content").toString("base64");

    // 1. add_attachment tool
    const addRes = await executeMcpTool("add_attachment", {
      cardId,
      filename: "mcp-file.txt",
      contentBase64: base64Content,
      mimeType: "text/plain",
      userId,
    });
    expect(addRes.success).toBe(true);
    expect(addRes.attachment!.filename).toBe("mcp-file.txt");
    const attachmentId = addRes.attachment!.id;

    // 2. list_attachments tool
    const listRes = await executeMcpTool("list_attachments", { cardId });
    expect(listRes.success).toBe(true);
    expect(listRes.attachments!.length).toBe(1);
    expect(listRes.attachments![0].id).toBe(attachmentId);

    // 3. delete_attachment tool
    const delRes = await executeMcpTool("delete_attachment", { id: attachmentId, userId });
    expect(delRes.success).toBe(true);
    expect(delRes.deletedId).toBe(attachmentId);
  });

  it("handles card attachments via REST API", async () => {
    // 1. Upload via REST API (POST /api/v1/cards/:id/attachments)
    const base64Str = Buffer.from("REST API file content").toString("base64");
    const uploadReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        filename: "rest-file.txt",
        contentBase64: base64Str,
        mimeType: "text/plain",
      }),
    });

    const uploadRes = await postAttachmentRoute(uploadReq, { params: Promise.resolve({ id: cardId }) });
    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json();
    const attachmentId = uploadBody.data.id;

    // 2. List via REST API (GET /api/v1/cards/:id/attachments)
    const listReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getAttachmentsRoute(listReq, { params: Promise.resolve({ id: cardId }) });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);

    // 3. Stream file via REST API (GET /api/v1/attachments/:id)
    const fileReq = new NextRequest(`http://localhost/api/v1/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const fileRes = await getAttachmentFileRoute(fileReq, { params: Promise.resolve({ id: attachmentId }) });
    expect(fileRes.status).toBe(200);

    // 4. Delete via REST API (DELETE /api/v1/attachments/:id)
    const delReq = new NextRequest(`http://localhost/api/v1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const delRes = await deleteAttachmentRoute(delReq, { params: Promise.resolve({ id: attachmentId }) });
    expect(delRes.status).toBe(200);
  });

  it("forces a download disposition and generic content-type for a non-allow-listed mime type", async () => {
    const base64Str = Buffer.from("<script>alert(1)</script>").toString("base64");
    const uploadReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ filename: "evil.html", contentBase64: base64Str, mimeType: "text/html" }),
    });
    const uploadRes = await postAttachmentRoute(uploadReq, { params: Promise.resolve({ id: cardId }) });
    const attachmentId = (await uploadRes.json()).data.id;

    const fileReq = new NextRequest(`http://localhost/api/v1/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const fileRes = await getAttachmentFileRoute(fileReq, { params: Promise.resolve({ id: attachmentId }) });

    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("application/octet-stream");
    expect(fileRes.headers.get("content-disposition")).toContain("attachment");
    expect(fileRes.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("allows inline rendering for an allow-listed image mime type", async () => {
    const base64Str = Buffer.from("fake-png-bytes").toString("base64");
    const uploadReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ filename: "photo.png", contentBase64: base64Str, mimeType: "image/png" }),
    });
    const uploadRes = await postAttachmentRoute(uploadReq, { params: Promise.resolve({ id: cardId }) });
    const attachmentId = (await uploadRes.json()).data.id;

    const fileReq = new NextRequest(`http://localhost/api/v1/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const fileRes = await getAttachmentFileRoute(fileReq, { params: Promise.resolve({ id: attachmentId }) });

    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("image/png");
    expect(fileRes.headers.get("content-disposition")).toContain("inline");
    expect(fileRes.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("strips quotes from the filename in the Content-Disposition header", async () => {
    const base64Str = Buffer.from("content").toString("base64");
    const uploadReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ filename: 'evil".txt', contentBase64: base64Str, mimeType: "text/plain" }),
    });
    const uploadRes = await postAttachmentRoute(uploadReq, { params: Promise.resolve({ id: cardId }) });
    const attachmentId = (await uploadRes.json()).data.id;

    const fileReq = new NextRequest(`http://localhost/api/v1/attachments/${attachmentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const fileRes = await getAttachmentFileRoute(fileReq, { params: Promise.resolve({ id: attachmentId }) });

    expect(fileRes.headers.get("content-disposition")).toBe('attachment; filename="evil.txt"');
  });

  it("rejects a REST upload whose Content-Length exceeds the size limit before reading the body", async () => {
    const uploadReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": String(MAX_ATTACHMENT_BYTES * 2),
      },
      body: JSON.stringify({ filename: "big.bin", contentBase64: "x", mimeType: "application/octet-stream" }),
    });
    const uploadRes = await postAttachmentRoute(uploadReq, { params: Promise.resolve({ id: cardId }) });
    expect(uploadRes.status).toBe(413);

    const listRes = await listAttachments(cardId, userId);
    expect(listRes.data?.length).toBe(0);
  });
});
