import { it, expect, vi, afterEach } from "vitest";
import sharp from "sharp";
import { extractText } from "../src/lib/ocr";
afterEach(() => vi.unstubAllEnvs());
it("extracts actual text using installed Tesseract (not an AI vision test)", async () => {
  vi.stubEnv("OCR_ENABLED", "true");
  vi.stubEnv("OCR_LANG", "eng");
  const image = await sharp(
    Buffer.from(
      '<svg width="1200" height="180"><rect width="1200" height="180" fill="white"/><text x="40" y="110" font-family="sans-serif" font-size="64" fill="black">CHATPAN DOCUMENT 2026</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  expect(await extractText(image)).toContain("CHATPAN DOCUMENT 2026");
});
it("does not claim OCR output when the capability is disabled", async () => {
  vi.stubEnv("OCR_ENABLED", "false");
  expect(await extractText(Buffer.from("anything"))).toBeNull();
});
