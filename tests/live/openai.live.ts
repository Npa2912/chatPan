// Opt-in, potentially billable live verification. No mocks and no credential values in output.
import "dotenv/config";
import { it, expect } from "vitest";
import { models, openChat } from "../../src/lib/provider";
it("discovers and receives a genuine Responses completion from OpenAI chat model", async () => {
  if (!process.env.OPENAI_API_KEY && !process.env.CHATPAN_OPENAI_API_KEY)
    throw new Error(
      "Live verification blocked: OPENAI_API_KEY is not injected into this runtime. Enter it securely in environment settings; never paste it in logs or chat.",
    );
  const model = process.env.DEFAULT_CHAT_MODEL || "gpt-4.1";
  const signal = AbortSignal.timeout(100000);
  const catalog = await models(signal);
  expect(catalog.some((entry: { id: string }) => entry.id === model)).toBe(
    true,
  );
  const { protocol, deltas } = await openChat(
    model,
    [{ role: "user", content: "Reply with only OK." }],
    signal,
    256,
  );
  expect(protocol).toBe("responses");
  let text = "";
  for await (const delta of deltas) text += delta;
  expect(text.trim().length).toBeGreaterThan(0);
});
