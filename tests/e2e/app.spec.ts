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
