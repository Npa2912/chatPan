// @vitest-environment jsdom
import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Dialog } from "../src/components/ui/dialog";
it("names the dialog for assistive technology and closes on Escape", () => {
  const close = vi.fn();
  render(
    <Dialog title="Cài đặt" onClose={close}>
      <label>
        Tên
        <input autoFocus />
      </label>
    </Dialog>,
  );
  expect(screen.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalled();
  cleanup();
});
