import { useEffect, useState } from "react";
import { errorText } from "./error";

/** 统一封装「单请求 IPC 资源」的三态加载结果。 */
export interface IpcResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** useIpcResource 的可选项。 */
export interface UseIpcResourceOptions {
  /** false 时清空三态且不发请求；默认 true。 */
  enabled?: boolean;
  /**
   * 期望的仓库 generation。提供时校验响应 DTO 的 generation 字段，
   * 不一致视为过期数据静默丢弃（不落 data、不报错），避免旧视图数据覆盖新视图。
   */
  expectedGeneration?: number;
}

/** 响应自带 generation 的 DTO（如 CommitDetailDto / FileDiffDto）。 */
interface Generational {
  generation: number;
}

/**
 * 单请求 IPC 资源的统一加载骨架：data/loading/error 三态 + cancelled 竞态防护。
 *
 * - deps、enabled、expectedGeneration 任一变化时先清空旧状态再重新请求；
 * - 响应到达时组件已卸载或依赖已变（cancelled）则整份丢弃，不覆盖新状态；
 * - loading 初始值取 enabled：挂载即可请求的视图首帧就处于加载中；
 * - deps 长度必须恒定（与 useEffect 依赖数组同约束），元素按位置比较。
 */
export function useIpcResource<T extends Generational>(
  deps: unknown[],
  fetcher: () => Promise<T>,
  options: { expectedGeneration: number; enabled?: boolean },
): IpcResource<T>;
export function useIpcResource<T>(
  deps: unknown[],
  fetcher: () => Promise<T>,
  options?: { enabled?: boolean },
): IpcResource<T>;
export function useIpcResource<T>(
  deps: unknown[],
  fetcher: () => Promise<T>,
  options: UseIpcResourceOptions = {},
): IpcResource<T> {
  const { enabled = true, expectedGeneration } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((next) => {
        const stale =
          expectedGeneration !== undefined &&
          (next as Partial<Generational>).generation !== expectedGeneration;
        if (!cancelled && !stale) {
          setData(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, enabled, expectedGeneration]);

  return { data, loading, error };
}