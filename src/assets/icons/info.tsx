import type { IconSpec } from "./types";

export const info = {
  viewBox: "0 0 24 24",
  strokeWidth: 1.7,
  children: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
} satisfies IconSpec;