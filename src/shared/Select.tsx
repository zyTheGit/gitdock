import type { SelectHTMLAttributes } from "react";
import { Icon } from "../assets/icons";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

/** 分组选项：同名本地分支/标签需要分组标题区分。 */
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options?: SelectOption[];
  /** 分组选项；与 options 同时提供时先渲染 options。 */
  groups?: SelectGroup[];
  /** 工具栏内的紧凑尺寸（图谱过滤、diff 文件切换）。 */
  compact?: boolean;
  /** 撑满父容器（表单字段）。 */
  block?: boolean;
}

/** 全应用统一的下拉控件：保留原生 select 的键盘与可访问性，外观交给统一令牌。 */
export function Select({
  options,
  groups,
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
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Icon name="chevronDown" className="select-chevron" />
    </span>
  );
}
