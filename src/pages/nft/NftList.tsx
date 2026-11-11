import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Fab, MenuItem, Paper, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ethers } from 'ethers';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { CHAINS, extractRpcMessage, getNetworkMode } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import {
  NftHelper, detectStandard, fetchNftMeta, isHolding, syncPendingNftTxs,
} from '../../lib/nfts';
import type { NftMeta, NftRecord } from '../../lib/nfts';
import { WalletsHelper } from '../../lib/storage';

const column = { width: '100%', maxWidth: 720, mx: 'auto', px: 2, boxSizing: 'border-box' } as const;

function NftCard({ record, owner, onRemove }: { record: NftRecord; owner: string; onRemove: (r: NftRecord) => void }) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<NftMeta | null>(null);
  // null = 確認中(または確認できなかった)、true = 保有中、false = 保有していない
  const [holding, setHolding] = useState<boolean | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [m, h] = await Promise.all([
        fetchNftMeta(record),
        isHolding(record, owner).then<boolean | null>((v) => v).catch(() => null),
      ]);
      if (cancelled) return;
      setMeta(m);
      setHolding(h);
    })();
    return () => { cancelled = true; };
  }, [record, owner]);

  const showImage = !!meta?.image && !imageFailed;
  const title = meta?.name || `#${record.tokenId}`;

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden', opacity: holding === false ? 0.55 : 1, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ position: 'relative', width: '100%', pt: '100%', bgcolor: '#e8f7f5' }}>
        {showImage ? (
          <Box
            component="img"
            src={meta?.image}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {meta === null ? (
              <CircularProgress size={24} />
            ) : (
              <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>{t('nft.no_image')}</Typography>
            )}
          </Box>
        )}
      </Box>
      <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1 }}>
        {meta?.collectionName && (
          <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{meta.collectionName}</Typography>
        )}
        <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{title}</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" label={CHAINS[record.chain].name} />
          <Chip size="small" variant="outlined" label={record.standard === 'erc721' ? 'ERC-721' : 'ERC-1155'} />
        </Box>
        {holding === false && (
          <Typography sx={{ fontSize: '0.75rem', color: 'error.main' }}>{t('nft.not_holding')}</Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" onClick={() => onRemove(record)} sx={{ alignSelf: 'flex-start', px: 0, textTransform: 'none' }}>
          {t('nft.remove')}
        </Button>
      </Box>
    </Paper>
  );
}

export default function NftList() {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [records, setRecords] = useState<NftRecord[]>([]);
  // 再読み込みのたびにカードを作り直して、所有状況・メタデータを読み直す。
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addChain, setAddChain] = useState<ChainKey>('ethereum');
  const [addContract, setAddContract] = useState('');
  const [addTokenId, setAddTokenId] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (address: string) => {
    try {
      // dApp経由の取引で、アプリを閉じている間に取り込まれたものがあれば先に反映する。
      await syncPendingNftTxs(address);
    } catch (e) {
      console.warn('syncPendingNftTxs failed', e);
    }
    setRecords(await NftHelper.list(address));
    setReloadKey((k) => k + 1);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void (async () => {
      const wallet = await WalletsHelper.getActive();
      if (!wallet) {
        setLoaded(true);
        return;
      }
      setOwner(wallet.address);
      await load(wallet.address);
    })();
  }, [load]);

  const onRemove = async (record: NftRecord) => {
    await NftHelper.remove(record);
    if (owner) setRecords(await NftHelper.list(owner));
  };

  const onAdd = async () => {
    if (!owner) return;
    setAddError('');
    const contract = addContract.trim();
    const tokenIdText = addTokenId.trim();
    if (!ethers.isAddress(contract)) {
      setAddError(t('nft.error_invalid_contract'));
      return;
    }
    if (!/^\d+$/.test(tokenIdText)) {
      setAddError(t('nft.error_invalid_token_id'));
      return;
    }
    setAdding(true);
    try {
      const address = ethers.getAddress(contract);
      const tokenId = BigInt(tokenIdText).toString();
      const standard = await detectStandard(addChain, address);
      if (!standard) {
        setAddError(t('nft.error_not_nft'));
        return;
      }
      if (!(await isHolding({ chain: addChain, contract: address, tokenId, standard }, owner))) {
        setAddError(t('nft.error_not_owner'));
        return;
      }
      await NftHelper.add({
        mode: getNetworkMode(),
        chain: addChain,
        contract: address,
        tokenId,
        standard,
        owner: ethers.getAddress(owner),
        addedAt: Date.now(),
      });
      setAddOpen(false);
      setAddContract('');
      setAddTokenId('');
      setRecords(await NftHelper.list(owner));
    } catch (e) {
      setAddError(extractRpcMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const chainKeys = Object.keys(CHAINS) as ChainKey[];

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: '#f7f9f9' }}>
      <AppToolBar
        title={t('nft.title')}
        back="/top?tab=home"
        actions={
          owner ? (
            <Button color="inherit" startIcon={<RefreshIcon />} onClick={() => void load(owner)} sx={{ textTransform: 'none' }}>
              {t('nft.refresh')}
            </Button>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, ...column, pt: 2, pb: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loaded && owner === null && <Alert severity="info">{t('nft.no_wallet')}</Alert>}

        {!loaded && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {loaded && owner !== null && records.length === 0 && (
          <Paper sx={{ p: 3, borderRadius: 4 }}>
            <Typography sx={{ fontWeight: 700 }}>{t('nft.empty_title')}</Typography>
            <Typography sx={{ mt: 1, color: 'text.secondary', fontSize: '0.9rem' }}>{t('nft.empty_body')}</Typography>
          </Paper>
        )}

        {loaded && owner !== null && records.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
            {records.map((r) => (
              <NftCard
                key={`${reloadKey}:${r.chain}:${r.contract}:${r.tokenId}`}
                record={r}
                owner={owner}
                onRemove={(rec) => void onRemove(rec)}
              />
            ))}
          </Box>
        )}

        {loaded && owner !== null && (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{t('nft.note')}</Typography>
        )}
      </Box>

      {owner !== null && (
        <Fab
          color="primary"
          variant="extended"
          onClick={() => { setAddError(''); setAddOpen(true); }}
          sx={{ position: 'fixed', right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', textTransform: 'none', fontWeight: 700 }}
        >
          <AddIcon sx={{ mr: 1 }} />
          {t('nft.add')}
        </Fab>
      )}

      <Dialog open={addOpen} fullWidth maxWidth="xs" onClose={() => !adding && setAddOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('nft.add_title')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField select size="small" label={t('nft.chain')} value={addChain} onChange={(e) => setAddChain(e.target.value as ChainKey)}>
              {chainKeys.map((k) => (
                <MenuItem key={k} value={k}>{CHAINS[k].name}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('nft.contract')}
              value={addContract}
              onChange={(e) => setAddContract(e.target.value)}
              slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
            />
            <TextField
              size="small"
              label={t('nft.token_id')}
              value={addTokenId}
              onChange={(e) => setAddTokenId(e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            {addError && <Alert severity="error">{addError}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)} disabled={adding} color="inherit">{t('nft.cancel')}</Button>
          <Button variant="contained" onClick={() => void onAdd()} disabled={adding} sx={{ borderRadius: 999, fontWeight: 700 }}>
            {adding ? t('nft.adding') : t('nft.add_button')}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
