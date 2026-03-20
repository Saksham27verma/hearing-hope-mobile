// Modern Soft UI - Indigo & Slate professional theme
export const theme = {
  colors: {
    // Backgrounds
    background: '#FFFFFF',
    backgroundSecondary: '#F8FAFC',
    backgroundTertiary: '#F1F5F9',
    card: '#FFFFFF',
    cardGlass: 'rgba(255, 255, 255, 0.85)',
    cardBorder: 'transparent',

    // Text hierarchy
    text: '#0F172A', // Slate-900
    textSecondary: '#64748B', // Slate-500
    textMuted: '#94A3B8', // Slate-400

    // Primary - Indigo
    primary: '#4F46E5',
    primaryLight: '#EEF2FF',
    primaryDark: '#3730A3',

    // Accent - Deep Teal
    teal: '#0D9488',
    tealLight: '#CCFBF1',
    tealDark: '#0F766E',

    // Status
    success: '#059669',
    successBg: '#D1FAE5',
    successText: '#047857',
    error: '#DC2626',
    errorBg: '#FEE2E2',
    errorText: '#B91C1C',
    warning: '#D97706',
    warningBg: '#FEF3C7',
    warningText: '#B45309',
    scheduled: '#4F46E5',
    scheduledBg: '#EEF2FF',
    scheduledText: '#3730A3',

    // UI
    border: '#E2E8F0',
    divider: '#F1F5F9',
    shadow: 'rgba(15, 23, 42, 0.08)',
    shadowStrong: 'rgba(15, 23, 42, 0.12)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    full: 9999,
  },
  shadows: {
    soft: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 3,
    },
    medium: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
      elevation: 5,
    },
    glow: {
      shadowColor: '#4F46E5',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
  },
  touchTarget: 44,
};
