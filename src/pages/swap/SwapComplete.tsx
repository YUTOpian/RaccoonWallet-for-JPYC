import { Box, AppBar, Toolbar, Typography, Button, Link as MuiLink } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CHAINS } from '../../lib/chains';
import { useAppStore } from '../../store/appStore';
import heroSwapSmall from '../../assets/heroimage_send_small.png';
import bgTop from '../../assets/image_transaction_background_top.png';
import bgBottom from '../../assets/image_transaction_background_bottom.png';

export default function SwapComplete() {
  const { t } = useTranslation();
  const txHash = useAppStore((s) => s.lastSwapHash);
  const swapChain = useAppStore((s) => s.swapChain);
  const explorerUrl = `${CHAINS[swapChain].blockExplorerUrl}/tx/${txHash}`;

  return (
    <Box>
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6">{t('swap.complete_title')}</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box component="img" src={heroSwapSmall} sx={{ width: '100%' }} />
        <Box component="img" src={bgTop} sx={{ width: '100%', maxWidth: 480 }} />

        <Typography align="center" sx={{ fontSize: 'x-large', color: 'primary.main', mt: '-48px' }}>
          {(t('swap.complete_message', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>

        {txHash && (
          <Typography align="center" sx={{ wordBreak: 'break-all', mx: 3 }}>
            <MuiLink href={explorerUrl} target="_blank" rel="noopener">{txHash}</MuiLink>
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', zIndex: 1, width: '100%', maxWidth: 480, px: 2, gap: 1 }}>
          <Button component={RouterLink} to="/top?tab=home" variant="contained" color="primary" fullWidth>HOME</Button>
          <Button component={RouterLink} to="/swap" variant="contained" fullWidth sx={{ bgcolor: 'nemOrange', color: 'white' }}>
            {t('swap.title')}
          </Button>
        </Box>

        <Box sx={{ maxWidth: 480, ml: 'auto', mr: 0, display: 'block', mt: 2 }}>
          <Box component="img" src={bgBottom} sx={{ width: '100%', mb: '-8px' }} />
        </Box>
      </Box>
    </Box>
  );
}
