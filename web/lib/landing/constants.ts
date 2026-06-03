// Shared landing-editor constants — the single source of truth for both the server-side
// validator (lib/landing/validate.ts) and the client theme editor, so the UI can never
// offer a value the API would reject.

/** Curated font families the design system supports (title/body). */
export const FONT_ALLOWLIST = [
  "Inter",
  "DM Sans",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Manrope",
  "Space Grotesk",
  "IBM Plex Sans",
  "Lora",
  "Merriweather",
] as const;

export type ThemeFont = (typeof FONT_ALLOWLIST)[number];

/** Editable design-token colors (theme.colors.*) with operator-facing labels. */
export const COLOR_TOKENS = [
  { key: "orange", label: "Laranja (accent)" },
  { key: "orangeHi", label: "Laranja claro" },
  { key: "navy900", label: "Navy 900 (bloco escuro)" },
  { key: "navy800", label: "Navy 800" },
  { key: "text", label: "Texto" },
  { key: "textDim", label: "Texto secundário" },
  { key: "bg", label: "Fundo" },
  { key: "bgAlt", label: "Fundo alternado" },
] as const;

export type ColorTokenKey = (typeof COLOR_TOKENS)[number]["key"];
