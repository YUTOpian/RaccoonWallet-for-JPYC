import { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, IconButton, Tooltip, Dialog, DialogTitle, DialogActions, Button,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import CustomChainIcon from '../../components/CustomChainIcon';
import { AddressBookHelper, CustomChainsHelper } from '../../lib/storage';
import type { CustomChainRecord } from '../../lib/storage';
import {
  ADDRESS_BOOK_CHAIN_ICONS, ADDRESS_BOOK_CHAIN_ORDER,
  addressBookChainName, findCustomAddressBookChain, isCustomAddressBookChain,
  isValidAddressForChain, normalizeAddressForChain,
} from '../../lib/addressBookChains';
import type { AddressBookChainKey } from '../../lib/addressBookChains';

// "ウォレットを設定" — add/edit a single wallet on a contact (or on the self profile).
// Ported from the original NEM-only "Masterウォレット設定" screen (see the 2019-04
// address-book writeup): that version showed a single fixed network logo; here the same
// big network-logo slot is a picker across this app's EVM chains, since a contact's wallet
// can be on any one of them.
export default function AddressBookWalletForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactId = searchParams.get('contactId') ?? '';
  const walletId = searchParams.get('walletId');
  const isEdit = walletId !== null;
  const backTo = `/addressbook/detail?id=${contactId}${searchParams.get('pick') === '1' ? '&pick=1' : ''}`;

  const [chain, setChain] = useState<string>('avalanche');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [isMaster, setIsMaster] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);
  // Networks added by hand under 設定 > カスタムEVM - offered in the chain picker below
  // (as `custom:${id}`, see lib/addressBookChains.ts) alongside the curated EVM chains,
  // so a contact's wallet on one of those isn't unrepresentable here.
  const [customChains, setCustomChains] = useState<CustomChainRecord[]>([]);

  const selectableChains: string[] = [...ADDRESS_BOOK_CHAIN_ORDER, ...customChains.map((c) => `custom:${c.id}`)];

  useEffect(() => {
    CustomChainsHelper.list().then(setCustomChains);
  }, []);

  useEffect(() => {
    if (!isEdit || !walletId) return;
    (async () => {
      const contact = await AddressBookHelper.get(contactId);
      const wallet = contact?.wallets.find((w) => w.id === walletId);
      if (wallet) {
        setChain(wallet.chain);
        setName(wallet.name);
        setAddress(wallet.address);
        setIsMaster(wallet.isMaster);
      }
      setLoaded(true);
    })();
  }, [contactId, isEdit, walletId]);

  const onSave = async () => {
    if (name.trim().length === 0) {
      setErrorMessage(t('common.invalid_name'));
      return;
    }
    if (!isValidAddressForChain(chain, address)) {
      setErrorMessage(t('common.invalid_address'));
      return;
    }
    const payload = { chain, name: name.trim(), address: normalizeAddressForChain(chain, address), isMaster };
    if (isEdit && walletId) {
      await AddressBookHelper.updateWallet(contactId, walletId, payload);
    } else {
      await AddressBookHelper.addWallet(contactId, payload);
    }
    // `replace: true` swaps this history entry for the contact-detail screen instead of
    // pushing a new one on top of it - otherwise this form's own entry lingered in
    // history, and navigating back to it later (e.g. after several add/edit round trips)
    // could remount the contact-detail screen from a stale intermediate history state
    // instead of always landing back on it fresh.
    navigate(backTo, { replace: true });
  };

  const onDelete = async () => {
    if (!walletId) return;
    await AddressBookHelper.removeWallet(contactId, walletId);
    navigate(backTo, { replace: true });
  };

  if (!loaded) return null;

  return (
    <Box sx={{ pb: 9 }}>
      <AppToolBar back={backTo} title={t('addressbook.wallet_form_title')} />

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3, bgcolor: 'action.hover' }}>
        {isCustomAddressBookChain(chain) ? (
          <CustomChainIcon iconDataUrl={findCustomAddressBookChain(chain, customChains)?.iconDataUrl} size={72} />
        ) : (
          <Box component="img" src={ADDRESS_BOOK_CHAIN_ICONS[chain as AddressBookChainKey]} sx={{ width: 72, height: 72, borderRadius: '50%' }} />
        )}
        <Typography sx={{ mt: 1, fontWeight: 'bold' }}>{addressBookChainName(chain, customChains)}</Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          {selectableChains.map((key) => (
            <IconButton key={key} onClick={() => setChain(key)} sx={{ p: 0.5 }}>
              {isCustomAddressBookChain(key) ? (
                <CustomChainIcon
                  iconDataUrl={findCustomAddressBookChain(key, customChains)?.iconDataUrl}
                  size={32}
                  sx={{ outline: (theme) => (chain === key ? `2px solid ${theme.palette.primary.main}` : 'none'), opacity: chain === key ? 1 : 0.5 }}
                />
              ) : (
                <Box
                  component="img"
                  src={ADDRESS_BOOK_CHAIN_ICONS[key as AddressBookChainKey]}
                  sx={{
                    width: 32, height: 32, borderRadius: '50%',
                    outline: (theme) => (chain === key ? `2px solid ${theme.palette.primary.main}` : 'none'),
                    opacity: chain === key ? 1 : 0.5,
                  }}
                />
              )}
            </IconButton>
          ))}
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">{t('addressbook.wallet_info_section')}</Typography>
        <TextField
          label={t('addressbook.wallet_name_input')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          margin="normal"
          autoFocus
        />
        <TextField
          label={t('addressbook.address_input')}
          placeholder="0x..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          fullWidth
          margin="normal"
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary">{t('addressbook.wallet_attribute_section')}</Typography>
          <Tooltip title={t('addressbook.master_info')}>
            <InfoOutlinedIcon fontSize="small" color="disabled" />
          </Tooltip>
        </Box>
        <Box sx={{ mt: 1 }}>
          <Button
            variant={isMaster ? 'contained' : 'outlined'}
            onClick={() => setIsMaster((v) => !v)}
            sx={isMaster ? { bgcolor: 'nemOrange', '&:hover': { bgcolor: 'nemOrange' } } : { color: 'primary.main' }}
          >
            👑 Master
          </Button>
        </Box>

        {isEdit && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <Button variant="outlined" color="error" onClick={() => setDeleteDialogOpen(true)} sx={{ minWidth: 160 }}>
              {t('common.delete')}
            </Button>
          </Box>
        )}
      </Box>

      {/* 完了 - moved down here from a top-right checkmark icon, which was easy to miss;
          a full-width button anchored to the bottom of the screen (same fixed-bar pattern
          as the wallet-tab's 追加 button on AddressBookDetail) is a much clearer primary
          action for a form like this. */}
      <Box sx={{ position: 'fixed', bottom: 'var(--bottom-nav-h, 0px)', left: 'var(--side-menu-w, 0px)', right: 0, maxWidth: 480, mx: 'auto', pb: 'var(--safe-bottom, 0px)', bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
        <Button fullWidth variant="contained" onClick={onSave} sx={{ py: 1.5, borderRadius: 0 }}>
          {t('common.done')}
        </Button>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('addressbook.delete_wallet_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onDelete} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
