import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "./security";
const exec = promisify(execFile);
export async function extractText(data: Buffer): Promise<string | null> {
  if (process.env.OCR_ENABLED !== "true") return null;
  const lang = process.env.OCR_LANG || "eng";
  if (!/^[a-z+_]+$/.test(lang))
    throw new HttpError(503, "OCR_LANG không hợp lệ.");
  const dir = await mkdtemp(join(tmpdir(), "chatpan-ocr-"));
  try {
    const path = join(dir, "image.webp");
    await writeFile(path, data, { mode: 0o600 });
    const { stdout } = await exec("tesseract", [path, "stdout", "-l", lang], {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
    return stdout.trim().slice(0, 30000);
  } catch {
    throw new HttpError(
      503,
      "OCR không hoạt động. Kiểm tra Tesseract và gói ngôn ngữ trên server.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
