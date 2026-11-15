// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useProviderModels } from "../src/components/use-provider-models";
it("selects the preferred model only after an actual access validation succeeds", async () => {
  let resolve!: (result: unknown) => void;
  const request = vi.fn(async (path: string) =>
    path === "models"
      ? [{ id: "gpt-6-astra" }, { id: "gpt-6.1-sol", default: true }]
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const error = vi.fn();
  const { result } = renderHook(() => useProviderModels(request, error));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.loadModels();
  });
  expect(result.current.model).toBe("");
  expect(result.current.validatingModel).toBe(true);
  expect(request).toHaveBeenCalledWith("models/validate", "POST", {
    model: "gpt-6.1-sol",
  });
  await act(async () => {
    resolve({ id: "gpt-6.1-sol", access: "verified" });
    await pending;
  });
  expect(result.current.model).toBe("gpt-6.1-sol");
  expect(error).not.toHaveBeenCalled();
  cleanup();
});
it("does not select a model whose inference request is forbidden", async () => {
  const request = vi.fn(async (path: string) => {
    if (path === "models") return [{ id: "gpt-6.1-sol", default: true }];
    throw new Error("Nhà cung cấp từ chối quyền truy cập");
  });
  const error = vi.fn();
  const { result } = renderHook(() => useProviderModels(request, error));
  await act(() => result.current.loadModels());
  expect(result.current.model).toBe("");
  expect(result.current.providerError).toContain("từ chối");
  expect(error).toHaveBeenCalled();
  cleanup();
});
it("validates manual changes and clears an earlier selection after denied access", async () => {
  const request = vi.fn(
    async (path: string, _method?: string, data?: unknown) => {
      if (path === "models")
        return [{ id: "gpt-6.1-sol", default: true }, { id: "legacy" }];
      if ((data as { model: string }).model === "legacy")
        throw new Error("No inference access");
      return { id: "gpt-6.1-sol", access: "verified" };
    },
  );
  const { result } = renderHook(() => useProviderModels(request, vi.fn()));
  await act(() => result.current.loadModels());
  expect(result.current.model).toBe("gpt-6.1-sol");
  await act(() => result.current.selectModel("legacy"));
  expect(result.current.model).toBe("");
  expect(result.current.providerError).toBe("No inference access");
  cleanup();
});
it("does not probe a manually supplied model absent from the current catalog", async () => {
  const request = vi.fn(async () => []);
  const { result } = renderHook(() => useProviderModels(request, vi.fn()));
  await act(() => result.current.selectModel("invalid"));
  expect(result.current.model).toBe("");
  expect(request).not.toHaveBeenCalled();
  cleanup();
});
it("does not restore a stale selection after logout resets model state", async () => {
  let resolve!: (result: unknown) => void;
  const request = vi.fn(async (path: string) =>
    path === "models"
      ? [{ id: "gpt-6.1-sol", default: true }]
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const { result } = renderHook(() => useProviderModels(request, vi.fn()));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.loadModels();
  });
  act(() => result.current.resetModels());
  await act(async () => {
    resolve({ id: "gpt-6.1-sol", access: "verified" });
    await pending;
  });
  expect(result.current.model).toBe("");
  expect(result.current.modelList).toEqual([]);
  cleanup();
});
