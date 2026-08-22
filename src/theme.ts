/**
 * Single source of truth for colours, spacing, breakpoints and the board palette.
 * Mobile-first with exactly one breakpoint (README §6 "Layout").
 */

export const theme = {
  color: {
    /** Page background. */
    bg: '#14181d',
    /** Raised surface (panels, cards). */
    surface: '#1c2229',
    surfaceAlt: '#232b34',
    border: '#2e3742',
    text: '#e6ebf1',
    textMuted: '#93a1b1',
    textFaint: '#657586',
    accent: '#5b9dd9',
    accentText: '#0d1117',
    good: '#67b26f',
    warn: '#d9a55b',
    danger: '#d96b6b',
    /** Focus ring, kept distinct from accent so it reads on accent surfaces. */
    focus: '#8ec5ff',
  },
  board: {
    light: '#e9d7b8',
    dark: '#9c7a52',
    /** Currently selected square. */
    selected: '#f2d873',
    /** Legal destination marker. */
    legal: 'rgba(30, 30, 30, 0.28)',
    /** Legal destination that captures. */
    legalCapture: 'rgba(217, 107, 107, 0.55)',
    lastMove: 'rgba(242, 216, 115, 0.42)',
    check: 'rgba(217, 76, 76, 0.72)',
    hint: 'rgba(103, 178, 111, 0.55)',
    error: 'rgba(217, 107, 107, 0.6)',
    success: 'rgba(103, 178, 111, 0.55)',
    coordinate: 'rgba(20, 24, 29, 0.65)',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '20px',
    xl: '32px',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '14px',
  },
  font: {
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    size: {
      sm: '0.8125rem',
      md: '0.9375rem',
      lg: '1.125rem',
      xl: '1.5rem',
    },
  },
  /** Single breakpoint: below is the narrow (phone) layout, at/above is wide. */
  breakpoint: {
    wide: 900,
  },
  media: {
    /** Wide layout: `@media ${theme.media.wide} { ... }` */
    wide: '(min-width: 900px)',
    narrow: '(max-width: 899px)',
  },
  layout: {
    /** Max content width of the app shell. */
    maxWidth: '1240px',
    navHeight: '52px',
  },
  z: {
    nav: 10,
    dialog: 100,
  },
} as const;

export type AppTheme = typeof theme;

declare module 'styled-components' {
  // styled-components v6 resolves `DefaultTheme` from this augmentation.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends AppTheme {}
}
