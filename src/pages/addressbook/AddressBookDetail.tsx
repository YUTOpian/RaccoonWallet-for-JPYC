import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Tabs, Tab, TextField, Button, IconButton, Avatar, List, ListItemButton,
  ListItemText, Chip, Drawer, ListItem, ListItemIcon, Dialog, DialogTitle, DialogActions,
  Snackbar,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import XIcon from '@mui/icons-material/X';
import TelegramIcon from '@mui/icons-material/Telegram';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AddressBookHelper, CustomChainsHelper } from '../../lib/storage';
import type { AddressBookRecord, ContactWallet, CustomChainRecord } from '../../lib/storage';
import { readFileAsDataUrl } from '../../lib/fileToDataUrl';
import type { ChainKey } from '../../lib/chains';
import { ADDRESS_BOOK_CHAIN_ICONS, findCustomAddressBookChain, isCustomAddressBookChain } from '../../lib/addressBookChains';
import type { AddressBookChainKey } from '../../lib/addressBookChains';
import { useAppStore } from '../../store/appStore';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import AppToolBar from '../../components/AppToolBar';
import CustomChainIcon from '../../components/CustomChainIcon';

type Tab = 'wallet' | 'profile';

// MUI's icon set has no official LINE mark, so this is a simplified stand-in (a rounded
// speech-bubble in LINE's brand green) used only for this app's own "open my LINE" link
// button - not a reproduction of LINE Corporation's logo artwork.
function LineIcon({ fontSize }: { fontSize?: 'small' | 'medium' }) {
  const size = fontSize === 'small' ? 20 : 24;
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      sx={{ width: size, height: size, display: 'block' }}
    >
      <rect x="1" y="3" width="22" height="18" rx="5" fill="#06C755" />
      <path
        d="M18.5 11.6c0-3-3-5.4-6.5-5.4s-6.5 2.4-6.5 5.4c0 2.7 2.4 4.9 5.6 5.4.2 0.05.5.15.6.35.1.2.05.5.03.7l-.1.6c-.03.2-.15.7.6.4.75-.3 4-2.4 5.5-4.1 1-1.1 1.8-2.3 1.8-3.3z"
        fill="#fff"
      />
    </Box>
  );
}

interface ProfileFormState {
  name: string;
  reading: string;
  phone: string;
  email: string;
  xAccount: string;
  lineAccount: string;
  telegramAccount: string;
  iconDataUrl: string;
  coverDataUrl: string;
}

