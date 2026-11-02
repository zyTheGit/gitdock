import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

function darkQuery(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia("(prefers-color-scheme: dark)");
}

/** 解析当前实际生效的主题：设置中的覆盖优先，否则跟随系统。 */
export function resolveTheme(): ResolvedTheme {
  const override = document.documentElement.dataset.theme;
  if (override === "light" || override === "dark") {
    return override;
  }
  return darkQuery()?.matches ? "dark" : "light";
}

/** 订阅主题变化：设置里的覆盖与系统外观切换都会触发重渲染。 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(resolveTheme);

  useEffect(() => {
    const update = () => setTheme(resolveTheme());
    const query = darkQuery();
    query?.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    update();
    return () => {
      query?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return theme;
}
