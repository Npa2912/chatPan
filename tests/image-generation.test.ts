import "dotenv/config";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import * as security from "../src/lib/security";
import { POST, GET } from "../src/app/api/[...path]/route";
import { wantsImage } from "../src/lib/image-intent";
import { generateImage } from "../src/lib/image-generation";

let account: Awaited<ReturnType<typeof db.user.create>>;
let conversationId: string;
let png: Buffer;
beforeAll(async () => {
  account = await db.user.create({
    data: {
      email: `image-test-${Date.now()}@example.com`,
      name: "Image test",
      password: "not-a-login-hash",
    },
  });
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
});
beforeEach(async () => {
  conversationId = (
    await db.conversation.create({ data: { userId: account.id } })
  ).id;
  vi.spyOn(security, "user").mockResolvedValue(account);
  vi.stubEnv("CHATPAN_OPENAI_API_KEY", "test-only");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
  vi.stubEnv("DEFAULT_IMAGE_MODEL", "gpt-image-1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { endsWith: account.id } } });
  await db.user.delete({ where: { id: account.id } });
  await db.$disconnect();
});
function send(data: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        content: "tạo ảnh wukong 3D đẹp",
        ...data,
      }),
    }),
    { params: Promise.resolve({ path: ["chat"] }) },
  );
}
function mockImage() {
  const fetch = vi.fn<
    (_url: string, _options: RequestInit) => Promise<Response>
  >(async () =>
    Response.json({ data: [{ b64_json: png.toString("base64") }] }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("routes direct image requests, but keeps explanatory questions as text", () => {
  for (const text of [
    "tạo ảnh wukong 3D đẹp",
    "Hãy vẽ một bức tranh con mèo",
    "create an image of a cat",
  ])
    expect(wantsImage(text)).toBe(true);
  for (const text of [
    "Làm sao để tạo ảnh?",
    "Giải thích API tạo ảnh",
    "Don't create an image",
  ])
    expect(wantsImage(text)).toBe(false);
  expect(wantsImage("A red cat", "image")).toBe(true);
  expect(wantsImage("tạo ảnh mèo", "text")).toBe(false);
});
it("generates an actual image via mocked upstream, persists chat/history, and protects image access", async () => {
  const fetch = mockImage();
  const response = await send({ content: "taoj anhr messi" });
  expect(response.status).toBe(200);
  const event = JSON.parse(await response.text());
  expect(event.success).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.openai.com/v1/images/generations",
  );
  const requestBody = JSON.parse(
    (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(requestBody).toMatchObject({
    model: "gpt-image-1",
    prompt: "taoj anhr messi",
    n: 1,
  });
  expect(requestBody).not.toHaveProperty("response_format");
  const history = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(history[1].content).toContain(`/api/images/${event.imageId}`);
  const saved = await db.generatedImage.findUniqueOrThrow({
    where: { id: event.imageId },
  });
  expect((await sharp(saved.data).metadata()).format).toBe("webp");
  const get = () =>
    GET(
      new NextRequest(
        `http://localhost:3000/api/images/${event.imageId}?download=1`,
      ),
      { params: Promise.resolve({ path: ["images", event.imageId] }) },
    );
  expect((await get()).headers.get("content-disposition")).toContain(
    "attachment",
  );
  vi.spyOn(security, "user").mockResolvedValue({
    ...account,
    id: "another-user",
  });
  expect((await get()).status).toBe(404);
  expect(await db.chatLease.count({ where: { conversationId } })).toBe(0);
});
it("supports explicit image mode without a chat model and preserves images when regeneration fails", async () => {
  mockImage();
  expect((await send({ content: "A red cat", task: "image" })).status).toBe(
    200,
  );
  const original = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: { code: "permission_denied" } }, { status: 403 }),
    ),
  );
  expect((await send({ content: "", regenerate: true })).status).toBe(502);
  expect(
    await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    }),
  ).toEqual(original);
  expect(await db.chatLease.count({ where: { conversationId } })).toBe(0);
});
it("rejects another user's conversation and missing configuration without calling upstream", async () => {
  const fetch = mockImage();
  expect((await send({ conversationId: "not-owned" })).status).toBe(404);
  vi.stubEnv("DEFAULT_IMAGE_MODEL", "");
  vi.stubEnv("CHATPAN_OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("XINGCHI_API_KEY", "");
  expect((await send()).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect(await db.message.count({ where: { conversationId } })).toBe(0);
  expect(await db.chatLease.count({ where: { conversationId } })).toBe(0);
});
it("rejects invalid image bytes and requests base64 from legacy image models", async () => {
  vi.stubEnv("DEFAULT_IMAGE_MODEL", "dall-e-3");
  const fetch = vi.fn<
    (_url: string, _options: RequestInit) => Promise<Response>
  >(async () =>
    Response.json({
      data: [{ b64_json: Buffer.from("not an image").toString("base64") }],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateImage("cat", new AbortController().signal),
  ).rejects.toThrow("tệp ảnh hợp lệ");
  expect(
    JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
      .response_format,
  ).toBe("b64_json");
});
