export type ChatTask = "auto" | "text" | "image";

// Only direct requests trigger a billable image operation. Explanations and
// mentions of image generation in the middle of a message stay in text chat.
export function wantsImage(content: string, task: ChatTask = "auto") {
  if (task !== "auto") return task === "image";
  return /^(?:(?:hãy|giúp tôi|giúp mình|bạn hãy|làm ơn|please|can you|could you)\s+)*(?:(?:tạo|vẽ|ve|tao|thiết kế|dựng)\s+(?:(?:cho|giúp)\s+(?:tôi|mình|tớ)\s+)?(?:(?:một|1|bức|tấm|hình)\s+)*(?:ảnh|hình|tranh|anh|hinh|tranh)\b|(?:generate|create|draw|paint)\s+(?:(?:me|an?|the)\s+)*(?:image|picture|photo|illustration|painting)\b)/iu.test(
    content.trim(),
  );
}