// The friend-detail screen: "ウォレット" / "プロフィール" tabs behind a rounded avatar
// header with an X close button, ported from the original address-book writeup's friend
// profile + wallet screens. The exact same component also renders the person's own
// profile (opened as ?id=self from the nav drawer's avatar — see the writeup's "自分の
// プロフィール設定" section) since the original app reused the same screen for both;
// `isSelf` below just toggles the cover-photo strip and hides contact-deletion.
export default function AddressBookDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const isPickMode = searchParams.get('pick') === '1';
  const isNew = searchParams.get('new') === '1';
  const isSelf = id === AddressBookHelper.SELF_ID;

  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);
  const setPickedContactAddress = useAppStore((s) => s.setPickedContactAddress);

  const [record, setRecord] = useState<AddressBookRecord | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [editingProfile, setEditingProfile] = useState(isNew);
  const [form, setForm] = useState<ProfileFormState>({ name: '', reading: '', phone: '', email: '', xAccount: '', lineAccount: '', telegramAccount: '', iconDataUrl: '', coverDataUrl: '' });
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [actionSheetWallet, setActionSheetWallet] = useState<ContactWallet | null>(null);
  const [deleteWalletTarget, setDeleteWalletTarget] = useState<ContactWallet | null>(null);
  const [deleteContactDialogOpen, setDeleteContactDialogOpen] = useState(false);
  // Networks added by hand under 設定 > カスタムEVM - needed to resolve a `custom:${id}`
  // wallet's display name/icon (see lib/addressBookChains.ts) since that isn't part of the
  // fixed AddressBookChainKey union this screen otherwise looks up against.
  const [customChains, setCustomChains] = useState<CustomChainRecord[]>([]);

  const iconInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    CustomChainsHelper.list().then(setCustomChains);
  }, []);

  const load = useCallback(async () => {
    const found = await AddressBookHelper.get(id);
    setRecord(found);
    if (found) {
      setForm({
        name: found.name, reading: found.reading, phone: found.phone, email: found.email,
        xAccount: found.xAccount, lineAccount: found.lineAccount, telegramAccount: found.telegramAccount,
        iconDataUrl: found.iconDataUrl, coverDataUrl: found.coverDataUrl,
      });
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      navigate('/addressbook');
      return;
    }
    load();
  }, [id, load, navigate]);

  if (!record) return null;

  const chainCount = new Set(record.wallets.map((w) => w.chain)).size;

  const onClose = async () => {
    // A never-named draft (started via the "Add" button, then abandoned) shouldn't
    // linger as a blank contact in the list.
    if (isNew && record.name.trim().length === 0) {
      await AddressBookHelper.remove(id);
    }
    // Navigate explicitly to backPath (ADDRESS list, or home for the self profile) with
    // replace rather than navigate(-1). This screen can now be reached back-and-forth
    // several times via the wallet-form round trip (add/edit a wallet, then return here) -
    // each of those uses `replace` too (see AddressBookWalletForm's onSave/onDelete), so
    // there's never a stack of stale intermediate entries for navigate(-1) to have to
    // guess through. Explicitly targeting backPath also guarantees the toolbar's back
    // arrow always lands on ADDRESS - not wherever history happens to point - even for a
    // brand-new contact reached via 追加 → ウォレットを設定 → back.
    navigate(backPath, { replace: true });
  };

  const onStartEdit = () => {
    setForm({
      name: record.name, reading: record.reading, phone: record.phone, email: record.email,
      xAccount: record.xAccount, lineAccount: record.lineAccount, telegramAccount: record.telegramAccount,
      iconDataUrl: record.iconDataUrl, coverDataUrl: record.coverDataUrl,
    });
    setEditingProfile(true);
  };

  const onSaveProfile = async () => {
    if (form.name.trim().length === 0) {
      setErrorMessage(t('common.invalid_name'));
      return;
    }
    await AddressBookHelper.updateProfile(id, {
      name: form.name.trim(), reading: form.reading.trim(), phone: form.phone.trim(), email: form.email.trim(),
      xAccount: form.xAccount.trim().replace(/^@/, ''),
      lineAccount: form.lineAccount.trim(),
      telegramAccount: form.telegramAccount.trim().replace(/^@/, ''),
      iconDataUrl: form.iconDataUrl, coverDataUrl: form.coverDataUrl,
    });
    setEditingProfile(false);
    await load();
    // Drop the `new=1` marker from the URL once the contact has actually been named and
    // saved - otherwise a later round trip through ウォレットを設定 (which unmounts this
    // screen) remounts it with isNew still true, silently reopening the profile back into
    // edit mode (with a blank form flashing before `load()` refills it) instead of showing
    // the just-saved profile. `replace: true` swaps this history entry rather than adding
    // one, so it doesn't disturb the back-navigation fix in onClose above.
    if (isNew) {
      navigate(`/addressbook/detail?id=${id}`, { replace: true });
    }
  };

  const onIconPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const iconDataUrl = await readFileAsDataUrl(file);
    setForm((f) => ({ ...f, iconDataUrl }));
  };

  const onCoverPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const coverDataUrl = await readFileAsDataUrl(file);
    setForm((f) => ({ ...f, coverDataUrl }));
  };

  const onRemoveIcon = (e: React.MouseEvent) => {
    e.stopPropagation();
    setForm((f) => ({ ...f, iconDataUrl: '' }));
  };

  const onRemoveCover = (e: React.MouseEvent) => {
    e.stopPropagation();
    setForm((f) => ({ ...f, coverDataUrl: '' }));
  };

  const onDeleteContact = async () => {
    await AddressBookHelper.remove(id);
    // Same explicit-target fix as onClose above.
    navigate(backPath, { replace: true });
  };

  const onTapWallet = (wallet: ContactWallet) => {
    // Picking one of your own registered wallets as a send destination would let you send
    // to yourself - not allowed, so pick mode is disabled entirely for the self profile.
    if (isPickMode && !isSelf) {
      setPickedContactAddress(wallet.address);
      navigate(-2);
      return;
    }
    setActionSheetWallet(wallet);
  };

  const onCopyWallet = async (wallet: ContactWallet) => {
    setActionSheetWallet(null);
    try {
      await navigator.clipboard.writeText(wallet.address);
      setInfoMessage(t('addressbook.copied'));
    } catch {
      setErrorMessage(t('addressbook.copy_failed'));
    }
  };

  const onSendToWallet = (wallet: ContactWallet) => {
    setActionSheetWallet(null);
    if (isCustomAddressBookChain(wallet.chain)) {
      // A network added by hand under 設定 > カスタムEVM (see lib/addressBookChains.ts) -
      // not one of CHAINS's curated chains, so it goes through sendCustomChainId instead
      // of activeChain, same as Balance.tsx's onSendCustomChainNative. Still an EVM
      // account, so the rest of the flow (address pre-filled, land straight on the amount
      // screen) is identical to the curated-chain branch below.
      setSendCustomChainId(wallet.chain.slice('custom:'.length));
      setSendCurrency('native');
      setSendTokenMeta(null);
      setReceiverAddress(wallet.address);
      navigate('/send/amount');
      return;
    }
    setActiveChain(wallet.chain as ChainKey);
    setSendCustomChainId(null);
    setReceiverAddress(wallet.address);
    navigate('/send/amount');
  };

  const onEditWallet = (wallet: ContactWallet) => {
    setActionSheetWallet(null);
    navigate(`/addressbook/wallet?contactId=${id}&walletId=${wallet.id}`);
  };

  const onConfirmDeleteWallet = async () => {
    if (!deleteWalletTarget) return;
    await AddressBookHelper.removeWallet(id, deleteWalletTarget.id);
    setDeleteWalletTarget(null);
    await load();
  };

  const displayName = editingProfile ? form.name : record.name;
  const displayReading = editingProfile ? form.reading : record.reading;
  const showingPrompt = editingProfile && form.name.trim().length === 0;
  const toolbarTitle = isSelf ? t('addressbook.self_title') : (record.name.trim() || t('addressbook.new_contact_title'));
  const backPath = isSelf ? '/top?tab=home' : '/addressbook';

  return (
    <Box sx={{ pb: tab === 'wallet' ? 9 : 4 }}>
      {/* Both the self profile (opened from the nav drawer's avatar) and a friend's card
         (opened from the friend list) now share the same "←" toolbar as every other
         screen, rather than the friend card's previous "×" close button - the "×" read as
         a one-off, inconsistent way to leave this particular screen. onBack still runs the
         same cleanup (discarding a never-named draft contact) before navigating back. */}
      <AppToolBar title={toolbarTitle} back={backPath} onBack={onClose} />

      {isSelf && (
        // Sized to match the drawer's own cover-photo area (see SideMenu.tsx) at
        // its 280px width, rather than stretching to the full screen width - that made the
        // same image look like a thin, cropped sliver here despite being the identical
        // photo, since "cover" background sizing on a much wider box crops far more of it
        // away. The drawer's box grows taller than 96px when the wallet address needs two
        // lines, so this 280x96 is its minimum/typical size rather than an exact match in
        // every case - still a much closer preview than full screen width was.
        <Box sx={{ bgcolor: 'action.hover', py: 2, display: 'flex', justifyContent: 'center' }}>
          <Box
            onClick={() => editingProfile && coverInputRef.current?.click()}
            sx={{
              width: 280, height: 96, bgcolor: 'grey.300', position: 'relative',
              backgroundImage: form.coverDataUrl ? `url(${form.coverDataUrl})` : undefined,
              backgroundSize: 'cover', backgroundPosition: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: editingProfile ? 'pointer' : 'default',
            }}
          >
            {editingProfile && !form.coverDataUrl && (
              <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                <ImageOutlinedIcon fontSize="small" />
                <Typography variant="caption" sx={{ display: 'block' }}>{t('addressbook.change_cover')}</Typography>
              </Box>
            )}
            {editingProfile && form.coverDataUrl && (
              <IconButton
                size="small"
                onClick={onRemoveCover}
                aria-label={t('addressbook.remove_cover')}
                sx={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={onCoverPicked} />
          </Box>
        </Box>
      )}

      <Box sx={{ bgcolor: 'action.hover', pt: 3, pb: 2, px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ textAlign: 'center', minWidth: 56 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('addressbook.wallet_count')}</Typography>
            <Typography sx={{ fontWeight: 'bold' }}>{record.wallets.length}</Typography>
          </Box>

          <Box sx={{ textAlign: 'center', flexGrow: 1, px: 1 }}>
            <Box
              onClick={() => editingProfile && iconInputRef.current?.click()}
              sx={{ display: 'inline-block', position: 'relative', cursor: editingProfile ? 'pointer' : 'default', mb: 0.5 }}
            >
              <Avatar src={form.iconDataUrl || undefined} sx={{ width: 56, height: 56, mx: 'auto', bgcolor: 'grey.400' }}>
                {!form.iconDataUrl && <PersonIcon />}
              </Avatar>
              {editingProfile && form.iconDataUrl && (
                <IconButton
                  size="small"
                  onClick={onRemoveIcon}
                  aria-label={t('addressbook.remove_icon')}
                  sx={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              )}
              {editingProfile && (
                <Typography variant="caption" color="primary" sx={{ display: 'block' }}>{t('addressbook.change_icon')}</Typography>
              )}
              <input ref={iconInputRef} type="file" accept="image/*" hidden onChange={onIconPicked} />
            </Box>
            {showingPrompt ? (
              <Typography sx={{ fontWeight: 'bold' }}>{t('addressbook.profile_prompt')}</Typography>
            ) : (
              <>
                <Typography sx={{ fontWeight: 'bold' }}>{displayName}</Typography>
                {displayReading && <Typography variant="caption" color="text.secondary">{displayReading}</Typography>}
                {!editingProfile && (record.xAccount || record.lineAccount || record.telegramAccount) && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, mt: 0.5 }}>
                    {record.xAccount && (
                      <IconButton
                        size="small"
                        aria-label={t('addressbook.open_x_profile')}
                        onClick={() => window.open(`https://x.com/${record.xAccount}`, '_blank', 'noopener,noreferrer')}
                      >
                        <XIcon fontSize="small" />
                      </IconButton>
                    )}
                    {record.lineAccount && (
                      <IconButton
                        size="small"
                        aria-label={t('addressbook.open_line_profile')}
                        onClick={() => window.open(`https://line.me/ti/p/${record.lineAccount}`, '_blank', 'noopener,noreferrer')}
                      >
                        <LineIcon fontSize="small" />
                      </IconButton>
                    )}
                    {record.telegramAccount && (
                      <IconButton
                        size="small"
                        aria-label={t('addressbook.open_telegram_profile')}
                        onClick={() => window.open(`https://t.me/${record.telegramAccount}`, '_blank', 'noopener,noreferrer')}
                      >
                        <TelegramIcon fontSize="small" sx={{ color: '#26A5E4' }} />
                      </IconButton>
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>

          <Box sx={{ textAlign: 'center', minWidth: 56 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('addressbook.currency_count')}</Typography>
            <Typography sx={{ fontWeight: 'bold' }}>{chainCount}</Typography>
          </Box>
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth" textColor="primary" indicatorColor="primary">
        <Tab value="wallet" label={t('addressbook.wallet_tab')} />
        <Tab value="profile" label={t('addressbook.profile_tab')} />
      </Tabs>

      {tab === 'profile' && (
        <Box sx={{ p: 2 }}>
          {editingProfile ? (
            <>
              <TextField label={t('common.name')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth margin="normal" autoFocus />
              <TextField label={t('addressbook.reading')} value={form.reading} onChange={(e) => setForm((f) => ({ ...f, reading: e.target.value }))} fullWidth margin="normal" />
              <TextField label={t('addressbook.phone')} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} fullWidth margin="normal" />
              <TextField label={t('addressbook.email')} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth margin="normal" />
              <TextField
                label={t('addressbook.x_account')}
                value={form.xAccount}
                onChange={(e) => setForm((f) => ({ ...f, xAccount: e.target.value }))}
                fullWidth
                margin="normal"
                placeholder="username"
                slotProps={{ input: { startAdornment: <XIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
              />
              <TextField
                label={t('addressbook.line_account')}
                value={form.lineAccount}
                onChange={(e) => setForm((f) => ({ ...f, lineAccount: e.target.value }))}
                fullWidth
                margin="normal"
                placeholder="LINE ID"
                slotProps={{ input: { startAdornment: <LineIcon fontSize="small" /> } }}
                sx={{ '& .MuiInputAdornment-root': { mr: 1 } }}
              />
              <TextField
                label={t('addressbook.telegram_account')}
                value={form.telegramAccount}
                onChange={(e) => setForm((f) => ({ ...f, telegramAccount: e.target.value }))}
                fullWidth
                margin="normal"
                placeholder="username"
                slotProps={{ input: { startAdornment: <TelegramIcon fontSize="small" sx={{ mr: 1, color: '#26A5E4' }} /> } }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Button variant="contained" onClick={onSaveProfile} sx={{ minWidth: 160 }}>{t('common.done')}</Button>
              </Box>
            </>
          ) : (
            <>
              <TextField label={t('common.name')} value={record.name} fullWidth margin="normal" slotProps={{ input: { readOnly: true } }} variant="standard" />
              <TextField label={t('addressbook.reading')} value={record.reading} fullWidth margin="normal" slotProps={{ input: { readOnly: true } }} variant="standard" />
              {isSelf && record.wallets.filter((w) => w.isMaster).length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                  ℹ️ {t('addressbook.no_master_wallet')}
                </Typography>
              )}
              <TextField label={t('addressbook.phone')} value={record.phone} fullWidth margin="normal" slotProps={{ input: { readOnly: true } }} variant="standard" />
              <TextField label={t('addressbook.email')} value={record.email} fullWidth margin="normal" slotProps={{ input: { readOnly: true } }} variant="standard" />
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Button variant="contained" onClick={onStartEdit} sx={{ minWidth: 160 }}>{t('common.edit')}</Button>
              </Box>
              {!isSelf && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <Button color="error" onClick={() => setDeleteContactDialogOpen(true)}>{t('addressbook.delete_contact')}</Button>
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {tab === 'wallet' && (
        <Box>
          {record.wallets.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 8, px: 4 }}>
              <Typography align="center" color="text.secondary">{t('addressbook.wallet_empty_message')}</Typography>
            </Box>
          ) : (
            <List>
              {record.wallets.map((wallet) => (
                <ListItemButton key={wallet.id} onClick={() => onTapWallet(wallet)} sx={{ py: 1.5 }}>
                  {isCustomAddressBookChain(wallet.chain) ? (
                    <CustomChainIcon iconDataUrl={findCustomAddressBookChain(wallet.chain, customChains)?.iconDataUrl} size={28} sx={{ mr: 2 }} />
                  ) : (
                    <Box component="img" src={ADDRESS_BOOK_CHAIN_ICONS[wallet.chain as AddressBookChainKey]} sx={{ width: 28, height: 28, borderRadius: '50%', mr: 2 }} />
                  )}
                  <ListItemText
                    primary={wallet.name}
                    secondary={(
                      <>
                        <Typography component="span" variant="body2" sx={{ display: 'block', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                          {wallet.address}
                        </Typography>
                        {wallet.isMaster && (
                          <Chip label="Master" size="small" icon={<span style={{ fontSize: 12 }}>👑</span>} sx={{ mt: 0.5, bgcolor: 'nemOrange', color: '#fff' }} />
                        )}
                      </>
                    )}
                  />
                </ListItemButton>
              ))}
            </List>
          )}

          <Box sx={{ position: 'fixed', bottom: 'var(--bottom-nav-h, 0px)', left: 'var(--side-menu-w, 0px)', right: 0, maxWidth: 480, mx: 'auto', pb: 'var(--safe-bottom, 0px)', bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
            <Button
              fullWidth
              startIcon={<AddIcon />}
              onClick={() => navigate(`/addressbook/wallet?contactId=${id}${isPickMode ? '&pick=1' : ''}`)}
              sx={{ py: 1.5, borderRadius: 0 }}
            >
              {t('common.add')}
            </Button>
          </Box>
        </Box>
      )}

      {/* コピー / 送金 / 編集 / 削除 アクションシート */}
      <Drawer anchor="bottom" open={actionSheetWallet !== null} onClose={() => setActionSheetWallet(null)}>
        {actionSheetWallet && (
          <List sx={{ pb: 'env(safe-area-inset-bottom)' }}>
            <ListItem disablePadding>
              <ListItemButton onClick={() => onCopyWallet(actionSheetWallet)}>
                <ListItemIcon><ContentCopyOutlinedIcon /></ListItemIcon>
                <ListItemText primary={t('addressbook.copy')} />
              </ListItemButton>
            </ListItem>
            {!isSelf && (
              <ListItem disablePadding>
                <ListItemButton onClick={() => onSendToWallet(actionSheetWallet)}>
                  <ListItemIcon><SendOutlinedIcon /></ListItemIcon>
                  <ListItemText primary={t('addressbook.send')} />
                </ListItemButton>
              </ListItem>
            )}
            <ListItem disablePadding>
              <ListItemButton onClick={() => onEditWallet(actionSheetWallet)}>
                <ListItemIcon><EditIcon /></ListItemIcon>
                <ListItemText primary={t('common.edit')} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setDeleteWalletTarget(actionSheetWallet); setActionSheetWallet(null); }}>
                <ListItemIcon><DeleteOutlineOutlinedIcon color="error" /></ListItemIcon>
                <ListItemText primary={t('common.delete')} sx={{ color: 'error.main' }} />
              </ListItemButton>
            </ListItem>
          </List>
        )}
      </Drawer>

      <Dialog open={deleteWalletTarget !== null} onClose={() => setDeleteWalletTarget(null)}>
        <DialogTitle>{t('addressbook.delete_wallet_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteWalletTarget(null)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmDeleteWallet} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteContactDialogOpen} onClose={() => setDeleteContactDialogOpen(false)}>
        <DialogTitle>{t('addressbook.delete_confirm', { count: 1 })}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteContactDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onDeleteContact} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={infoMessage.length > 0}
        autoHideDuration={2000}
        onClose={() => setInfoMessage('')}
        message={infoMessage}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
