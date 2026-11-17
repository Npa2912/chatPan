// Opt-in: this creates one real image and may incur provider charges.
import "dotenv/config";
import { expect, it } from "vitest";
import sharp from "sharp";
import { generateImage } from "../../src/lib/image-generation";

it("receives a real, decodable generated image from the configured provider", async () => {
  if (!process.env.CHATPAN_OPENAI_API_KEY && !process.env.OPENAI_API_KEY)
    throw new Error(
      "OpenAI API key is missing. Configure OPENAI_API_KEY (CHATPAN_OPENAI_API_KEY in managed cloud) securely before running this billable test.",
    );
  const image = await generateImage(
    "A simple red square centered on a plain white background, minimalist geometric illustration, no text.",
    AbortSignal.timeout(240000),
  );
  const metadata = await sharp(image.data).metadata();
  expect(metadata.format).toBe("webp");
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
}, 270000);
