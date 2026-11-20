import type { IconSpec } from "./types";

export const branch = {
  viewBox: "0 0 16 16",
  strokeWidth: 1.5,
  children: (
    <>
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="6.5" r="1.6" />
      <path d="M4.5 5.1v5.8M11.5 8.1c0 2.3-2.2 2.9-4.6 3.3" />
    </>
  ),
} satisfies IconSpec;
