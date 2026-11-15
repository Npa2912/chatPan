import sharp from "sharp";
import { extractText } from "./ocr";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { HttpError } from "./security";
export async function parseUpload(file: File) {
  if (file.size > 8 * 1024 * 1024 || file.size === 0)
    throw new HttpError(400, "Tệp phải có dung lượng từ 1 byte đến 8 MB.");
  const data = Buffer.from(await file.arrayBuffer());
  if (file.type.startsWith("image/")) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new HttpError(400, "Chỉ hỗ trợ ảnh JPEG, PNG và WebP.");
    try {
      const clean = await sharp(data, { limitInputPixels: 25000000 })
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp()
        .toBuffer();
      return {
        mime: "image/webp",
        data: clean,
        text: await extractText(clean),
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Ảnh không hợp lệ hoặc có kích thước quá lớn.");
    }
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "txt" || ext === "csv") text = data.toString("utf8");
  else if (ext === "pdf") {
    if (data.subarray(0, 5).toString() !== "%PDF-")
      throw new HttpError(400, "PDF không hợp lệ.");
    const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default;
    text = (await pdf(data)).text;
  } else if (ext === "docx")
    text = (await mammoth.extractRawText({ buffer: data })).value;
  else if (ext === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as never);
    for (const sheet of workbook.worksheets) {
      text += `\n[${sheet.name}]\n`;
      sheet.eachRow((row) => {
        text += JSON.stringify(row.values) + "\n";
        if (text.length > 200000)
          throw new HttpError(400, "Bảng tính có quá nhiều dữ liệu.");
      });
    }
  } else
    throw new HttpError(
      400,
      "Hỗ trợ JPEG, PNG, WebP, PDF, DOCX, TXT, CSV và XLSX.",
    );
  if (text.length > 200000)
    throw new HttpError(400, "Văn bản vượt giới hạn 200.000 ký tự.");
  const mime =
    ext === "pdf"
      ? "application/pdf"
      : ext === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : ext === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : ext === "csv"
            ? "text/csv"
            : "text/plain";
  return { mime, data, text };
}
