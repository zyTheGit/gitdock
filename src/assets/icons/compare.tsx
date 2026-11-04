import type { IconSpec } from "./types";

export const compare = {
  viewBox: "0 0 24 24",
  strokeWidth: 1.7,
  children: (
    <>
      <path d="M7 4v16m10-16v16" />
      <path d="M4 8h6m4 8h6" />
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="16" r="2" />
    </>
  ),
} satisfies IconSpec;
