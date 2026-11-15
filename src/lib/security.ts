import { createHash, randomBytes } from "node:crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { db } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
async function authSession(ttl = 60 * 60 * 24 * 30) {
  const password = process.env.AUTH_SECRET;
  if (!password || password.length < 32)
    throw new HttpError(
      503,
      "AUTH_SECRET cần được cấu hình an toàn trên server (ít nhất 32 ký tự).",
    );
  return getIronSession<{ token?: string }>(await cookies(), {
    password,
    cookieName: "chatpan_session",
    ttl,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      sameSite: "lax",
      path: "/",
    },
  });
}
export async function user() {
  if (!(await cookies()).has("chatpan_session"))
    throw new HttpError(401, "Vui lòng đăng nhập.");
  const { token } = await authSession();
  if (!token) throw new HttpError(401, "Phiên đăng nhập không hợp lệ.");
  const session = await db.session.findUnique({
    where: { id: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date())
    throw new HttpError(401, "Phiên đăng nhập đã hết hạn.");
  return session.user;
}
export async function createSession(userId: string, remember = true) {
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const session = await authSession(maxAge);
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + maxAge * 1000),
    },
  });
  session.token = token;
  await session.save();
}
export async function endSession() {
  const session = await authSession();
  if (session.token)
    await db.session.deleteMany({ where: { id: tokenHash(session.token) } });
  session.destroy();
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL || new URL(request.url).origin;
  if (origin !== expected)
    throw new HttpError(403, "Nguồn yêu cầu không hợp lệ.");
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const bucket = `${key}:${Math.floor(Date.now() / (seconds * 1000))}`;
  // Shared PostgreSQL counter: survives process restarts and works across instances.
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${bucket}, 1, ${new Date(Date.now() + seconds * 2000)}) ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1 RETURNING "count"`;
  if (rows[0].count > limit)
    throw new HttpError(429, "Quá nhiều yêu cầu. Vui lòng thử lại sau.");
  await db.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < NOW()`;
}
