import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { parseUpload } from "../src/lib/uploads";
describe("Secure upload parsing", () => {
  it("extracts actual UTF-8 document content", async () => {
    const result = await parseUpload(
      new File(["Xin chào, chatPan"], "hello.txt", { type: "text/plain" }),
    );
    expect(result.text).toBe("Xin chào, chatPan");
  });
  it("rejects an executable disguised as an image", async () => {
    await expect(
      parseUpload(
        new File(["not an image"], "evil.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("Ảnh không hợp lệ");
  });
  it("re-encodes valid image and strips unsafe original payload", async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const result = await parseUpload(
      new File([new Uint8Array(png)], "red.png", { type: "image/png" }),
    );
    expect(result.mime).toBe("image/webp");
    expect((await sharp(result.data).metadata()).format).toBe("webp");
  });
  it("rejects oversized uploads", async () => {
    await expect(
      parseUpload(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.txt")),
    ).rejects.toThrow("8 MB");
  });
  it("rejects unsupported HTML", async () => {
    await expect(
      parseUpload(new File(["<script>alert(1)</script>"], "page.html")),
    ).rejects.toThrow("Hỗ trợ");
  });
});
