import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { db } from "./db";
import { tokenHash, HttpError } from "./security";
export async function sendToken(email: string, purpose: "verify" | "reset") {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
    throw new HttpError(
      503,
      "Email chưa được cấu hình. Quản trị viên cần cấu hình SMTP để gửi liên kết.",
    );
  const token = randomBytes(32).toString("hex");
  await db.emailToken.create({
    data: {
      hash: tokenHash(token),
      email,
      purpose,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const url = `${process.env.APP_URL}/?action=${purpose}&token=${token}`;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: true,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject:
        purpose === "verify"
          ? "Xác minh email chatPan"
          : "Đặt lại mật khẩu chatPan",
      text: `Mở liên kết sau trong vòng 1 giờ: ${url}\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
  } catch {
    throw new HttpError(502, "Không thể gửi email. Vui lòng thử lại sau.");
  }
}
