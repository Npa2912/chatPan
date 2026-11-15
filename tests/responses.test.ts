import { describe, it, expect, vi, afterEach } from "vitest";
import {
  chatRequest,
  openChat,
  parseResponsesSSE,
  wireApi,
  models,
  validateModelAccess,
  ProviderError,
} from "../src/lib/provider";
function stream(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
}
const complete =
  'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
async function collect(source: AsyncIterable<string>) {
  let result = "";
  for await (const delta of source) result += delta;
  return result;
}
function config() {
  vi.stubEnv("XINGCHI_API_KEY", "mock-responses-key");
  vi.stubEnv("XINGCHI_BASE_URL", "https://api.xingchiapi.com/v1");
  vi.stubEnv("XINGCHI_WIRE_API", "responses");
  vi.stubEnv("XINGCHI_MODEL_WIRE_API", "{}");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Responses API — explicitly mocked provider", () => {
  it("uses Responses by default and supports explicit per-model Chat Completions overrides", () => {
    vi.stubEnv("XINGCHI_WIRE_API", "");
    vi.stubEnv("XINGCHI_MODEL_WIRE_API", '{"legacy":"chat_completions"}');
    expect(wireApi("gpt-6.1-sol")).toBe("responses");
    expect(wireApi("legacy")).toBe("chat_completions");
    expect(
      chatRequest("legacy", [{ role: "user", content: "hello" }]).path,
    ).toBe("chat/completions");
  });
  it("fails closed on malformed protocol configuration", () => {
    vi.stubEnv("XINGCHI_MODEL_WIRE_API", '{"legacy":"unknown"}');
    expect(() => wireApi("legacy")).toThrow("Cấu hình");
  });
  it("formats instructions, previous assistant turns, user text and images without reusing provider response IDs", () => {
    const request = chatRequest(
      "gpt-6.1-sol",
      [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "First question" },
        { role: "assistant", content: "Previous answer" },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aGVsbG8=" },
            },
          ],
        },
      ],
      "responses",
    );
    expect(request).toEqual({
      path: "responses",
      body: {
        model: "gpt-6.1-sol",
        instructions: "Be helpful.",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "First question" }],
          },
          { role: "assistant", content: "Previous answer" },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Describe this" },
              {
                type: "input_image",
                image_url: "data:image/png;base64,aGVsbG8=",
                detail: "auto",
              },
            ],
          },
        ],
        stream: true,
        store: false,
      },
    });
  });
  it("parses named SSE events, split CRLF frames and multi-line JSON; never renders reasoning or tool arguments", async () => {
    const raw =
      ': heartbeat\r\nevent: response.created\r\ndata: {"type":"response.created"}\r\n\r\nevent: response.reasoning_summary_text.delta\r\ndata: {"type":"response.reasoning_summary_text.delta","delta":"private reasoning"}\r\n\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"Xin chào"}\r\n\r\nevent: response.function_call_arguments.delta\r\ndata: {"type":"response.function_call_arguments.delta","delta":"tool args"}\r\n\r\n' +
      complete;
    expect(
      await collect(parseResponsesSSE(stream([...raw].map((char) => char)))),
    ).toBe("Xin chào");
  });
  it("does not duplicate streamed output when completion also contains full output", async () => {
    expect(
      await collect(
        parseResponsesSSE(
          stream([
            'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
            'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}\n\n',
          ]),
        ),
      ),
    ).toBe("OK");
  });
  it("extracts genuine output from a completed JSON response", async () => {
    config();
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Verified mock output" }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await openChat(
      "gpt-6.1-sol",
      [{ role: "user", content: "hello" }],
      new AbortController().signal,
    );
    expect(await collect(result.deltas)).toBe("Verified mock output");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.xingchiapi.com/v1/responses",
    );
    const options = fetch.mock.calls[0][1];
    expect(Object.keys(options.headers).sort()).toEqual([
      "Authorization",
      "Content-Type",
    ]);
    expect(JSON.parse(options.body)).toMatchObject({
      stream: true,
      store: false,
    });
  });
  it("extracts completion output when a stream contains no text deltas", async () => {
    expect(
      await collect(
        parseResponsesSSE(
          stream([
            'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Actual output"}]}]}}',
          ]),
        ),
      ),
    ).toBe("Actual output");
  });
  it.each([
    ["response.failed", "provider_failed"],
    ["response.incomplete", "provider_incomplete"],
    ["error", "provider_failed"],
  ])("reports %s instead of a fabricated success", async (type, code) => {
    await expect(
      collect(
        parseResponsesSSE(
          stream([
            `data: ${JSON.stringify({ type, response: { status: "failed", error: { code: "server_error", message: "secret detail" } }, message: "secret detail" })}\n\n`,
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code });
  });
  it("reports stream permission errors using safe diagnostic codes", async () => {
    await expect(
      collect(
        parseResponsesSSE(
          stream([
            'data: {"type":"error","code":"permission_denied","message":"private upstream content"}\n\n',
          ]),
        ),
      ),
    ).rejects.toMatchObject({
      code: "provider_forbidden",
      protocol: "responses",
    });
  });
  it("rejects malformed events, missing delta text and truncated streams", async () => {
    for (const data of [
      "data: not-json\n\n",
      "data: null\n\n",
      'data: {"type":"response.output_text.delta"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      "data: [DONE]\n\n",
    ])
      await expect(
        collect(parseResponsesSSE(stream([data]))),
      ).rejects.toBeInstanceOf(ProviderError);
  });
  it.each([
    [401, "provider_unauthorized"],
    [403, "provider_forbidden"],
    [404, "unsupported_endpoint"],
    [429, "provider_rate_limit"],
    [500, "provider_failed"],
  ])(
    "handles upstream HTTP %i without forwarding its raw body or changing endpoints",
    async (status, code) => {
      config();
      const fetch = vi.fn().mockResolvedValue(
        new Response("private body and credentials", {
          status: status as number,
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        openChat(
          "gpt-6.1-sol",
          [{ role: "user", content: "hello" }],
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code,
        upstreamStatus: status,
        protocol: "responses",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("maps invalid model error codes even when the provider returns HTTP 400", async () => {
    config();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "model_not_found", message: "private detail" } },
            { status: 400 },
          ),
        ),
    );
    await expect(
      openChat(
        "missing",
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "invalid_model", upstreamStatus: 400 });
  });
  it("cancels the underlying SSE reader when the consumer stops", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          ),
        );
      },
      cancel: cancelled,
    });
    const iterator = parseResponsesSSE(body);
    expect((await iterator.next()).value).toBe("partial");
    await iterator.return();
    expect(cancelled).toHaveBeenCalled();
  });
  it("forwards cancellation to fetch and preserves an AbortError", async () => {
    config();
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            options.signal!.addEventListener(
              "abort",
              () => reject(options.signal!.reason),
              { once: true },
            ),
          ),
      ),
    );
    const pending = openChat(
      "gpt-6.1-sol",
      [{ role: "user", content: "hello" }],
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("reports transport failures safely", async () => {
    config();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("sensitive network details")),
    );
    await expect(
      openChat(
        "gpt-6.1-sol",
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_network", upstreamStatus: null });
  });
  it("prefers gpt-6.1-sol only when present and keeps catalog access unverified until a successful probe", async () => {
    config();
    vi.stubEnv("DEFAULT_CHAT_MODEL", "");
    vi.stubEnv("XINGCHI_API_KEY", "unique-probe-cache-key");
    const fetch = vi.fn(async (url: string) =>
      String(url).endsWith("/models")
        ? Response.json({
            data: [{ id: "gpt-6-astra" }, { id: "gpt-6.1-sol" }],
          })
        : new Response(
            'data: {"type":"response.output_text.delta","delta":"OK"}\n\n' +
              complete,
            { headers: { "Content-Type": "text/event-stream" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);
    const catalog = await models();
    expect(catalog.find((m: { default: boolean }) => m.default)).toMatchObject({
      id: "gpt-6.1-sol",
      access: "unverified",
    });
    expect(
      await validateModelAccess("gpt-6.1-sol", new AbortController().signal),
    ).toMatchObject({ access: "verified" });
    expect(
      (await models()).find((m: { id: string }) => m.id === "gpt-6.1-sol")
        ?.access,
    ).toBe("verified");
    await validateModelAccess("gpt-6.1-sol", new AbortController().signal);
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/responses")),
    ).toHaveLength(1);
    vi.stubEnv("XINGCHI_API_KEY", "rotated-key");
    expect(
      (await models()).find((m: { id: string }) => m.id === "gpt-6.1-sol")
        ?.access,
    ).toBe("unverified");
  });
  it("does not probe a model missing from the authenticated catalog", async () => {
    config();
    const fetch = vi.fn(async () => Response.json({ data: [{ id: "other" }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      validateModelAccess("gpt-6.1-sol", new AbortController().signal),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await models()).some((m: { default: boolean }) => m.default)).toBe(
      false,
    );
  });
  it("does not mark catalog membership as permission when inference is forbidden", async () => {
    config();
    vi.stubEnv("XINGCHI_API_KEY", "forbidden-probe-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
          : new Response("private details", { status: 403 }),
      ),
    );
    await expect(
      validateModelAccess("gpt-6.1-sol", new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider_forbidden" });
    expect((await models())[0].access).toBe("unverified");
  });
  it("invalidates a previous access probe when a Responses stream reports revoked permission", async () => {
    config();
    vi.stubEnv("XINGCHI_API_KEY", "revoked-stream-cache-key");
    let revoked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [{ id: "gpt-6.1-sol" }] })
          : revoked
            ? new Response(
                'data: {"type":"error","code":"permission_denied"}\n\n',
              )
            : Response.json({
                status: "completed",
                output: [
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "OK" }],
                  },
                ],
              }),
      ),
    );
    await validateModelAccess("gpt-6.1-sol", new AbortController().signal);
    expect((await models())[0].access).toBe("verified");
    revoked = true;
    const { deltas } = await openChat(
      "gpt-6.1-sol",
      [{ role: "user", content: "hello" }],
      new AbortController().signal,
    );
    await expect(collect(deltas)).rejects.toMatchObject({
      code: "provider_forbidden",
    });
    expect((await models())[0].access).toBe("unverified");
  });
});
