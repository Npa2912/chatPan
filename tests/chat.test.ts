import "dotenv/config";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import * as security from "../src/lib/security";
import { POST } from "../src/app/api/[...path]/route";
let account: Awaited<ReturnType<typeof db.user.create>>;
let conversationId: string;
function fakeProvider() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/models"))
        return Response.json({ data: [{ id: "mock-model" }] });
      return new Response(
        'data: {"choices":[{"delta":{"content":"Xin "}}]}\n\ndata: {"choices":[{"delta":{"content":"chào"}}]}\n\ndata: [DONE]\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }),
  );
}
async function send(data: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        content: "Xin chào",
        model: "mock-model",
        ...data,
      }),
    }),
    { params: Promise.resolve({ path: ["chat"] }) },
  );
}
beforeEach(() => {
  vi.stubEnv("XINGCHI_WIRE_API", "chat_completions");
  vi.stubEnv("XINGCHI_MODEL_WIRE_API", "{}");
});
beforeAll(async () => {
  account = await db.user.create({
    data: {
      email: `mock-chat-${Date.now()}@example.com`,
      name: "Integration test",
      password: "not-a-login-hash",
    },
  });
  conversationId = (
    await db.conversation.create({ data: { userId: account.id } })
  ).id;
});
afterAll(async () => {
  await db.user.delete({ where: { id: account.id } });
  await db.$disconnect();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Chat route with real PostgreSQL and explicitly mocked AI provider", () => {
  it("streams tokens and persists multi-turn messages; regenerates without duplicating user input", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    fakeProvider();
    const first = await send({});
    expect(first.status).toBe(200);
    const events = (await first.text())
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(
      events
        .filter((e) => e.delta)
        .map((e) => e.delta)
        .join(""),
    ).toBe("Xin chào");
    expect(events.at(-1).done).toBe(true);
    let history = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history[1].content).toBe("Xin chào");
    const regenerated = await send({ content: "", regenerate: true });
    expect(regenerated.status).toBe(200);
    await regenerated.text();
    history = await db.message.findMany({ where: { conversationId } });
    expect(history.filter((m) => m.role === "user")).toHaveLength(1);
    expect(history.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
  it("rejects cross-user attachment IDs before making a completion request", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    fakeProvider();
    const response = await send({ attachments: ["not-owned"] });
    expect(response.status).toBe(404);
  });
  it("reports a real configuration error instead of producing a fake answer", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "");
    const response = await send({});
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Chưa cấu hình");
  });
  it("rejects overlapping generations without deleting another request’s lease", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    await db.chatLease.create({
      data: {
        conversationId,
        token: "other-request",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    try {
      expect((await send({})).status).toBe(409);
      expect(
        (await db.chatLease.findUnique({ where: { conversationId } }))?.token,
      ).toBe("other-request");
    } finally {
      await db.chatLease.deleteMany({ where: { conversationId } });
    }
  });
  it("releases the lease after an upstream authentication failure", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "mock-model" }] })
          : new Response("private upstream details", { status: 401 }),
      ),
    );
    const response = await send({});
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private upstream details");
    expect(
      await db.chatLease.findUnique({ where: { conversationId } }),
    ).toBeNull();
  });
  it("stops the upstream stream on cancellation, stores partial output and releases the lease", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    let upstreamAborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (String(url).endsWith("/models"))
          return Response.json({ data: [{ id: "mock-model" }] });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"partial output"}}]}\n',
                ),
              );
              options.signal?.addEventListener(
                "abort",
                () => {
                  upstreamAborted = true;
                  controller.error(new Error("aborted"));
                },
                { once: true },
              );
            },
          }),
        );
      }),
    );
    const response = await send({});
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "partial output",
    );
    await reader.cancel();
    await vi.waitFor(async () => {
      expect(
        await db.chatLease.findUnique({ where: { conversationId } }),
      ).toBeNull();
    });
    expect(upstreamAborted).toBe(true);
    expect(
      await db.message.count({
        where: { conversationId, role: "assistant", content: "partial output" },
      }),
    ).toBe(1);
  });
  it("uses Responses input for persisted multi-turn history and image attachments", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-responses-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    const c = await db.conversation.create({ data: { userId: account.id } });
    await db.message.createMany({
      data: [
        {
          conversationId: c.id,
          role: "user",
          content: "Old question",
          createdAt: new Date(Date.now() - 2000),
        },
        {
          conversationId: c.id,
          role: "assistant",
          content: "Old answer",
          createdAt: new Date(Date.now() - 1000),
        },
      ],
    });
    const file = await db.attachment.create({
      data: {
        userId: account.id,
        name: "image.png",
        mime: "image/png",
        data: new Uint8Array([1, 2, 3]),
      },
    });
    const fetch = vi.fn(async (url: string) =>
      String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
        : new Response(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Responses answer"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await send({
      conversationId: c.id,
      model: "gpt-6.1-sol",
      content: "Describe the image",
      attachments: [file.id],
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Responses answer");
    const options = (
      fetch.mock.calls as unknown as [string, RequestInit][]
    ).find(([url]) => url.endsWith("/responses"))![1];
    const payload = JSON.parse(options.body as string);
    expect(payload).toMatchObject({
      model: "gpt-6.1-sol",
      stream: true,
      store: false,
    });
    expect(payload.instructions).toBeTruthy();
    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Old question" }] },
      { role: "assistant", content: "Old answer" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Describe the image" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AQID",
            detail: "auto",
          },
        ],
      },
    ]);
    const history = await db.message.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((m) => m.content)).toEqual([
      "Old question",
      "Old answer",
      "Describe the image",
      "Responses answer",
    ]);
  });
  it("keeps existing conversation history intact when Responses returns 403 during regeneration", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-responses-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    const c = await db.conversation.create({ data: { userId: account.id } });
    await db.message.createMany({
      data: [
        {
          conversationId: c.id,
          role: "user",
          content: "Preserve question",
          createdAt: new Date(Date.now() - 1000),
        },
        { conversationId: c.id, role: "assistant", content: "Preserve answer" },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
          : new Response("sensitive upstream body", { status: 403 }),
      ),
    );
    const response = await send({
      conversationId: c.id,
      model: "gpt-6.1-sol",
      content: "",
      regenerate: true,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "provider_forbidden",
      providerStatus: 403,
      protocol: "responses",
    });
    expect(
      (
        await db.message.findMany({
          where: { conversationId: c.id },
          orderBy: { createdAt: "asc" },
        })
      ).map((m) => m.content),
    ).toEqual(["Preserve question", "Preserve answer"]);
    expect(
      await db.chatLease.findUnique({ where: { conversationId: c.id } }),
    ).toBeNull();
  });
  it("rejects an unavailable Responses model before changing history", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-responses-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    const before = await db.message.count({ where: { conversationId } });
    const fetch = vi.fn(async () =>
      Response.json({ data: [{ id: "available-model" }] }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await send({ model: "unavailable-model" })).status).toBe(400);
    expect(await db.message.count({ where: { conversationId } })).toBe(before);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthenticated chat without making an upstream request", async () => {
    vi.spyOn(security, "user").mockRejectedValue(
      new security.HttpError(401, "Vui lòng đăng nhập."),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await send({})).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates Responses stream failures as safe diagnostics instead of success", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "test-responses-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    const c = await db.conversation.create({ data: { userId: account.id } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
          : new Response(
              'data: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"sensitive detail"}}}\n\n',
            ),
      ),
    );
    const response = await send({ conversationId: c.id, model: "gpt-6.1-sol" });
    const text = await response.text();
    expect(text).toContain('"code":"provider_failed"');
    expect(text).not.toContain("sensitive detail");
    expect(
      await db.message.count({
        where: { conversationId: c.id, role: "assistant" },
      }),
    ).toBe(0);
    expect(
      (
        await db.apiUsage.findFirst({
          where: { userId: account.id },
          orderBy: { createdAt: "desc" },
        })
      )?.success,
    ).toBe(false);
  });
  it("validates catalog membership and actual Responses access before the model selection endpoint succeeds", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "validation-endpoint-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    const fetch = vi.fn(async (url: string) =>
      String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
        : Response.json({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "OK" }],
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await POST(
      new NextRequest("http://localhost:3000/api/models/validate", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-6.1-sol" }),
      }),
      { params: Promise.resolve({ path: ["models", "validate"] }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "gpt-6.1-sol",
      access: "verified",
      wireApi: "responses",
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://provider.example/v1/models",
      "https://provider.example/v1/responses",
    ]);
  });
  it("stops a Responses route stream and preserves its partial output while releasing the lease", async () => {
    vi.spyOn(security, "user").mockResolvedValue(account);
    vi.stubEnv("XINGCHI_API_KEY", "responses-cancellation-key");
    vi.stubEnv("XINGCHI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "responses");
    let aborted = false;
    const c = await db.conversation.create({ data: { userId: account.id } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial Responses output"}\n\n',
                    ),
                  );
                  options.signal?.addEventListener(
                    "abort",
                    () => {
                      aborted = true;
                      controller.error(
                        new DOMException("Aborted", "AbortError"),
                      );
                    },
                    { once: true },
                  );
                },
              }),
            ),
      ),
    );
    const response = await send({ conversationId: c.id, model: "gpt-6.1-sol" });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "partial Responses output",
    );
    await reader.cancel();
    await vi.waitFor(async () =>
      expect(
        await db.chatLease.findUnique({ where: { conversationId: c.id } }),
      ).toBeNull(),
    );
    expect(aborted).toBe(true);
    expect(
      await db.message.count({
        where: {
          conversationId: c.id,
          role: "assistant",
          content: "partial Responses output",
        },
      }),
    ).toBe(1);
  });
});
