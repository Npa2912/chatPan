"use client";
import { useCallback, useRef, useState } from "react";
export type ProviderModel = {
  id: string;
  default?: boolean;
  access?: string;
  wireApi?: string;
};
type Request = (
  path: string,
  method?: string,
  data?: unknown,
) => Promise<unknown>;
export function useProviderModels(
  request: Request,
  onError: (message: string) => void,
) {
  const [modelList, setModelList] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState("");
  const [providerError, setProviderError] = useState("");
  const [validatingModel, setValidatingModel] = useState(false);
  const sequence = useRef(0);
  const verify = useCallback(
    async (id: string, seq: number) => {
      const result = (await request("models/validate", "POST", {
        model: id,
      })) as { id?: string; access?: string };
      if (result.id !== id || result.access !== "verified")
        throw new Error("Chưa xác minh được quyền sử dụng model.");
      if (sequence.current === seq) setModel(id);
    },
    [request],
  );
  const loadModels = useCallback(async () => {
    const seq = ++sequence.current;
    setModel("");
    setModelList([]);
    setProviderError("");
    setValidatingModel(true);
    try {
      const list = (await request("models")) as ProviderModel[];
      if (sequence.current !== seq) return;
      setModelList(list);
      const preferred = list.find((m) => m.default) || list[0];
      if (!preferred)
        throw new Error("Nhà cung cấp không trả về model khả dụng.");
      await verify(preferred.id, seq);
    } catch (e) {
      if (sequence.current === seq) {
        setProviderError((e as Error).message);
        onError((e as Error).message);
      }
    } finally {
      if (sequence.current === seq) setValidatingModel(false);
    }
  }, [request, verify, onError]);
  const selectModel = useCallback(
    async (id: string) => {
      const seq = ++sequence.current;
      setModel("");
      setProviderError("");
      setValidatingModel(true);
      try {
        if (!modelList.some((m) => m.id === id))
          throw new Error("Model không có trong danh sách nhà cung cấp.");
        await verify(id, seq);
      } catch (e) {
        if (sequence.current === seq) {
          setProviderError((e as Error).message);
          onError((e as Error).message);
        }
      } finally {
        if (sequence.current === seq) setValidatingModel(false);
      }
    },
    [modelList, verify, onError],
  );
  const resetModels = useCallback(() => {
    ++sequence.current;
    setModel("");
    setModelList([]);
    setProviderError("");
    setValidatingModel(false);
  }, []);
  return {
    modelList,
    model,
    providerError,
    validatingModel,
    loadModels,
    selectModel,
    resetModels,
  };
}
