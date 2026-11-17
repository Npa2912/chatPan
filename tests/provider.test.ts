import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseSSE,
  providerConfig,
  provider,
  wireApi,
} from "../src/lib/provider";
function stream(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
      controller.close();
    },
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Provider adapter — explicit mocked upstream tests", () => {
  it.each([
    [
      { code: "content_policy_violation" },
      "image_request_rejected",
      "từ chối nội dung",
    ],
    [{ code: "billing_hard_limit_reached" }, "provider_quota", "thanh toán"],
    [
      { message: "Your organization must be verified to use this model." },
      "organization_verification_required",
      "xác minh tổ chức",
    ],
    [
      { code: null, param: "response_format" },
      "provider_bad_request",
      "response_format",
    ],
    [{ code: null, param: "model" }, "provider_bad_request", "model"],
    [
      { code: "secret-unknown-code", param: "secret-unknown-param" },
      "provider_bad_request",
      "HTTP 400",
    ],
  ])(
    "reports actionable, sanitized HTTP 400 errors: %j",
    async (error, code, message) => {
      vi.stubEnv("CHATPAN_OPENAI_API_KEY", "test-only");
      vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { message: "secret-raw-upstream-message", ...error } },
              { status: 400 },
            ),
          ),
      );
      const result = await provider("images/generations", {
        model: "gpt-image-2.6-sunburst",
        prompt: "cat",
      }).catch((e) => e);
      expect(result.code).toBe(code);
      expect(result.message).toContain(message);
      expect(result.message).not.toContain("secret-");
      expect(result.upstreamStatus).toBe(400);
    },
  );
  it("uses OpenAI directly and never inherits a legacy third-party URL or protocol", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-only");
    vi.stubEnv("CHATPAN_OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("XINGCHI_BASE_URL", "https://legacy.example/v1");
    vi.stubEnv("XINGCHI_WIRE_API", "chat_completions");
    expect(providerConfig()).toEqual({
      key: "openai-test-only",
      base: "https://api.openai.com/v1",
    });
    expect(wireApi("gpt-4.1")).toBe("responses");
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    await provider("models");
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer openai-test-only",
    );
  });
  it("supports the managed-cloud alias for the OpenAI API key", () => {
    vi.stubEnv("CHATPAN_OPENAI_API_KEY", "cloud-test-only");
    vi.stubEnv("OPENAI_BASE_URL", "");
    expect(providerConfig()).toEqual({
      key: "cloud-test-only",
      base: "https://api.openai.com/v1",
    });
  });
  it("requires server credentials", () => {
    vi.stubEnv("XINGCHI_API_KEY", "");
    expect(() => providerConfig()).toThrow("Chưa cấu hình");
  });
  it("rejects private and non-TLS destinations", () => {
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    for (const base of [
      "http://example.com/v1",
      "https://127.0.0.1/v1",
      "https://localhost/v1",
    ]) {
      vi.stubEnv("XINGCHI_BASE_URL", base);
      expect(() => providerConfig()).toThrow();
    }
  });
  it("parses SSE split across arbitrary network chunks", async () => {
    const result = [];
    for await (const s of parseSSE(
      stream([
        "da",
        'ta: {"choices":[{"delta":{"content":"Xin "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"chào"}}]}\n',
        "data: [DONE]\n",
      ]),
    ))
      result.push(s);
    expect(result.join("")).toBe("Xin chào");
  });
  it("reports in-stream provider errors", async () => {
    await expect(async () => {
      for await (const value of parseSSE(
        stream(['data: {"error":{"message":"private upstream error"}}\n']),
      )) {
        void value;
      }
    }).rejects.toThrow("Nhà cung cấp không thể hoàn tất");
  });
  it("does not fabricate content on malformed JSON", async () => {
    await expect(async () => {
      for await (const value of parseSSE(stream(["data: invalid\n"]))) {
        void value;
      }
    }).rejects.toThrow("JSON");
  });
  it("maps rate limits without leaking provider response", async () => {
    vi.stubEnv("XINGCHI_API_KEY", "test-only");
    vi.stubEnv("XINGCHI_BASE_URL", "https://example.com/v1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret upstream details", { status: 429 }),
        ),
    );
    await expect(provider("models")).rejects.toThrow("hạn mức");
  });
  it("does not classify a truncated response as a completed generation", async () => {
    await expect(async () => {
      for await (const value of parseSSE(
        stream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n']),
      )) {
        void value;
      }
    }).rejects.toThrow("trước khi hoàn tất");
  });
  it("handles a final DONE marker without a trailing newline", async () => {
    const output = [];
    for await (const value of parseSSE(
      stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]']),
    ))
      output.push(value);
    expect(output.join("")).toBe("ok");
  });
});
