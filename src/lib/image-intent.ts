export type ChatTask = "auto" | "text" | "image";

// Only direct requests trigger a billable image operation. Explanations and
// mentions of image generation in the middle of a message stay in text chat.
export function wantsImage(content: string, task: ChatTask = "auto") {
  if (task !== "auto") return task === "image";
  // Normalize only for intent detection; send the original prompt upstream.
  // Unconverted Vietnamese Telex/VNI commands should work like accented text.
  const command = content
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()
    .replace(/\b(?:taoj|tao5)\b/g, "tao")
    .replace(/\b(?:anhr|anh3)\b/g, "anh")
    .replace(/\b(?:vex|ve4)\b/g, "ve")
    .replace(/\b(?:hinhf|hinh2)\b/g, "hinh");
  return /^(?:(?:hay|giup toi|giup minh|ban hay|lam on|toi muon|minh muon|ban co the|please|can you|could you)\s+)*(?:(?:tao|ve|thiet ke|dung)\s+(?:(?:cho|giup)\s+(?:toi|minh|to)\s+)?(?:(?:mot|1|buc|tam|hinh)\s+)*(?:anh|hinh|tranh)\b|(?:generate|create|draw|paint)\s+(?:(?:me|an?|the)\s+)*(?:image|picture|photo|illustration|painting)\b)/u.test(
    command,
  );
}
