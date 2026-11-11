import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, Typography, Button, IconButton, Chip, List, ListItem, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Divider,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import DownloadIcon from '@mui/icons-material/Download';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { QRCodeCanvas } from 'qrcode.react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { ProductsHelper, SalesHelper } from '../../lib/storage';
import type { ProductRecord, SaleRecord } from '../../lib/storage';
import { buildProductTag } from '../../lib/productTag';
import { downloadQrTagImage } from '../../lib/qrTagImage';

// 📦 在庫管理 for a single product: shows the current stock, 入荷 (restock), a quick manual
// 在庫を減らす (stock decrement, for items sold outside QRレジスター), and the resulting
// 販売履歴. Actual point-of-sale checkout — scanning this product's QR tag, generating a
// JPYC payment QR, watching for on-chain payment — happens on QRレジスター
// (pages/qrlab/QRRegister.tsx), not here, so there's deliberately no 販売 button on this
// screen anymore (see the removed navigate to MarketplaceCollect).
export default function MarketplaceDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [restockOpen, setRestockOpen] = useState(false);
  const [restockQty, setRestockQty] = useState('1');
  const [decreaseOpen, setDecreaseOpen] = useState(false);
  const [decreaseQty, setDecreaseQty] = useState('1');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [undoSaleId, setUndoSaleId] = useState<string | null>(null);
  const [qrTagOpen, setQrTagOpen] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, s] = await Promise.all([ProductsHelper.get(id), SalesHelper.listByProduct(id)]);
    setProduct(p);
    setSales(s);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRestock = async () => {
    const qty = Math.floor(Number(restockQty));
    if (!isFinite(qty) || qty <= 0) {
      setErrorMessage(t('marketplace.invalid_quantity'));
      return;
    }
    await ProductsHelper.restock(id, qty);
    setRestockOpen(false);
    setRestockQty('1');
    await load();
  };

  const onDecreaseStock = async () => {
    const qty = Math.floor(Number(decreaseQty));
    if (!isFinite(qty) || qty <= 0) {
      setErrorMessage(t('marketplace.invalid_quantity'));
      return;
    }
    await ProductsHelper.decrementStock(id, qty);
    setDecreaseOpen(false);
    setDecreaseQty('1');
    await load();
  };

  const onConfirmUndoSale = async () => {
    if (!undoSaleId) return;
    await SalesHelper.remove(undoSaleId);
    setUndoSaleId(null);
    await load();
  };

  const onDeleteProduct = async () => {
    await ProductsHelper.remove(id);
    navigate('/marketplace');
  };

  const onDownloadQrTag = () => {
    if (!product || !qrCanvasRef.current) return;
    downloadQrTagImage({
      qrCanvas: qrCanvasRef.current,
      productName: product.name,
      priceLabel: `${product.price.toLocaleString()} ${t('marketplace.price_unit')}`,
    });
  };

  if (loading) {
    return null;
  }

  if (!product) {
    return (
      <Box>
        <AppToolBar back="/marketplace" title={t('marketplace.detail_title')} />
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('marketplace.product_not_found')}</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <AppToolBar back="/marketplace" title={product.name} />

      <Box sx={{ p: 2 }}>
        <Card sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Typography variant="h6">{product.name}</Typography>
            <Box sx={{ display: 'flex' }}>
              <IconButton size="small" aria-label={t('marketplace.show_qr_tag')} onClick={() => setQrTagOpen(true)}>
                <QrCode2Icon color="primary" />
              </IconButton>
              <IconButton size="small" aria-label={t('common.edit')} onClick={() => navigate(`/marketplace/form?id=${product.id}`)}>
                <EditIcon color="primary" />
              </IconButton>
            </Box>
          </Box>

          <Typography sx={{ fontSize: 'x-large', fontWeight: 'bold', mt: 1 }}>
            {product.price.toLocaleString()} <Typography component="span" sx={{ fontSize: 'medium' }}>{t('marketplace.price_unit')}</Typography>
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Typography color="text.secondary">
              {t('marketplace.stock')}: {product.stock}{t('marketplace.stock_unit')}
            </Typography>
            {product.stock <= 0 && <Chip size="small" color="error" label={t('marketplace.out_of_stock')} />}
          </Box>

          {product.description && (
            <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-line' }}>{product.description}</Typography>
          )}
          {product.memo && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, whiteSpace: 'pre-line' }}>
              {t('marketplace.memo')}: {product.memo}
            </Typography>
          )}
        </Card>

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <Button variant="outlined" color="primary" fullWidth onClick={() => setRestockOpen(true)}>
            {t('marketplace.restock')}
          </Button>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            startIcon={<RemoveCircleOutlineIcon />}
            disabled={product.stock <= 1}
            onClick={() => setDecreaseOpen(true)}
          >
            {t('marketplace.decrease_stock')}
          </Button>
        </Box>

        <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>{t('marketplace.sales_history')}</Typography>
        {sales.length === 0 ? (
          <Typography color="text.secondary">{t('marketplace.no_sales_history')}</Typography>
        ) : (
          <Card>
            <List sx={{ py: 0 }}>
              {sales.map((sale, i) => (
                <Box key={sale.id}>
                  <ListItem
                    secondaryAction={
                      <IconButton edge="end" aria-label={t('common.delete')} onClick={() => setUndoSaleId(sale.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={`${sale.quantity}${t('marketplace.stock_unit')} × ${sale.unitPrice.toLocaleString()} ${t('marketplace.price_unit')} = ${sale.amount.toLocaleString()} ${t('marketplace.price_unit')}`}
                      secondary={sale.note ? `${new Date(sale.timestamp).toLocaleString()} ・ ${sale.note}` : new Date(sale.timestamp).toLocaleString()}
                    />
                  </ListItem>
                  {i < sales.length - 1 && <Divider />}
                </Box>
              ))}
            </List>
          </Card>
        )}

        <Button variant="outlined" color="error" fullWidth sx={{ mt: 4 }} onClick={() => setDeleteDialogOpen(true)}>
          {t('common.delete')}
        </Button>
      </Box>

      <Dialog open={restockOpen} onClose={() => setRestockOpen(false)}>
        <DialogTitle>{t('marketplace.restock_title')}</DialogTitle>
        <DialogContent>
          <TextField
            type="number"
            autoFocus
            fullWidth
            value={restockQty}
            onChange={(e) => setRestockQty(e.target.value)}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestockOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onRestock} variant="contained">{t('marketplace.restock')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={decreaseOpen} onClose={() => setDecreaseOpen(false)}>
        <DialogTitle>{t('marketplace.decrease_stock_title')}</DialogTitle>
        <DialogContent>
          <TextField
            type="number"
            autoFocus
            fullWidth
            value={decreaseQty}
            onChange={(e) => setDecreaseQty(e.target.value)}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            helperText={t('marketplace.decrease_stock_min_note')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecreaseOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onDecreaseStock} variant="contained">{t('marketplace.decrease_stock')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={qrTagOpen} onClose={() => setQrTagOpen(false)}>
        <DialogTitle>{t('marketplace.qr_tag_title')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 1 }}>
            <QRCodeCanvas ref={qrCanvasRef} value={buildProductTag(product.id)} size={200} />
            <Typography sx={{ mt: 2, fontWeight: 'bold' }}>{product.name}</Typography>
            <Typography sx={{ mb: 1 }}>{product.price.toLocaleString()} {t('marketplace.price_unit')}</Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              {t('marketplace.qr_tag_hint')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrTagOpen(false)}>{t('common.close')}</Button>
          <Button onClick={onDownloadQrTag} variant="contained" startIcon={<DownloadIcon />}>
            {t('marketplace.download_qr_tag')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.delete_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onDeleteProduct} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={undoSaleId !== null} onClose={() => setUndoSaleId(null)}>
        <DialogTitle>{t('marketplace.undo_sale_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setUndoSaleId(null)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmUndoSale} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
