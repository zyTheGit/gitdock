import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  /** 工具栏内的紧凑尺寸（图谱过滤、diff 文件切换）。 */
  compact?: boolean;
  /** 撑满父容器（表单字段）。 */
  block?: boolean;
}

/** 全应用统一的下拉控件：保留原生 select 的键盘与可访问性，外观交给统一令牌。 */
export function Select({
  options,
  compact = false,
  block = false,
  className,
  ...rest
}: SelectProps) {
  const classes = [
    "select-control",
    compact ? "compact" : "",
    block ? "block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <select {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <svg className="select-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 6.5 8 10l3.5-3.5" />
      </svg>
    </span>
  );
}
