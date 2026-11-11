import { Box, Typography } from '@mui/material';

/**
 * Shown for any route not yet ported from the Vue app. Once a screen's real React
 * component is ready, swap its entry in router.tsx from this placeholder to the real one.
 */
export default function PlaceholderPage({ name }: { name: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', padding: 2 }}>
      <Typography variant="h6" color="text.secondary">{name}</Typography>
      <Typography variant="body2" color="text.disabled">Not yet ported</Typography>
    </Box>
  );
}
