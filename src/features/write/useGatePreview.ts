import { useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { GateReportDto, WriteRequest } from "../../shared/types";

export interface GatePreview {
  gate: GateReportDto | null;
  gateError: string | null;
  validating: boolean;
}

const EMPTY: GatePreview = { gate: null, gateError: null, validating: false };

/**
 * 写前检查预览：请求内容变化就重跑 Gate，只让最后一次结论落到界面。
 * 请求为 null（信息不全）时不发请求，由调用方展示缺失提示。
 */
export function useGatePreview(request: WriteRequest | null): GatePreview {
  // 请求对象每次渲染都是新引用：用序列化结果代表「内容」，字段真正变化才重查。
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<GatePreview>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    const current = request;
    const id = ++seq.current;
    if (!current) {
      setState(EMPTY);
      return;
    }
    setState({ gate: null, gateError: null, validating: true });
    let cancelled = false;
    ipc
      .validateWrite(current)
      .then((gate) => {
        if (!cancelled && seq.current === id) {
          setState({ gate, gateError: null, validating: false });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && seq.current === id) {
          setState({ gate: null, gateError: errorText(err), validating: false });
        }
      });
    return () => {
      cancelled = true;
    };
    // key 是请求内容的规范形式；request 本身不参与依赖，避免每帧重查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
