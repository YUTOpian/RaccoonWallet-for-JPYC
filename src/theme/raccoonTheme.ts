import { createTheme } from '@mui/material/styles';

// Ported 1:1 from the Vue app's src/raccoonTheme.json — keeping the same visual identity
// during the framework migration.
declare module '@mui/material/styles' {
  interface Palette {
    textSlightGray: string;
    textGray: string;
    textDarkGray: string;
    textLightGray: string;
    nemBlue: string;
    nemOrange: string;
    nemGreen: string;
  }
  interface PaletteOptions {
    textSlightGray?: string;
    textGray?: string;
    textDarkGray?: string;
    textLightGray?: string;
    nemBlue?: string;
    nemOrange?: string;
    nemGreen?: string;
  }
}

export const raccoonTheme = createTheme({
  palette: {
    primary: { main: '#00c3b2' },
    secondary: { main: '#929292' },
    error: { main: '#FF5252' },
    info: { main: '#2196F3' },
    success: { main: '#4CAF50' },
    warning: { main: '#FFC107' },
    // MUI's palette doesn't have a built-in "accent" slot; kept as a custom key below
    // instead of overloading one of MUI's own (info/warning/etc.) with a different meaning.
    textSlightGray: '#929292',
    textGray: '#666666',
    textDarkGray: '#777777',
    textLightGray: '#A2A2A2',
    nemBlue: '#66B1E6',
    nemOrange: '#F7A800',
    nemGreen: '#00C3B2',
  },
  shape: {
    // Was 4 (a sharp, boxy Material-2010s look carried over from the Vue app). Raised to
    // soften cards/buttons for a more current feel; the NEM-era ribbon colors/labels
    // (CardRibbon, nemBlue/nemOrange) are deliberately untouched - see Home.tsx.
    borderRadius: 16,
  },
  components: {
    // Cards used to rely on MUI's default elevation-1 shadow (a fairly hard, close
    // shadow). Replaced with a lighter, more diffuse one so cards read as "raised" without
    // looking dated.
    MuiPaper: {
      styleOverrides: {
        elevation1: {
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        },
      },
    },
    // タッチ端末(スマホ・タブレット)では、指で押しやすいよう最小タップ領域を44pxに揃える
    // (Apple HIG の推奨値)。マウス操作の端末には影響しない。
    MuiIconButton: {
      styleOverrides: {
        root: { '@media (pointer: coarse)': { minWidth: 44, minHeight: 44 } },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { '@media (pointer: coarse)': { minHeight: 44 } },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { '@media (pointer: coarse)': { minHeight: 48 } },
      },
    },
    // The top AppBar used to be a flat gray bar with a hard elevation-1 shadow (classic
    // Material 2 toolbar). Flattened to a thin hairline instead so it feels lighter.
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        colorDefault: {
          backgroundColor: '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        },
      },
    },
  },
});
