import "dotenv/config";
import {
  beforeAll,
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
});
