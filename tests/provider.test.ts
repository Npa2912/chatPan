import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSSE, providerConfig, provider } from "../src/lib/provider";
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
