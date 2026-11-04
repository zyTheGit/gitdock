import type { IconSpec } from "./types";

export const terminalStatus = {
  viewBox: "0 0 24 24",
  strokeWidth: 2,
  children: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
    </>
  ),
} satisfies IconSpec;
