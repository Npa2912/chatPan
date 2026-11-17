import "dotenv/config";
import { db } from "../../src/lib/db";
import { tokenHash } from "../../src/lib/security";
import { test, expect } from "@playwright/test";
const origin = "http://localhost:3000";
const email = () =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const password = "Test-password-2026!";
test("desktop and mobile layout, theme and real registration/login/logout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Mọi ý tưởng/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tạo không gian của bạn" }).click();
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Đăng ký" })
    .click();
  const address = email();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Người kiểm thử");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Xác nhận mật khẩu").fill(password);
  await page
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("Người kiểm thử", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Đổi giao diện", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator(".app")).toHaveClass(/light/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Mở menu" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await page.getByRole("button", { name: "Đóng menu" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Tài khoản", exact: true }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("button", { name: "Tạo không gian của bạn" }).click();
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const deleted = await page.request.delete("/api/me", { headers: { origin } });
  expect(deleted.status()).toBe(200);
});
test("real PostgreSQL persistence, auth failures, CSRF and cross-user isolation", async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin },
    }),
    b = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin },
    });
  const address = email();
  expect((await a.get("/api/conversations")).status()).toBe(401);
  expect(
    (
      await a.post("/api/auth/register", {
        data: { name: "Alice", email: address, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await b.post("/api/auth/register", {
        data: { name: "Alice", email: address, password },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await b.post("/api/auth/login", {
        data: { email: address, password: "wrong-password" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await b.post("/api/auth/register", {
        data: { name: "Bob", email: email(), password },
      })
    ).status(),
  ).toBe(200);
  const created = await a.post("/api/conversations", { data: {} });
  expect(created.status()).toBe(200);
  const c = await created.json();
  expect(
    (
      await a.patch("/api/conversations/" + c.id, {
        data: { title: "Persistent title", pinned: true },
      })
    ).status(),
  ).toBe(200);
  expect((await (await a.get("/api/conversations/" + c.id)).json()).title).toBe(
    "Persistent title",
  );
  expect((await b.get("/api/conversations/" + c.id)).status()).toBe(404);
  expect((await b.delete("/api/conversations/" + c.id)).status()).toBe(404);
  const upload = await a.post("/api/files", {
    multipart: {
      file: {
        name: "source.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("private document"),
      },
    },
  });
  expect(upload.status()).toBe(200);
  const f = await upload.json();
  expect((await b.get("/api/files/" + f.id)).status()).toBe(404);
  expect(await (await a.get("/api/files/" + f.id)).text()).toBe(
    "private document",
  );
  expect(
    (
      await a.post("/api/conversations", {
        headers: { origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await a.get("/api/admin")).status()).toBe(403);
  expect(
    (
      await a.post("/api/auth/token", {
        data: { token: "0".repeat(64), purpose: "reset", password },
      })
    ).status(),
  ).toBe(400);
  expect((await a.delete("/api/conversations/" + c.id)).status()).toBe(200);
  expect((await a.get("/api/conversations/" + c.id)).status()).toBe(404);
  await a.delete("/api/me");
  await b.delete("/api/me");
  await a.dispose();
  await b.dispose();
});

test("password reset tokens expire, are single use and invalidate existing sessions", async ({
  playwright,
}) => {
  const context = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  const address = email();
  await context.post("/api/auth/register", {
    data: { name: "Reset test", email: address, password },
  });
  const token = "1".repeat(64),
    expired = "2".repeat(64);
  await db.emailToken.createMany({
    data: [
      {
        hash: tokenHash(token),
        email: address,
        purpose: "reset",
        expiresAt: new Date(Date.now() + 60000),
      },
      {
        hash: tokenHash(expired),
        email: address,
        purpose: "reset",
        expiresAt: new Date(Date.now() - 1000),
      },
    ],
  });
  expect(
    (
      await context.post("/api/auth/token", {
        data: { token: expired, purpose: "reset", password },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.post("/api/auth/token", {
        data: { token, purpose: "reset", password: "New-password-2026!" },
      })
    ).status(),
  ).toBe(200);
  expect((await context.get("/api/me")).status()).toBe(401);
  expect(
    (
      await context.post("/api/auth/token", {
        data: { token, purpose: "reset", password },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.post("/api/auth/login", {
        data: { email: address, password },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.post("/api/auth/login", {
        data: { email: address, password: "New-password-2026!" },
      })
    ).status(),
  ).toBe(200);
  await context.delete("/api/me");
  await db.emailToken.deleteMany({ where: { email: address } });
  await context.dispose();
});

test("model picker uses mocked access validation: prefers gpt-6.1-sol and rejects a forbidden model", async ({
  page,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: { name: "Model picker test", email: email(), password },
  });
  expect(registration.status()).toBe(200);
  try {
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: [
          { id: "gpt-6-astra", access: "unverified" },
          { id: "gpt-6.1-sol", default: true, access: "unverified" },
        ],
      }),
    );
    const probes: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/models/validate", async (route) => {
      const { model } = route.request().postDataJSON();
      probes.push(model);
      if (model === "gpt-6.1-sol") {
        await gate;
        await route.fulfill({
          json: { id: model, access: "verified", wireApi: "responses" },
        });
      } else
        await route.fulfill({
          status: 502,
          json: {
            error: "Mocked provider: model permission denied",
            code: "provider_forbidden",
            providerStatus: 403,
            protocol: "responses",
          },
        });
    });
    await page.goto("/");
    await expect.poll(() => probes).toEqual(["gpt-6.1-sol"]);
    const selector = page.getByLabel("Chọn model", { exact: true });
    await expect(selector).toHaveValue("");
    await expect(selector).toBeDisabled();
    release();
    await expect(selector).toHaveValue("gpt-6.1-sol");
    await selector.selectOption("gpt-6-astra");
    await expect(selector).toHaveValue("");
    await expect(
      page.getByRole("alert").filter({ hasText: "Mocked provider:" }),
    ).toContainText("model permission denied");
    expect(probes).toEqual(["gpt-6.1-sol", "gpt-6-astra"]);
  } finally {
    await page.request.delete("/api/me", { headers: { origin } });
  }
});

test("chat separates speakers, renders saved generated images and removes the inner input ring", async ({
  page,
}) => {
  const address = email();
  const registered = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: { name: "Image layout", email: address, password },
  });
  expect(registered.status()).toBe(200);
  try {
    const account = await db.user.findUniqueOrThrow({
      where: { email: address },
    });
    const sharp = (await import("sharp")).default;
    const data = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "gold" },
    })
      .webp()
      .toBuffer();
    const image = await db.generatedImage.create({
      data: {
        userId: account.id,
        prompt: "Fixture image",
        data: new Uint8Array(data),
      },
    });
    await db.conversation.create({
      data: {
        userId: account.id,
        title: "Kiểm tra bố cục ảnh",
        messages: {
          create: [
            {
              role: "user",
              content: "tạo ảnh wukong 3D đẹp",
              createdAt: new Date(Date.now() - 1000),
            },
            {
              role: "assistant",
              content: `![Ảnh đã tạo](/api/images/${image.id})\n\n[Tải ảnh](/api/images/${image.id}?download=1)`,
            },
          ],
        },
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Kiểm tra bố cục ảnh" }).click();
    const generated = page.getByAltText("Ảnh đã tạo");
    await expect(generated).toBeVisible();
    await expect
      .poll(() =>
        generated.evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(64);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Tải ảnh", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("chatpan.webp");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const user = await page
        .locator(".message.user .message-body")
        .boundingBox();
      const assistant = await page
        .locator(".message.assistant .message-body")
        .boundingBox();
      expect(user!.x).toBeGreaterThan(assistant!.x);
      const input = page.getByRole("textbox", {
        name: "Tin nhắn",
        exact: true,
      });
      await input.focus();
      expect(await input.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
        "none",
      );
      expect(
        await page
          .locator(".composer")
          .evaluate((el) => getComputedStyle(el).borderTopStyle),
      ).toBe("solid");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "Tạo ảnh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Tạo ảnh", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("textbox", { name: "Tin nhắn", exact: true }),
    ).toHaveAttribute("placeholder", "Mô tả ảnh bạn muốn tạo…");
    // Explicit fixture server verifies UI dispatch and history refresh, not live AI.
    await page.route("**/api/chat", async (route) => {
      const input = route.request().postDataJSON();
      expect(input.task).toBe("image");
      expect(input.content).toBe("Một thành phố trên mây");
      await db.message.create({
        data: {
          conversationId: input.conversationId,
          role: "user",
          content: input.content,
        },
      });
      await db.message.create({
        data: {
          conversationId: input.conversationId,
          role: "assistant",
          content: `![Ảnh đã tạo](/api/images/${image.id})`,
        },
      });
      await route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({ done: true, success: true, imageId: image.id }) +
          "\n",
      });
    });
    await page
      .getByRole("textbox", { name: "Tin nhắn", exact: true })
      .fill("Một thành phố trên mây");
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .click();
    await expect(page.getByAltText("Ảnh đã tạo")).toHaveCount(2);
    await expect(
      page.getByText("Một thành phố trên mây", { exact: true }),
    ).toBeVisible();
  } finally {
    await page.request.delete("/api/me", { headers: { origin } });
  }
});
