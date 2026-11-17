import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./security";

export type WireApi = "responses" | "chat_completions";
export type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContent[];
};
export class ProviderError extends HttpError {
  constructor(
    public code: string,
    message: string,
    public upstreamStatus: number | null = null,
    public protocol?: WireApi,
    status = 502,
  ) {
    super(status, message);
  }
}
const wireSchema = z.enum(["responses", "chat_completions"]);
const probeCache = new Map<string, number>();
const PROBE_TTL = 5 * 60 * 1000;
export function providerConfig() {
  const openaiKey =
    process.env.CHATPAN_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const key = openaiKey || process.env.XINGCHI_API_KEY;
  // OpenAI credentials must never inherit a legacy third-party base URL.
  const base = openaiKey
    ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    : process.env.XINGCHI_BASE_URL;
  if (!key || !base)
    throw new HttpError(
      503,
      "Chưa cấu hình API OpenAI. Quản trị viên cần đặt OPENAI_API_KEY (hoặc CHATPAN_OPENAI_API_KEY trong môi trường cloud) trên server.",
    );
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new HttpError(503, "Base URL của nhà cung cấp không hợp lệ.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /^(localhost$|0\.|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|\[)/.test(
      url.hostname,
    )
  )
    throw new HttpError(503, "Địa chỉ nhà cung cấp phải là HTTPS công khai.");
  return { key, base: base.replace(/\/$/, "") };
}
export function wireApi(model: string): WireApi {
  try {
    const directOpenAI = !!(
      process.env.CHATPAN_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    );
    const fallback = wireSchema.parse(
      (directOpenAI
        ? process.env.OPENAI_WIRE_API
        : process.env.XINGCHI_WIRE_API) || "responses",
    );
    const overrides = z
      .record(z.string(), wireSchema)
      .parse(
        JSON.parse(
          (directOpenAI
            ? process.env.OPENAI_MODEL_WIRE_API
            : process.env.XINGCHI_MODEL_WIRE_API) || "{}",
        ),
      );
    return Object.hasOwn(overrides, model) ? overrides[model] : fallback;
  } catch {
    throw new HttpError(
      503,
      "Cấu hình WIRE_API hoặc MODEL_WIRE_API của nhà cung cấp không hợp lệ.",
    );
  }
}
function upstreamError(
  status: number | null,
  code?: string,
  protocol?: WireApi,
  param?: string,
) {
  if (
    [401, 403, 404].includes(status || 0) ||
    [
      "invalid_api_key",
      "authentication_error",
      "permission_denied",
      "model_access_denied",
      "model_not_found",
      "invalid_model",
    ].includes(code || "")
  )
    probeCache.clear();
  const detail = status ? ` (HTTP ${status})` : "";
  if (code === "organization_verification_required")
    return new ProviderError(
      "organization_verification_required",
      "OpenAI yêu cầu xác minh tổ chức để dùng model này. Kiểm tra Verification trong cài đặt tổ chức OpenAI" +
        detail +
        ".",
      status,
      protocol,
    );
  if (["content_policy_violation", "moderation_blocked"].includes(code || ""))
    return new ProviderError(
      "image_request_rejected",
      "OpenAI từ chối nội dung yêu cầu. Hãy thử một mô tả khác" + detail + ".",
      status,
      protocol,
    );
  if (
    [
      "billing_hard_limit_reached",
      "billing_limit_reached",
      "insufficient_quota",
    ].includes(code || "")
  )
    return new ProviderError(
      "provider_quota",
      "Project OpenAI đã hết hạn mức hoặc chạm giới hạn thanh toán. Kiểm tra Billing và Limits trong OpenAI Platform" +
        detail +
        ".",
      status,
      protocol,
    );
  if (
    status === 401 ||
    code === "invalid_api_key" ||
    code === "authentication_error"
  )
    return new ProviderError(
      "provider_unauthorized",
      "API key của nhà cung cấp không hợp lệ hoặc đã hết hạn" + detail + ".",
      status,
      protocol,
    );
  if (
    status === 403 ||
    code === "permission_denied" ||
    code === "model_access_denied"
  )
    return new ProviderError(
      "provider_forbidden",
      "Nhà cung cấp từ chối quyền truy cập model hoặc endpoint" +
        detail +
        ". Kiểm tra quyền của API key và giao thức đã cấu hình.",
      status,
      protocol,
    );
  if (code === "model_not_found" || code === "invalid_model")
    return new ProviderError(
      "invalid_model",
      "Model không tồn tại hoặc API key không được phép sử dụng model này.",
      status,
      protocol,
    );
  if (status === 404)
    return new ProviderError(
      "unsupported_endpoint",
      "Endpoint hoặc model không được nhà cung cấp hỗ trợ (HTTP 404).",
      status,
      protocol,
    );
  if (
    status === 429 ||
    code === "rate_limit_exceeded" ||
    code === "insufficient_quota"
  )
    return new ProviderError(
      "provider_rate_limit",
      "Nhà cung cấp hết hạn mức hoặc đang giới hạn tốc độ.",
      status,
      protocol,
      429,
    );
  if (status === 402)
    return new ProviderError(
      "provider_balance",
      "Tài khoản nhà cung cấp không đủ số dư.",
      status,
      protocol,
    );
  if (status === 400) {
    // Only known parameter names may appear in the UI. Never return raw error
    // messages, unknown codes, request data, or credentials from the provider.
    const knownParam = [
      "model",
      "size",
      "n",
      "quality",
      "response_format",
      "prompt",
      "output_format",
    ].includes(param || "")
      ? param
      : undefined;
    return new ProviderError(
      "provider_bad_request",
      knownParam === "model"
        ? "OpenAI không chấp nhận model đã cấu hình (HTTP 400). Kiểm tra DEFAULT_IMAGE_MODEL cho tạo ảnh và quyền truy cập model của project."
        : knownParam
          ? `OpenAI không chấp nhận tham số ${knownParam} (HTTP 400). Kiểm tra model và tham số tương thích của endpoint.`
          : "OpenAI từ chối yêu cầu (HTTP 400). Kiểm tra model, tham số và quyền của project; phản hồi không cung cấp mã lỗi cụ thể được nhận diện.",
      status,
      protocol,
    );
  }
  return new ProviderError(
    "provider_failed",
    "Nhà cung cấp không thể hoàn tất yêu cầu" + detail + ".",
    status,
    protocol,
  );
}
export async function provider(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const { key, base } = providerConfig();
  const protocol =
    path === "responses"
      ? "responses"
      : path === "chat/completions"
        ? "chat_completions"
        : undefined;
  const timeout = AbortSignal.timeout(
    path === "models"
      ? 10000
      : path === "images/generations"
        ? 240000
        : signal
          ? 90000
          : 30000,
  );
  let response: Response;
  try {
    response = await fetch(`${base}/${path}`, {
      method: body ? "POST" : "GET",
      // No application-specific or undocumented provider headers.
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new ProviderError(
      timeout.aborted ? "provider_timeout" : "provider_network",
      timeout.aborted
        ? "Nhà cung cấp phản hồi quá thời gian cho phép."
        : "Không thể kết nối nhà cung cấp. Kiểm tra kết nối và chính sách mạng của môi trường.",
      null,
      protocol,
      timeout.aborted ? 504 : 502,
    );
  }
  if (!response.ok) {
    let code: string | undefined;
    let param: string | undefined;
    try {
      const data = await response.json();
      if (typeof data?.error?.code === "string") code = data.error.code;
      if (typeof data?.error?.param === "string") param = data.error.param;
      // Some OpenAI verification errors have no structured code. Classify
      // their message locally, but never expose or log the message itself.
      if (
        typeof data?.error?.message === "string" &&
        /organization.{0,80}(?:must be verified|verification required|needs to be verified)/i.test(
          data.error.message,
        )
      )
        code = "organization_verification_required";
    } catch {
      /* Never expose raw upstream bodies. */
    }
    throw upstreamError(response.status, code, protocol, param);
  }
  return response;
}
function accessKey(model: string) {
  const { base, key } = providerConfig();
  return createHash("sha256")
    .update(JSON.stringify([base, key, model, wireApi(model)]))
    .digest("hex");
}
export async function models(signal?: AbortSignal) {
  const response = await provider("models", undefined, signal);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError(
      "invalid_response",
      "Danh sách model không phải JSON hợp lệ.",
    );
  }
  if (!Array.isArray(data?.data))
    throw new ProviderError(
      "invalid_response",
      "Danh sách model không hợp lệ.",
    );
  const preferred =
    process.env.DEFAULT_CHAT_MODEL ||
    (process.env.CHATPAN_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      ? "gpt-4.1"
      : "gpt-6.1-sol");
  return data.data
    .filter((m: { id?: unknown } | null) => m && typeof m.id === "string")
    .map((m: { id: string }) => ({
      id: m.id,
      default: m.id === preferred,
      wireApi: wireApi(m.id),
      access:
        (probeCache.get(accessKey(m.id)) || 0) > Date.now()
          ? "verified"
          : "unverified",
      capabilities: "Chưa xác minh",
    }));
}
export async function requireModel(model: string, signal?: AbortSignal) {
  if (!(await models(signal)).some((m: { id: string }) => m.id === model))
    throw new HttpError(400, "Model không có trong danh sách nhà cung cấp.");
}
function textContent(content: ChatMessage["content"]) {
  return typeof content === "string"
    ? content
    : content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}
export function chatRequest(
  model: string,
  messages: ChatMessage[],
  protocol = wireApi(model),
  maxOutputTokens?: number,
) {
  if (protocol === "chat_completions")
    return {
      path: "chat/completions",
      body: {
        model,
        messages,
        stream: true,
        ...(maxOutputTokens ? { max_completion_tokens: maxOutputTokens } : {}),
      },
    };
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => textContent(m.content))
    .join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((message) => ({
      role: message.role,
      // Assistant history uses the Responses easy-input message format; no server-side response IDs.
      content:
        message.role === "assistant"
          ? textContent(message.content)
          : (typeof message.content === "string"
              ? [{ type: "text" as const, text: message.content }]
              : message.content
            ).map((part) =>
              part.type === "text"
                ? { type: "input_text", text: part.text }
                : {
                    type: "input_image",
                    image_url: part.image_url.url,
                    detail: "auto",
                  },
            ),
    }));
  return {
    path: "responses",
    body: {
      model,
      ...(instructions ? { instructions } : {}),
      input,
      stream: true,
      store: false,
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    },
  };
}
export async function openChat(
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  maxOutputTokens?: number,
) {
  const protocol = wireApi(model);
  const request = chatRequest(model, messages, protocol, maxOutputTokens);
  const response = await provider(request.path, request.body, signal);
  if (!response.body)
    throw new ProviderError(
      "invalid_response",
      "Nhà cung cấp không trả dữ liệu.",
      null,
      protocol,
    );
  return { protocol, deltas: chatDeltas(response, protocol) };
}
// A catalog entry is not evidence of inference permission. The UI explicitly validates
// a model with a small, potentially billable request before selecting it.
export async function validateModelAccess(model: string, signal: AbortSignal) {
  await requireModel(model, signal);
  const key = accessKey(model);
  if ((probeCache.get(key) || 0) > Date.now())
    return { id: model, wireApi: wireApi(model), access: "verified" };
  const { deltas } = await openChat(
    model,
    [{ role: "user", content: "Reply with only OK." }],
    signal,
    256,
  );
  let output = "";
  for await (const delta of deltas) output += delta;
  if (!output.trim())
    throw new ProviderError(
      "invalid_response",
      "Model không trả về nội dung văn bản trong bước xác minh.",
    );
  if (probeCache.size >= 1000) probeCache.clear();
  probeCache.set(key, Date.now() + PROBE_TTL);
  return { id: model, wireApi: wireApi(model), access: "verified" };
}
async function* chatDeltas(response: Response, protocol: WireApi) {
  if (response.headers.get("content-type")?.includes("application/json")) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError(
        "invalid_response",
        "Nhà cung cấp trả về JSON không hợp lệ.",
        null,
        protocol,
      );
    }
    if (data?.error) throw upstreamError(null, data.error.code, protocol);
    if (protocol === "responses") {
      if (data?.status !== "completed")
        throw new ProviderError(
          "provider_incomplete",
          "Nhà cung cấp chưa hoàn tất phản hồi.",
          null,
          protocol,
        );
      const text = responseText(data);
      if (!text)
        throw new ProviderError(
          "invalid_response",
          "Nhà cung cấp không trả về nội dung văn bản.",
          null,
          protocol,
        );
      yield text;
    } else {
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text)
        throw new ProviderError(
          "invalid_response",
          "Nhà cung cấp không trả về nội dung văn bản.",
          null,
          protocol,
        );
      yield text;
    }
    return;
  }
  yield* protocol === "responses"
    ? parseResponsesSSE(response.body!)
    : parseSSE(response.body!);
}
const responseSchema = z.object({
  status: z.string().optional(),
  error: z.object({ code: z.string().optional() }).nullish(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
});
function responseText(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) return "";
  return (parsed.data.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}
// Parse SSE frames, including named events, multi-line data and CRLF/chunk boundaries.
async function* sseFrames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    event = "";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 4 * 1024 * 1024)
        throw new ProviderError(
          "invalid_response",
          "Sự kiện streaming quá lớn.",
        );
      if (done && buffer && !buffer.endsWith("\n")) buffer += "\n";
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          if (data.length) yield { event, data: data.join("\n") };
          event = "";
          data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
          if (data.reduce((n, line) => n + line.length, 0) > 4 * 1024 * 1024)
            throw new ProviderError(
              "invalid_response",
              "Sự kiện streaming quá lớn.",
            );
        }
      }
      if (done) {
        if (data.length) yield { event, data: data.join("\n") };
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const eventSchema = z.object({
  type: z.string().optional(),
  delta: z.string().optional(),
  code: z.string().optional(),
  error: z.object({ code: z.string().optional() }).optional(),
  response: responseSchema.optional(),
});
export async function* parseResponsesSSE(body: ReadableStream<Uint8Array>) {
  let emitted = false;
  for await (const frame of sseFrames(body)) {
    if (frame.data === "[DONE]") break; // Responses still requires response.completed.
    let value;
    try {
      value = JSON.parse(frame.data);
    } catch {
      throw new ProviderError(
        "invalid_response",
        "Luồng Responses trả về JSON không hợp lệ.",
        null,
        "responses",
      );
    }
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success)
      throw new ProviderError(
        "invalid_response",
        "Sự kiện Responses không hợp lệ.",
        null,
        "responses",
      );
    const data = parsed.data;
    const type = data.type || frame.event;
    if (type === "error" || type === "response.failed" || data.error)
      throw upstreamError(
        null,
        data.error?.code || data.code || data.response?.error?.code,
        "responses",
      );
    if (type === "response.incomplete")
      throw new ProviderError(
        "provider_incomplete",
        "Nhà cung cấp chưa hoàn tất phản hồi (Responses incomplete).",
        null,
        "responses",
      );
    if (type === "response.refusal.delta" || type === "response.refusal.done")
      throw new ProviderError(
        "provider_refusal",
        "Model từ chối thực hiện yêu cầu này.",
        null,
        "responses",
      );
    if (type === "response.output_text.delta") {
      if (typeof data.delta !== "string")
        throw new ProviderError(
          "invalid_response",
          "Sự kiện Responses thiếu nội dung delta.",
          null,
          "responses",
        );
      emitted = true;
      yield data.delta;
    }
    if (type === "response.completed") {
      if (data.response?.status !== "completed")
        throw new ProviderError(
          "invalid_response",
          "Responses không có trạng thái hoàn tất hợp lệ.",
          null,
          "responses",
        );
      if (!emitted) {
        const text = responseText(data.response);
        if (text) yield text;
      }
      return;
    }
  }
  throw new ProviderError(
    "provider_incomplete",
    "Luồng Responses kết thúc trước khi hoàn tất.",
    null,
    "responses",
  );
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
      if (buffer.length > 4 * 1024 * 1024)
        throw new ProviderError(
          "invalid_response",
          "Sự kiện streaming quá lớn.",
          null,
          "chat_completions",
        );
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
          throw new ProviderError(
            "invalid_response",
            "Luồng AI trả về JSON không hợp lệ.",
            null,
            "chat_completions",
          );
        }
        if (data?.error)
          throw upstreamError(null, data.error.code, "chat_completions");
        if (data?.choices?.[0]?.finish_reason) finished = true;
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") yield delta;
      }
      if (done) {
        if (!finished)
          throw new ProviderError(
            "provider_incomplete",
            "Luồng AI kết thúc trước khi hoàn tất.",
            null,
            "chat_completions",
          );
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
