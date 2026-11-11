import { useCallback, useEffect, useState } from 'react';
import {
  Box, ButtonBase, Avatar, Checkbox,
  Typography, Divider, Dialog, DialogTitle, DialogActions, Button,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AccountsHeader from '../../components/AccountsHeader';
import { AddressBookHelper } from '../../lib/storage';
import type { AddressBookRecord } from '../../lib/storage';
import { TILE_GRID_SX } from '../../lib/tileGrid';

// "フレンドリスト" — the address book's top screen, reached from the bottom nav's ADDRESS
// slot (see BottomNav) - so it shares the same RaccoonAppBar/WalletBar/BottomNav shell as
// Home/Token/Swap rather than a per-screen back+title bar. Ported from the original
// RaccoonWallet feature (see 2019-04's "新機能「アドレス帳」追加"): a plain local contact
// list, with "選択"(bulk-select/delete) and "Add" actions - the select/cancel-delete row
// is docked as its own fixed bar directly above BottomNav (see SELECT_BAR_HEIGHT below),
// since BottomNav itself now owns the outermost fixed-bottom position.
//
// Doubles as a picker when opened as /addressbook?pick=1 (from Send's address-book
// button) — tapping a friend there drills into their wallet tab so a specific wallet
// can be picked, rather than opening the profile for editing.
// The select/cancel-delete row below is a fixed bar docked to the bottom of the screen
// (the app-wide bottom nav no longer exists - navigation lives in the side menu).
const SELECT_BAR_HEIGHT = 56;

export default function AddressBookList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPickMode = searchParams.get('pick') === '1';

  const [records, setRecords] = useState<AddressBookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setRecords(await AddressBookHelper.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRowTap = (record: AddressBookRecord) => {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(record.id)) next.delete(record.id); else next.add(record.id);
        return next;
      });
      return;
    }
    navigate(`/addressbook/detail?id=${record.id}${isPickMode ? '&pick=1' : ''}`);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const onAdd = async () => {
    // Creates the (initially blank) contact record right away, then opens it straight
    // into the profile form in edit mode - see AddressBookDetail's `isNew` handling,
    // which deletes this draft again if the person backs out without naming it.
    const record = await AddressBookHelper.add({ name: '', reading: '', phone: '', email: '', xAccount: '', lineAccount: '', telegramAccount: '', iconDataUrl: '', coverDataUrl: '' });
    navigate(`/addressbook/detail?id=${record.id}&new=1`);
  };

  const onConfirmDelete = async () => {
    for (const id of selectedIds) {
      await AddressBookHelper.remove(id);
    }
    setDeleteDialogOpen(false);
    exitSelectMode();
    await load();
  };

  return (
    <Box sx={{ width: '100%', pb: `${SELECT_BAR_HEIGHT}px` }}>
      <AccountsHeader hideTabs={isPickMode} title={isPickMode ? t('addressbook.title') : undefined} />

      {!loading && records.length === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 4, px: 4 }}>
          <Typography align="center" color="text.secondary">{t('addressbook.empty_message')}</Typography>
        </Box>
      )}
      <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5, p: 2 }}>
        {records.map((record) => {
          const selected = selectedIds.has(record.id);
          return (
            <ButtonBase
              key={record.id}
              onClick={() => onRowTap(record)}
              sx={{
                position: 'relative', aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 0.75, p: 1.5, borderRadius: 2,
                border: 2, borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'action.selected' : 'background.paper',
              }}
            >
              {selectMode && (
                <Checkbox checked={selected} tabIndex={-1} disableRipple sx={{ position: 'absolute', top: 0, left: 0 }} />
              )}
              <Avatar src={record.iconDataUrl || undefined} sx={{ width: 64, height: 64 }}>
                {!record.iconDataUrl && <PersonIcon fontSize="large" />}
              </Avatar>
              <Typography noWrap sx={{ fontWeight: 'bold', width: '100%', textAlign: 'center' }}>{record.name}</Typography>
              {record.reading && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ width: '100%', textAlign: 'center' }}>
                  {record.reading}
                </Typography>
              )}
            </ButtonBase>
          );
        })}
        {!selectMode && (
          <ButtonBase
            onClick={onAdd}
            sx={{
              aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 0.5, borderRadius: 2, border: 2, borderStyle: 'dashed',
              borderColor: 'primary.main', color: 'primary.main',
            }}
          >
            <AddIcon fontSize="large" />
            <Typography sx={{ fontWeight: 'bold' }}>{t('addressbook.add_contact')}</Typography>
          </ButtonBase>
        )}
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('addressbook.delete_confirm', { count: selectedIds.size })}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmDelete} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* Fixed to the screen bottom rather than inline in the page flow - see the class doc
         above for why. */}
      <Box
        sx={{
          position: 'fixed', bottom: 'var(--bottom-nav-h, 0px)', left: 'var(--side-menu-w, 0px)', right: 0, maxWidth: 480, mx: 'auto', pb: 'var(--safe-bottom, 0px)',
          minHeight: SELECT_BAR_HEIGHT, display: 'flex', bgcolor: 'background.paper',
          borderTop: 1, borderColor: 'divider',
        }}
      >
        {selectMode ? (
          <>
            <Button
              fullWidth
              onClick={exitSelectMode}
              sx={{ py: 1, borderRadius: 0, display: 'flex', flexDirection: 'column', color: 'text.secondary' }}
            >
              <CloseIcon fontSize="small" />
              <Typography variant="caption">{t('common.cancel')}</Typography>
            </Button>
            <Divider orientation="vertical" flexItem />
            <Button
              fullWidth
              disabled={selectedIds.size === 0}
              onClick={() => setDeleteDialogOpen(true)}
              sx={{ py: 1, borderRadius: 0, display: 'flex', flexDirection: 'column' }}
              color="error"
            >
              <DeleteOutlineOutlinedIcon fontSize="small" />
              <Typography variant="caption">{t('common.delete')}</Typography>
            </Button>
          </>
        ) : (
          <Button
            fullWidth
            onClick={() => setSelectMode(true)}
            disabled={records.length === 0}
            sx={{ py: 1, borderRadius: 0, display: 'flex', flexDirection: 'column', color: 'primary.main' }}
          >
            <CheckIcon fontSize="small" />
            <Typography variant="caption">{t('common.select')}</Typography>
          </Button>
        )}
      </Box>

    </Box>
  );
}

