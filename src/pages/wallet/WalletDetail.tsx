import { useEffect, useState } from 'react';
import { Box, Card, CircularProgress, Divider, List, ListItemButton, ListItemText } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { WalletsHelper } from '../../lib/storage';
import { CHAINS, getProvider } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { useAppStore } from '../../store/appStore';

export default function WalletDetail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;

  const [loading, setLoading] = useState(true);
  const [walletType, setWalletType] = useState('');
  // Store raw facts, not pre-translated strings, so the label re-renders correctly if the
  // user changes the language later without this effect re-running.
  const [structureKind, setStructureKind] = useState<'unknown' | 'hd' | 'imported' | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  // The same address/keypair works on all three EVM chains — this wallet isn't limited
  // to whichever one is currently active.
  const supportedNetworks = Object.keys(CHAINS).map((key) => CHAINS[key as ChainKey].name).join(' / ');

  const walletStructure = structureKind === 'hd'
    ? t('wallet.detail_hd_wallet')
    : structureKind === 'imported'
      ? t('wallet.detail_imported_key')
      : t('common.not_get');

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.get(id);
      if (wallet === null) return;

      setPublicKey(wallet.publicKey);

      try {
        const code = await getProvider(activeChain).getCode(wallet.address);
        if (code && code !== '0x') {
          setWalletType('Contract');
          setStructureKind('unknown');
        } else {
          setWalletType('Standard');
          setStructureKind(wallet.hasMnemonic() ? 'hd' : 'imported');
        }
      } catch {
        setWalletType('Standard');
        setStructureKind(wallet.hasMnemonic() ? 'hd' : 'imported');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeChain]);

  return (
    <Box>
      <AppToolBar back={`/wallet/select?settings=${id}`} title={t('wallet.detail_title')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
            <CircularProgress color="primary" />
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 1 }}>
              <Card sx={{ width: '60vw' }}>
                <Box sx={{ textAlign: 'center', my: 1 }}>{CHAINS[activeChain].name}</Box>
                <Divider />
                <Box sx={{ textAlign: 'center', my: 1 }}>WalletType: {walletType}</Box>
              </Card>
            </Box>

            <Box sx={{ m: 1 }}>{t('wallet.detail_general')}</Box>
            <List>
              <ListItemButton disableRipple sx={{ cursor: 'default' }}>
                <ListItemText primary={t('wallet.detail_structure')} />
                <Box sx={{ color: 'text.secondary' }}>{walletStructure}</Box>
              </ListItemButton>
              <Divider />
              <ListItemButton disableRipple sx={{ cursor: 'default' }}>
                <ListItemText primary={t('wallet.detail_networks')} />
                <Box sx={{ color: 'text.secondary' }}>{supportedNetworks}</Box>
              </ListItemButton>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Box sx={{ fontWeight: 500 }}>{t('common.public_key')}</Box>
                <Box sx={{ wordBreak: 'break-all', mt: 0.5 }}>{publicKey ?? t('common.not_get')}</Box>
              </Box>
              <Divider />
            </List>
          </>
        )}
      </Box>
    </Box>
  );
}
