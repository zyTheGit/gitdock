import type { IconSpec } from "./types";

export const splitView = {
  viewBox: "0 0 16 16",
  strokeWidth: 1.7,
  children: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path d="M8 3.5v9" />
    </>
  ),
} satisfies IconSpec;
