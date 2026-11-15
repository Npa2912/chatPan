import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  user,
  createSession,
  endSession,
  checkOrigin,
  rateLimit,
  HttpError,
  tokenHash,
} from "@/lib/security";
import { models, provider, parseSSE } from "@/lib/provider";
import { parseUpload } from "@/lib/uploads";
import { sendToken } from "@/lib/mail";
export const runtime = "nodejs";
export const maxDuration = 120;
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80).optional(),
  remember: z.boolean().optional(),
});
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
async function limitedBytes(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "Yêu cầu quá lớn.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}
async function body(request: Request) {
  try {
    return JSON.parse(
      new TextDecoder().decode(await limitedBytes(request, 1000000)),
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "JSON không hợp lệ.");
  }
}

async function handler(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  let releaseLease: (() => Promise<unknown>) | undefined;
  try {
    const { path } = await ctx.params;
    const route = path.join("/");
    const method = request.method;
    if (!["GET", "HEAD"].includes(method)) checkOrigin(request);
    if (route.startsWith("auth/")) {
      if (method !== "POST")
        throw new HttpError(405, "Phương thức không hỗ trợ.");
      if (
        ["auth/login", "auth/register", "auth/forgot", "auth/token"].includes(
          route,
        )
      )
        await rateLimit("auth:global", 100, 60);
      if (route === "auth/register" || route === "auth/login") {
        const input = credentials.parse(await body(request));
        await rateLimit("auth:" + tokenHash(input.email), 10, 900);
        let account = await db.user.findUnique({
          where: { email: input.email },
        });
        if (route === "auth/register") {
          if (account) throw new HttpError(409, "Email này đã được đăng ký.");
          if (!input.name) throw new HttpError(400, "Vui lòng nhập tên.");
          account = await db.user.create({
            data: {
              email: input.email,
              name: input.name,
              password: await bcrypt.hash(input.password, 12),
              settings: { create: {} },
            },
          });
        } else if (
          !account ||
          !(await bcrypt.compare(input.password, account.password))
        )
          throw new HttpError(401, "Email hoặc mật khẩu không đúng.");
        await createSession(account!.id, input.remember);
        return json({
          id: account!.id,
          email: account!.email,
          name: account!.name,
          verified: account!.verified,
        });
      }
      if (route === "auth/logout") {
        await endSession();
        return json({ ok: true });
      }
      if (route === "auth/forgot") {
        const { email } = z
          .object({ email: z.email() })
          .parse(await body(request));
        if (!process.env.SMTP_HOST)
          throw new HttpError(503, "Chưa cấu hình email SMTP.");
        const account = await db.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        if (account) await sendToken(account.email, "reset");
        return json({
          message: "Nếu tài khoản tồn tại, liên kết đã được gửi.",
        });
      }
      if (route === "auth/verify") {
        const account = await user();
        await rateLimit("verify:" + account.id, 3, 3600);
        await sendToken(account.email, "verify");
        return json({ message: "Đã gửi email xác minh." });
      }
      if (route === "auth/token") {
        const input = z
          .object({
            token: z.string().length(64),
            purpose: z.enum(["reset", "verify"]),
            password: z.string().min(10).max(128).optional(),
          })
          .parse(await body(request));
        const token = await db.emailToken.findUnique({
          where: { hash: tokenHash(input.token) },
        });
        if (
          !token ||
          token.purpose !== input.purpose ||
          token.expiresAt < new Date()
        )
          throw new HttpError(400, "Liên kết không hợp lệ hoặc hết hạn.");
        if (input.purpose === "reset" && !input.password)
          throw new HttpError(400, "Vui lòng nhập mật khẩu mới.");
        const password = input.password
          ? await bcrypt.hash(input.password, 12)
          : undefined;
        await db.$transaction(async (tx) => {
          await tx.emailToken.delete({ where: { hash: token.hash } });
          const account = await tx.user.update({
            where: { email: token.email },
            data:
              input.purpose === "verify" ? { verified: true } : { password },
          });
          if (input.purpose === "reset")
            await tx.session.deleteMany({ where: { userId: account.id } });
        });
        return json({ message: "Thành công. Bạn có thể đăng nhập." });
      }
      throw new HttpError(404, "Không tìm thấy.");
    }
    const account = await user();
    if (method !== "GET") await rateLimit("write:" + account.id, 60, 60);
    if (route === "me") {
      if (method === "GET")
        return json({
          id: account.id,
          name: account.name,
          email: account.email,
          role: account.role,
          verified: account.verified,
          settings: await db.userSettings.upsert({
            where: { userId: account.id },
            create: { userId: account.id },
            update: {},
          }),
        });
      if (method === "PATCH") {
        const input = z
          .object({
            name: z.string().trim().min(1).max(80),
            systemPrompt: z.string().max(4000),
          })
          .parse(await body(request));
        await db.user.update({
          where: { id: account.id },
          data: {
            name: input.name,
            settings: {
              upsert: {
                create: { systemPrompt: input.systemPrompt },
                update: { systemPrompt: input.systemPrompt },
              },
            },
          },
        });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await db.$transaction([
          db.emailToken.deleteMany({ where: { email: account.email } }),
          db.user.delete({ where: { id: account.id } }),
        ]);
        (await cookies()).delete("chatpan_session");
        return json({ ok: true });
      }
    }
    if (route === "models" && method === "GET") return json(await models());
    if (route === "folders") {
      if (method === "GET")
        return json(
          await db.folder.findMany({ where: { userId: account.id } }),
        );
      if (method === "POST") {
        const { name } = z
          .object({ name: z.string().trim().min(1).max(80) })
          .parse(await body(request));
        return json(
          await db.folder.create({ data: { name, userId: account.id } }),
        );
      }
    }
    if (route === "conversations") {
      if (method === "GET") {
        const search = request.nextUrl.searchParams
          .get("search")
          ?.slice(0, 200);
        return json(
          await db.conversation.findMany({
            where: {
              userId: account.id,
              ...(search
                ? {
                    OR: [
                      { title: { contains: search, mode: "insensitive" } },
                      {
                        messages: {
                          some: {
                            content: { contains: search, mode: "insensitive" },
                          },
                        },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
            take: 100,
          }),
        );
      }
      if (method === "POST")
        return json(
          await db.conversation.create({ data: { userId: account.id } }),
        );
    }
    if (path[0] === "conversations" && path[1]) {
      const conversation = await db.conversation.findFirst({
        where: { id: path[1], userId: account.id },
      });
      if (!conversation) throw new HttpError(404, "Không tìm thấy hội thoại.");
      if (method === "GET")
        return json({
          ...conversation,
          messages: await db.message.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: "asc" },
            take: 500,
          }),
        });
      if (method === "PATCH") {
        const input = z
          .object({
            title: z.string().trim().min(1).max(120).optional(),
            pinned: z.boolean().optional(),
            folderId: z.string().nullable().optional(),
          })
          .parse(await body(request));
        if (
          input.folderId &&
          !(await db.folder.findFirst({
            where: { id: input.folderId, userId: account.id },
          }))
        )
          throw new HttpError(404, "Không tìm thấy thư mục.");
        return json(
          await db.conversation.update({
            where: { id: conversation.id },
            data: input,
          }),
        );
      }
      if (method === "DELETE") {
        await db.conversation.delete({ where: { id: conversation.id } });
        return json({ ok: true });
      }
    }
    if (route === "files") {
      if (method === "GET")
        return json(
          await db.attachment.findMany({
            where: { userId: account.id },
            select: { id: true, name: true, mime: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        );
      if (method === "POST") {
        if (
          Number(request.headers.get("content-length") || 0) >
          9 * 1024 * 1024
        )
          throw new HttpError(413, "Tệp quá lớn.");
        const bytes = await limitedBytes(request, 9 * 1024 * 1024);
        const form = await new Response(bytes, {
          headers: {
            "Content-Type": request.headers.get("content-type") || "",
          },
        }).formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new HttpError(400, "Thiếu tệp.");
        const parsed = await parseUpload(file);
        return json(
          await db.attachment.create({
            data: {
              userId: account.id,
              name: file.name.slice(0, 200),
              ...parsed,
              data: new Uint8Array(parsed.data),
            },
            select: { id: true, name: true, mime: true },
          }),
        );
      }
    }
    if (path[0] === "files" && path[1]) {
      const file = await db.attachment.findFirst({
        where: { id: path[1], userId: account.id },
      });
      if (!file) throw new HttpError(404, "Không tìm thấy tệp.");
      if (method === "DELETE") {
        await db.attachment.delete({ where: { id: file.id } });
        return json({ ok: true });
      }
      if (method === "GET")
        return new Response(file.data, {
          headers: {
            "Content-Type": file.mime,
            "Content-Disposition": `${file.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "Cache-Control": "private, no-store",
          },
        });
    }
    if (route === "chat" && method === "POST") {
      await rateLimit("chat:" + account.id, 20, 60);
      const input = z
        .object({
          conversationId: z.string(),
          content: z.string().max(24000),
          model: z.string().min(1).max(200),
          attachments: z.array(z.string()).max(4).default([]),
          regenerate: z.boolean().default(false),
          imageMode: z.enum(["vision", "ocr"]).default("vision"),
        })
        .parse(await body(request));
      if (
        !input.content.trim() &&
        !input.attachments.length &&
        !input.regenerate
      )
        throw new HttpError(400, "Vui lòng nhập nội dung.");
      const conversation = await db.conversation.findFirst({
        where: { id: input.conversationId, userId: account.id },
        include: { messages: { orderBy: { createdAt: "desc" }, take: 40 } },
      });
      if (!conversation) throw new HttpError(404, "Không tìm thấy hội thoại.");
      const leaseToken = crypto.randomUUID();
      const lease = await db.$queryRaw<
        { conversationId: string }[]
      >`INSERT INTO "ChatLease" ("conversationId","token","expiresAt") VALUES (${conversation.id},${leaseToken},${new Date(Date.now() + 300000)}) ON CONFLICT ("conversationId") DO UPDATE SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt" WHERE "ChatLease"."expiresAt" < NOW() RETURNING "conversationId"`;
      if (!lease.length)
        throw new HttpError(
          409,
          "Cuộc trò chuyện đang tạo phản hồi. Vui lòng đợi hoặc dừng trước khi gửi tiếp.",
        );
      releaseLease = () =>
        db.chatLease.deleteMany({
          where: { conversationId: conversation.id, token: leaseToken },
        });
      if (!(await models()).some((m: { id: string }) => m.id === input.model))
        throw new HttpError(
          400,
          "Model không có trong danh sách nhà cung cấp.",
        );
      const ownFiles = await db.attachment.findMany({
        where: { id: { in: input.attachments }, userId: account.id },
      });
      if (
        input.imageMode === "ocr" &&
        ownFiles.some((f) => f.mime.startsWith("image/") && !f.text?.trim())
      )
        throw new HttpError(
          400,
          "Ảnh chưa có văn bản OCR. Hãy bật OCR trên server và tải lại ảnh, hoặc chọn Vision.",
        );
      if (ownFiles.length !== new Set(input.attachments).size)
        throw new HttpError(404, "Không tìm thấy tệp.");
      let history = conversation.messages.reverse();
      if (input.regenerate) {
        const last = history.at(-1);
        if (last?.role === "assistant") {
          await db.message.delete({ where: { id: last.id } });
          history = history.slice(0, -1);
        }
        if (history.at(-1)?.role !== "user")
          throw new HttpError(400, "Không có tin nhắn để tạo lại.");
      } else {
        const message = await db.message.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: input.content,
            attachmentIds: input.attachments,
          },
        });
        history.push(message);
      }
      const settings = await db.userSettings.findUnique({
        where: { userId: account.id },
      });
      const selected = [];
      let remaining = 60000;
      for (const message of [...history].reverse()) {
        if (message.content.length > remaining) break;
        selected.unshift(message);
        remaining -= message.content.length;
      }
      const messages: unknown[] = [
        {
          role: "system",
          content: settings?.systemPrompt || "Bạn là chatPan.",
        },
      ];
      let documentBudget = 60000;
      for (const message of selected) {
        const files = await db.attachment.findMany({
          where: { id: { in: message.attachmentIds }, userId: account.id },
        });
        const content: unknown[] = [{ type: "text", text: message.content }];
        for (const file of files) {
          if (file.mime.startsWith("image/") && input.imageMode === "vision")
            content.push({
              type: "image_url",
              image_url: {
                url: `data:${file.mime};base64,${Buffer.from(file.data).toString("base64")}`,
              },
            });
          else {
            const excerpt =
              file.text?.slice(0, Math.min(30000, documentBudget)) || "";
            documentBudget -= excerpt.length;
            content.push({
              type: "text",
              text: `\n<untrusted_document name=${JSON.stringify(file.name)}>\n${excerpt}\n</untrusted_document>`,
            });
          }
        }
        messages.push({
          role: message.role,
          content: files.length ? content : message.content,
        });
      }
      const upstreamAbort = new AbortController();
      const upstream = await provider(
        "chat/completions",
        { model: input.model, messages, stream: true },
        AbortSignal.any([request.signal, upstreamAbort.signal]),
      );
      if (!upstream.body)
        throw new HttpError(502, "Nhà cung cấp không trả dữ liệu.");
      const encoder = new TextEncoder();
      let cancelled = false;
      const stream = new ReadableStream({
        cancel() {
          cancelled = true;
          upstreamAbort.abort();
        },
        async start(controller) {
          let output = "";
          let success = false;
          const emit = (data: unknown) => {
            if (!cancelled)
              controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          };
          try {
            for await (const delta of parseSSE(upstream.body!)) {
              if (output.length + delta.length > 200000)
                throw new Error("Output limit exceeded");
              output += delta;
              emit({ delta });
            }
            if (!output) throw new Error("empty");
            success = true;
          } catch {
            if (!request.signal.aborted)
              emit({ error: "Phản hồi bị gián đoạn. Bạn có thể thử tạo lại." });
          } finally {
            try {
              if (output)
                await db.message.create({
                  data: {
                    conversationId: conversation.id,
                    role: "assistant",
                    content: output,
                  },
                });
              await db.conversation.update({
                where: { id: conversation.id },
                data: {
                  updatedAt: new Date(),
                  ...(history.length === 1
                    ? { title: input.content.slice(0, 70) || "Phân tích tệp" }
                    : {}),
                },
              });
              await db.apiUsage.create({
                data: { userId: account.id, model: input.model, success },
              });
              if (!request.signal.aborted) emit({ done: true });
            } finally {
              await releaseLease?.();
              if (!cancelled) controller.close();
            }
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (route === "images" && method === "GET")
      return json(
        await db.generatedImage.findMany({
          where: { userId: account.id },
          select: { id: true, prompt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      );
    if (route === "images" && method === "POST") {
      if (!process.env.DEFAULT_IMAGE_MODEL)
        throw new HttpError(
          503,
          "Chưa cấu hình model tạo ảnh. Khả năng tạo ảnh chưa được xác minh.",
        );
      await rateLimit("images:" + account.id, 5, 60);
      const input = z
        .object({ prompt: z.string().trim().min(1).max(4000) })
        .parse(await body(request));
      const result = await (
        await provider("images/generations", {
          model: process.env.DEFAULT_IMAGE_MODEL,
          prompt: input.prompt,
          n: 1,
          response_format: "b64_json",
          size: "1024x1024",
        })
      ).json();
      if (!result.data?.[0]?.b64_json)
        throw new HttpError(
          502,
          "Chưa hỗ trợ phản hồi URL của nhà cung cấp; cần b64_json để lưu ảnh an toàn.",
        );
      const raw = Buffer.from(result.data[0].b64_json, "base64");
      if (raw.length > 16 * 1024 * 1024)
        throw new HttpError(502, "Ảnh trả về quá lớn.");
      const sharp = (await import("sharp")).default;
      const data = await sharp(raw, { limitInputPixels: 25000000 })
        .webp()
        .toBuffer();
      return json(
        await db.generatedImage.create({
          data: {
            userId: account.id,
            prompt: input.prompt,
            data: new Uint8Array(data),
          },
          select: { id: true, prompt: true, createdAt: true },
        }),
      );
    }
    if (path[0] === "images" && path[1]) {
      const image = await db.generatedImage.findFirst({
        where: { id: path[1], userId: account.id },
      });
      if (!image) throw new HttpError(404, "Không tìm thấy ảnh.");
      if (method === "DELETE") {
        await db.generatedImage.delete({ where: { id: image.id } });
        return json({ ok: true });
      }
      if (method === "GET")
        return new Response(image.data, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
          },
        });
    }
    if (route === "admin" && method === "GET") {
      if (account.role !== "ADMIN")
        throw new HttpError(403, "Chỉ quản trị viên được phép truy cập.");
      return json({
        users: await db.user.count(),
        conversations: await db.conversation.count(),
        requests: await db.apiUsage.count(),
        usage: await db.apiUsage.groupBy({
          by: ["model", "success"],
          _count: true,
        }),
        models: await models(),
      });
    }
    throw new HttpError(404, "Không tìm thấy.");
  } catch (error) {
    await releaseLease?.().catch(() => {});
    if (error instanceof z.ZodError)
      return json(
        {
          error: "Dữ liệu không hợp lệ. Vui lòng kiểm tra các trường đã nhập.",
          details: error.issues.map((i) => i.path.join(".")),
        },
        400,
      );
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "P2002"
    )
      return json({ error: "Dữ liệu đã tồn tại." }, 409);
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "Không thể xử lý yêu cầu. Vui lòng thử lại." }, 500);
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
