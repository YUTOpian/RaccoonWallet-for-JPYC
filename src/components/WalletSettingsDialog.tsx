import { useEffect, useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, List,
  ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WalletsHelper } from '../lib/storage';
import { CHAINS, getProvider } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { useAppStore } from '../store/appStore';

interface WalletSettingsDialogProps {
  // 設定を開く対象のウォレットID。空文字のとき(=非表示)はダイアログを閉じる。
  walletId: string;
  onClose: () => void;
  // 名前変更後に、呼び出し元のウォレット一覧を再読み込みするためのコールバック。
  onRenamed?: () => void;
}

// アカウント画面のタイルにある歯車から開く「ウォレットの設定」ポップアップ。
// 以前は /wallet/settings の独立画面(ヒーロー画像つき)だったものを、ダイアログに置き換えた。
// 詳細・アドレス・バックアップ・削除は従来どおり各画面へ遷移し、そこから戻ると
// /wallet/select?settings=<id> に戻ってこのポップアップが再び開く。
export default function WalletSettingsDialog({ walletId, onClose, onRenamed }: WalletSettingsDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;
  const open = walletId.length > 0;

  const [walletName, setWalletName] = useState('');
  const [walletType, setWalletType] = useState('');
  const [renameDialog, setRenameDialog] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setWalletType('');
    (async () => {
      const wallet = await WalletsHelper.get(walletId);
      if (cancelled || wallet === null) return;
      setWalletName(wallet.name);

      // EOA vs. smart-contract-wallet detection: a plain externally-owned account has no
      // deployed bytecode at its address.
      try {
        const code = await getProvider(activeChain).getCode(wallet.address);
        if (!cancelled) setWalletType(code && code !== '0x' ? 'Contract' : 'Standard');
      } catch {
        if (!cancelled) setWalletType('Standard');
      }
    })();
    return () => { cancelled = true; };
  }, [open, walletId, activeChain]);

  const items = [
    { text: t('wallet.settings_detail'), action: () => navigate(`/wallet/detail?id=${walletId}`) },
    { text: t('wallet.settings_address'), action: () => navigate(`/wallet/address?id=${walletId}`) },
    { text: t('wallet.settings_backup'), action: () => navigate(`/wallet/backup_caution?id=${walletId}`) },
    { text: t('wallet.settings_rename'), action: () => { setNewWalletName(''); setRenameDialog(true); } },
    { text: t('wallet.settings_delete'), action: () => navigate(`/wallet/delete?id=${walletId}`) },
  ];

  const rename = async () => {
    await WalletsHelper.setName(walletId, newWalletName);
    setWalletName(newWalletName);
    setRenameDialog(false);
    onRenamed?.();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
          <Box component="span" sx={{ flexGrow: 1 }}>{t('wallet.settings_title')}</Box>
          <IconButton onClick={onClose} aria-label="close"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 0, pb: 1 }}>
          <Box sx={{ px: 3, pb: 2, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 'bold' }} noWrap>{walletName}</Typography>
            {walletType.length === 0 ? (
              <CircularProgress size={20} color="primary" sx={{ mt: 1 }} />
            ) : (
              <Typography variant="caption" color="text.secondary">
                {CHAINS[activeChain].name} / WalletType: {walletType}
              </Typography>
            )}
          </Box>
          <Divider />
          <List disablePadding>
            {items.map((item) => (
              <Box key={item.text}>
                <ListItemButton onClick={item.action}>
                  <ListItemText primary={item.text} />
                  <ChevronRightIcon color="secondary" />
                </ListItemButton>
                <Divider />
              </Box>
            ))}
          </List>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialog} onClose={() => setRenameDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('wallet.rename_title')}</DialogTitle>
        <DialogContent>
          <TextField fullWidth label={t('wallet.rename_hint')} value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} sx={{ mb: 2, mt: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, pb: 2 }}>
            <Button variant="contained" color="primary" disabled={newWalletName.length === 0} onClick={rename}>OK</Button>
            <Button variant="contained" color="secondary" onClick={() => setRenameDialog(false)}>CANCEL</Button>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
