import type { SVGProps } from "react";

import type { IconSpec } from "./types";
import { terminalStatus } from "./terminal-status";
import { commandLog } from "./command-log";
import { search } from "./search";
import { stage } from "./stage";
import { compare } from "./compare";
import { terminal } from "./terminal";
import { settings } from "./settings";
import { refresh } from "./refresh";
import { fileList } from "./file-list";
import { splitView } from "./split-view";
import { unifiedView } from "./unified-view";
import { wrap } from "./wrap";
import { expand } from "./expand";
import { restore } from "./restore";
import { zoomOut } from "./zoom-out";
import { zoomIn } from "./zoom-in";
import { shell } from "./shell";
import { fullscreen } from "./fullscreen";
import { fullscreenRestore } from "./fullscreen-restore";
import { collapse } from "./collapse";
import { chevronDown } from "./chevron-down";
import { play } from "./play";
import { stop } from "./stop";
import { cloudDownload } from "./cloud-download";
import { download } from "./download";
import { upload } from "./upload";

/**
 * 应用内所有 SVG 图标的注册表。单个图标定义在同目录的独立文件中；图标统一
 * 使用 currentColor 描边，颜色由外层控件的语义令牌决定。
 */
const ICONS = {
  terminalStatus,
  commandLog,
  search,
  stage,
  compare,
  terminal,
  settings,
  refresh,
  fileList,
  splitView,
  unifiedView,
  wrap,
  expand,
  restore,
  zoomOut,
  zoomIn,
  shell,
  fullscreen,
  fullscreenRestore,
  collapse,
  chevronDown,
  play,
  stop,
  cloudDownload,
  download,
  upload,
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "name"> {
  name: IconName;
}

export function Icon({ name, ...rest }: IconProps) {
  const { viewBox, strokeWidth, children } = ICONS[name];
  return (
    <svg
      viewBox={viewBox}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}
