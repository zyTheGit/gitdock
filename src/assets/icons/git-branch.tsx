import type { IconSpec } from "./types";

export const gitBranch = {
  viewBox: "0 0 24 24",
  strokeWidth: 1.7,
  children: (
    <>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 7.2v9.6M18 11.2c0 3.4-3 4.3-6.5 4.8" />
    </>
  ),
} satisfies IconSpec;