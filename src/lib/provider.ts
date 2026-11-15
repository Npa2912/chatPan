import { HttpError } from "./security";
export function providerConfig() {
  const key = process.env.XINGCHI_API_KEY;
  const base = process.env.XINGCHI_BASE_URL;
  if (!key || !base)
    throw new HttpError(
      503,
      "Chưa cấu hình nhà cung cấp AI. Quản trị viên cần đặt XINGCHI_API_KEY và XINGCHI_BASE_URL trên server.",
    );
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    /^(localhost$|0\.|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|\[)/.test(
      url.hostname,
    )
  )
    throw new HttpError(503, "Địa chỉ nhà cung cấp phải là HTTPS công khai.");
  return { key, base: base.replace(/\/$/, "") };
}
export async function provider(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const { key, base } = providerConfig();
  const response = await fetch(`${base}/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "API key không hợp lệ.",
      403: "Nhà cung cấp từ chối quyền truy cập.",
      404: "Endpoint hoặc model không được hỗ trợ.",
      429: "Nhà cung cấp hết hạn mức hoặc đang giới hạn tốc độ.",
      402: "Tài khoản nhà cung cấp không đủ số dư.",
    };
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      messages[response.status] ||
        `Nhà cung cấp gặp lỗi HTTP ${response.status}.`,
    );
  }
  return response;
}
export async function models() {
  const data = await (await provider("models")).json();
  if (!Array.isArray(data.data))
    throw new HttpError(502, "Danh sách model không hợp lệ.");
  return data.data
    .filter((m: { id?: unknown }) => typeof m.id === "string")
    .map((m: { id: string }) => ({
      id: m.id,
      default: m.id === process.env.DEFAULT_CHAT_MODEL,
      capabilities: "Chưa xác minh",
    }));
}
export async function* parseSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done && buffer && !buffer.endsWith("\n")) buffer += "\n";
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") return;
        if (!raw) continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new HttpError(502, "Luồng AI trả về JSON không hợp lệ.");
        }
        if (data.error)
          throw new HttpError(
            502,
            "Nhà cung cấp báo lỗi trong luồng phản hồi.",
          );
        if (data.choices?.[0]?.finish_reason) finished = true;
        const delta = data.choices?.[0]?.delta?.content;
        if (typeof delta === "string") yield delta;
      }
      if (done) {
        if (!finished)
          throw new HttpError(502, "Luồng AI kết thúc trước khi hoàn tất.");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
