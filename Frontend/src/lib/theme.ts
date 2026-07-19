import { theme, type ThemeConfig } from "antd";

// Dual-accent on near-black, dark by default.
//   violet = structure  (nav, selection, primary actions, brand)
//   orange = energy     (urgency, overdue, high priority, focal card)
// The two blend into a "sunset" gradient reserved for hero moments so the mix
// stays deliberate instead of noisy.
export const ACCENT = "#a855f7";
export const ACCENT_STRONG = "#7c3aed";
export const ACCENT_DEEP = "#832062";

export const WARM = "#ff6b2c";
export const WARM_DEEP = "#e2551a";
export const WARM_SOFT = "#ff8f5e";

// violet -> orange, passing through magenta/coral. Used on the featured card,
// the create FAB, the active day cell and the brand mark.
export const SUNSET = `linear-gradient(135deg, ${ACCENT} 0%, #e0559b 48%, ${WARM} 100%)`;

// ---- Design tokens --------------------------------------------------------
// A single scale shared by mobile and desktop so both read as one system:
// high-radius cards, pill tags, big tight headings, muted meta text.

export const SURFACE = {
  bg: "#0b0b10",
  card: "#14141c",
  cardHover: "#191922",
  raised: "#1b1b25",
  border: "#20202b",
  borderSoft: "#17171f",
};

export const TEXT = {
  primary: "#f4f4f8",
  secondary: "#a9a9b8",
  tertiary: "#6f6f80",
  onAccent: "#ffffff",
};

export const RADIUS = {
  card: 18,
  control: 12,
  pill: 999,
};

// Featured/"next up" card fill — the accent-filled hero card.
export const FEATURED_GRADIENT = SUNSET;

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: ACCENT,
    colorInfo: ACCENT,
    colorBgBase: SURFACE.bg,
    colorBgLayout: SURFACE.bg,
    colorBgContainer: SURFACE.card,
    colorBgElevated: SURFACE.raised,
    colorBorder: SURFACE.border,
    colorBorderSecondary: SURFACE.borderSoft,
    colorText: TEXT.primary,
    colorTextSecondary: TEXT.secondary,
    colorTextTertiary: TEXT.tertiary,
    borderRadius: RADIUS.control,
    borderRadiusLG: RADIUS.card,
    fontSize: 14,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    wireframe: false,
  },
  components: {
    Layout: {
      siderBg: "#0e0e14",
      headerBg: "#0e0e14",
      bodyBg: SURFACE.bg,
      headerPadding: "0 20px",
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: "rgba(168,85,247,0.16)",
      itemSelectedColor: ACCENT,
      itemHoverBg: "rgba(255,255,255,0.05)",
      itemBorderRadius: RADIUS.control,
      itemHeight: 44,
      itemMarginInline: 12,
      itemMarginBlock: 6,
      iconSize: 18,
      collapsedIconSize: 22,
    },
    Card: {
      colorBgContainer: SURFACE.card,
      borderRadiusLG: RADIUS.card,
    },
    Button: {
      borderRadius: RADIUS.control,
      controlHeight: 38,
      fontWeight: 500,
    },
    Segmented: {
      itemSelectedBg: ACCENT,
      itemSelectedColor: "#fff",
      borderRadius: RADIUS.control,
    },
    Input: { borderRadius: RADIUS.control },
    Select: { borderRadius: RADIUS.control },
  },
};
