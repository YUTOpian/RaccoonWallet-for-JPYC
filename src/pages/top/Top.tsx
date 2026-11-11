import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import QRLab from './QRLab';
import Home from './Home';

type TabKey = 'qrlab' | 'home';

// Ported from src/components/pages/top/Top.vue. Vuetify's v-tabs-items kept every tab's
// component mounted (just hidden) so state like the in-progress Send address wasn't lost
// when switching tabs; this keeps that same behavior by rendering every tab and toggling
// visibility with `display`, rather than conditionally mounting only the active one.
export default function Top() {
  const [searchParams] = useSearchParams();
  const [displayTab, setDisplayTab] = useState<TabKey>('home');

  useEffect(() => {
    const tab = searchParams.get('tab');
    // 受け取る/送る/スキャン are panels on Home now: those tabs open Home with the panel showing.
    if (tab === 'receive' || tab === 'send' || tab === 'scan') {
      setDisplayTab('home');
    } else if (tab && ['qrlab', 'home'].includes(tab)) {
      setDisplayTab(tab as TabKey);
    }
  }, [searchParams]);

  return (
    <Box sx={{ minHeight: '100dvh' }}>

      <Box sx={{ minHeight: '100dvh' }}>
        <Box sx={{ display: displayTab === 'qrlab' ? 'block' : 'none' }}><QRLab /></Box>
        <Box sx={{ display: displayTab === 'home' ? 'block' : 'none' }}><Home needsUpdate={displayTab === 'home'} openPanel={(['receive', 'send', 'scan'] as const).find((k) => k === searchParams.get('tab')) ?? null} /></Box>
      </Box>

    </Box>
  );
}
