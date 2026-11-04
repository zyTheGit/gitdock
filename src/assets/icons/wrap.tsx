import type { IconSpec } from "./types";

export const wrap = {
  viewBox: "0 0 16 16",
  strokeWidth: 1.7,
  children: (
    <>
      <path d="M3 5h10M3 8h7a2 2 0 0 1 0 4H7" />
      <path d="M8.5 10.5 7 12l1.5 1.5" />
    </>
  ),
} satisfies IconSpec;
