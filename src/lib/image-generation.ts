import sharp from "sharp";
import { provider } from "./provider";
import { HttpError } from "./security";

export async function generateImage(prompt: string, signal: AbortSignal) {
  const model =
    process.env.DEFAULT_IMAGE_MODEL?.trim() ||
    (process.env.CHATPAN_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      ? "gpt-image-2.6-sunburst"
      : undefined);
  if (!model)
    throw new HttpError(
      503,
      "Chưa cấu hình model tạo ảnh. Quản trị viên cần đặt DEFAULT_IMAGE_MODEL và API key có quyền tạo ảnh trên server.",
    );
  if (model === "gpt-image-1")
    throw new HttpError(
      503,
      "gpt-image-1 đã ngừng hoạt động từ 23/10/2026. Đổi DEFAULT_IMAGE_MODEL=gpt-image-2.6-sunburst trong cấu hình server rồi khởi động lại.",
    );
  const response = await provider(
    "images/generations",
    {
      model,
      prompt,
      n: 1,
      size: "1024x1024",
      // GPT Image returns base64 by default and does not accept response_format.
      ...(/^(?:gpt-image-|chatgpt-image-)/i.test(model)
        ? {}
        : { response_format: "b64_json" }),
    },
    signal,
  );
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "Nhà cung cấp không trả dữ liệu ảnh.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 24 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError(502, "Ảnh trả về quá lớn.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let encoded: unknown;
  try {
    encoded = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.data?.[0]
      ?.b64_json;
  } catch {
    throw new HttpError(502, "Nhà cung cấp trả dữ liệu ảnh không hợp lệ.");
  }
  if (typeof encoded !== "string" || !encoded.length)
    throw new HttpError(
      502,
      "Nhà cung cấp chưa trả ảnh base64. Hãy dùng model hỗ trợ images/generations và b64_json.",
    );
  const raw = Buffer.from(encoded, "base64");
  if (raw.length > 16 * 1024 * 1024)
    throw new HttpError(502, "Ảnh trả về quá lớn.");
  let data: Buffer;
  try {
    data = await sharp(raw, { limitInputPixels: 25000000 }).webp().toBuffer();
  } catch {
    throw new HttpError(502, "Nhà cung cấp không trả tệp ảnh hợp lệ.");
  }
  signal.throwIfAborted();
  return { model, data: new Uint8Array(data) };
}
