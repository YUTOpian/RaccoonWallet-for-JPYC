import { useEffect, useState } from 'react';
import { Box, Card, TextField, Button, Typography, Dialog, DialogTitle, DialogActions } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { ProductsHelper } from '../../lib/storage';

// 🏷️ 商品登録: handles both "add" (no ?id) and "edit" (?id=...), same split as
// AddressBookForm. Stock itself is only editable here as the *initial* stock at
// registration time — after that, changing it goes through the 入荷 (restock) and 販売
// (sell) actions on MarketplaceDetail instead, so every later stock change is traceable.
export default function MarketplaceForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const isEdit = id !== null;

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [description, setDescription] = useState('');
  const [memo, setMemo] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const record = await ProductsHelper.get(id);
      if (record) {
        setName(record.name);
        setPrice(String(record.price));
        setStock(String(record.stock));
        setDescription(record.description);
        setMemo(record.memo);
      }
      setLoaded(true);
    })();
  }, [id]);

  const onSave = async () => {
    if (name.trim().length === 0) {
      setErrorMessage(t('common.invalid_name'));
      return;
    }
    const priceValue = Number(price);
    if (!isFinite(priceValue) || priceValue < 0) {
      setErrorMessage(t('marketplace.invalid_price'));
      return;
    }

    if (isEdit && id) {
      await ProductsHelper.update(id, {
        name: name.trim(),
        price: priceValue,
        description: description.trim(),
        memo: memo.trim(),
      });
    } else {
      const stockValue = Number(stock);
      if (!isFinite(stockValue) || stockValue < 0) {
        setErrorMessage(t('marketplace.invalid_quantity'));
        return;
      }
      await ProductsHelper.add({
        name: name.trim(),
        price: priceValue,
        stock: Math.floor(stockValue),
        description: description.trim(),
        memo: memo.trim(),
      });
    }
    navigate('/marketplace');
  };

  const onDelete = async () => {
    if (!id) return;
    await ProductsHelper.remove(id);
    navigate('/marketplace');
  };

  if (!loaded) {
    return null;
  }

  return (
    <Box>
      <AppToolBar back="/marketplace" title={isEdit ? t('marketplace.edit_title') : t('marketplace.add_title')} />
      <Box sx={{ p: 2 }}>
        <Card sx={{ p: 2 }}>
          <TextField
            label={t('marketplace.product_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            margin="normal"
            autoFocus
          />
          <TextField
            label={`${t('marketplace.price')} (${t('marketplace.price_unit')})`}
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          />
          {isEdit ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('marketplace.stock')}: {stock}{t('marketplace.stock_unit')}
              <br />
              {t('marketplace.current_stock_note')}
            </Typography>
          ) : (
            <TextField
              label={t('marketplace.initial_stock')}
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              fullWidth
              margin="normal"
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />
          )}
          <TextField
            label={t('marketplace.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            margin="normal"
            multiline
            minRows={2}
          />
          <TextField
            label={t('marketplace.memo')}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            fullWidth
            margin="normal"
            multiline
            minRows={2}
          />
        </Card>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 3 }}>
          <Button variant="contained" color="primary" onClick={onSave} sx={{ minWidth: 160 }}>
            {t('common.done')}
          </Button>
          {isEdit && (
            <Button variant="outlined" color="error" onClick={() => setDeleteDialogOpen(true)} sx={{ minWidth: 160 }}>
              {t('common.delete')}
            </Button>
          )}
        </Box>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.delete_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onDelete} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
