import { useCallback, useEffect, useState } from 'react';
import {
  Box, Card, Typography, Button, IconButton, List, ListItem, ListItemText,
  Divider, Dialog, DialogTitle, DialogActions,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { SalesHelper } from '../../lib/storage';
import type { SaleRecord } from '../../lib/storage';
import { downloadSalesCsv } from '../../lib/csvExport';

// 全商品を横断した「販売履歴」一覧。個別の取り消し(在庫が戻る、MarketplaceDetailの取り消し
// と同じ挙動)に加えて、記録の整理用に「すべての履歴を削除」(在庫には触れない、単なるログ
// の削除)を用意している。
export default function MarketplaceSalesHistory() {
  const { t } = useTranslation();

  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoSaleId, setUndoSaleId] = useState<string | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSales(await SalesHelper.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onConfirmUndoSale = async () => {
    if (!undoSaleId) return;
    await SalesHelper.remove(undoSaleId);
    setUndoSaleId(null);
    await load();
  };

  const onConfirmClearAll = async () => {
    await SalesHelper.clearAllHistory();
    setClearAllConfirmOpen(false);
    await load();
  };

  const onExportCsv = () => {
    downloadSalesCsv(sales);
  };

  return (
    <Box>
      <AppToolBar back="/marketplace" title={t('marketplace.history_title')} />

      <Box sx={{ p: 2 }}>
        {!loading && sales.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ mt: 6 }}>
            {t('marketplace.no_sales_history')}
          </Typography>
        ) : (
          <>
            <Card sx={{ mb: 2 }}>
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
                        primary={`${sale.productName}: ${sale.quantity}${t('marketplace.stock_unit')} × ${sale.unitPrice.toLocaleString()} ${t('marketplace.price_unit')} = ${sale.amount.toLocaleString()} ${t('marketplace.price_unit')}`}
                        secondary={sale.note ? `${new Date(sale.timestamp).toLocaleString()} ・ ${sale.note}` : new Date(sale.timestamp).toLocaleString()}
                      />
                    </ListItem>
                    {i < sales.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>
            </Card>

            <Button
              variant="outlined"
              color="primary"
              fullWidth
              startIcon={<FileDownloadIcon />}
              sx={{ mb: 2 }}
              onClick={onExportCsv}
            >
              {t('marketplace.export_csv')}
            </Button>

            <Button
              variant="outlined"
              color="error"
              fullWidth
              startIcon={<DeleteForeverIcon />}
              onClick={() => setClearAllConfirmOpen(true)}
            >
              {t('marketplace.clear_all_history')}
            </Button>
          </>
        )}
      </Box>

      <Dialog open={undoSaleId !== null} onClose={() => setUndoSaleId(null)}>
        <DialogTitle>{t('marketplace.undo_sale_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setUndoSaleId(null)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmUndoSale} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={clearAllConfirmOpen} onClose={() => setClearAllConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.clear_all_history_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setClearAllConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmClearAll} color="error">{t('marketplace.clear_all_history')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
