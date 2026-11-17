import { expect, it } from "vitest";
import { wantsImage } from "../src/lib/image-intent";

it.each([
  "tạo ảnh messi",
  "tao anh messi",
  "taoj anhr messi",
  "taoj ảnh messi",
  "tạo anhr messi",
  "tao5 anh3 messi",
  "Hãy tạo cho tôi một bức ảnh Messi",
  "Tôi muốn tạo ảnh Messi",
  "Bạn có thể tạo ảnh Messi không?",
  "VẼ MỘT BỨC TRANH",
  "vex hinhf con meo",
  "create an image of Messi",
])("recognizes an image command: %s", (prompt) => {
  expect(wantsImage(prompt)).toBe(true);
});

it.each([
  "Làm sao để tạo ảnh?",
  "Giải thích API tạo ảnh",
  "huong dan tao anh",
  "Don't create an image",
  "Không tạo ảnh, chỉ viết prompt",
  "Messi là ai?",
])("keeps a text question as chat: %s", (prompt) => {
  expect(wantsImage(prompt)).toBe(false);
});

it("honors explicit task selection", () => {
  expect(wantsImage("Lionel Messi", "image")).toBe(true);
  expect(wantsImage("taoj anhr messi", "text")).toBe(false);
});
