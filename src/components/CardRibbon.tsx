import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material';
import { Box, Typography } from '@mui/material';

// The card ribbons ("Balance" / "Transaction" / "SWAP") used to be separate PNGs with the
// text baked in, each with a sharp cut corner (`4px 4px 4px 0`) - a hard "flag" shape typical
// of the app's original Material-2010s look. Rendered as a pill-shaped badge with a leading
// icon instead so it reads as more current, while keeping the same labels/colors
// (nemOrange/nemBlue/primary) that make each card recognnizable at a glance. Shared between
// Home and TransactionList so both screens' Balance ribbons stay visually identical.
//
// Default left offset is ml:2 (16px), matching cards where the ribbon is the direct child of
// Card/CardActionArea with no padding of its own (Transaction/JPYC cards on Home). Where the
// ribbon instead sits inside a parent that already carries px:2 padding (the Balance card),
// pass sx={{ ml: 0 }} so the ribbon lines up flush with that padding instead of stacking an
// extra 16px on top of it - keeping every ribbon's left edge at the same 16px from the card
// edge, rather than the Balance one sitting 16px further right than the others.
export default function CardRibbon({ text, bgcolor, icon, sx }: { text: string; bgcolor: string; icon: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, bgcolor, borderRadius: 999, px: 1.5, py: 0.5, ml: 2, mt: 2, ...sx }}>
      {icon}
      <Typography sx={{ color: 'white', fontWeight: 'bold', fontSize: '0.8rem', lineHeight: 1 }}>{text}</Typography>
    </Box>
  );
}
