import { useCallback, useEffect, useState } from 'react';
import { Box, ButtonBase, Chip, Typography, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { ProductsHelper } from '../../lib/storage';
import type { ProductRecord } from '../../lib/storage';
import { TILE_GRID_SX } from '../../lib/tileGrid';

// The "売り物リスト" home screen: a manual-accounting + inventory tool for selling a small
// set of items (event goods, NFTs, whatever). Shows 📋 売り物一覧 (the product list itself,
// with 🔴 在庫切れ called out per-row), same as AddressBookList is the home screen for the
// address book feature. Full sales history (across every product, with delete/clear) lives
// on MarketplaceSalesHistory.
export default function MarketplaceList() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await ProductsHelper.list();
    setProducts(list);
    setLoading(false);
  }, []);

  // Re-loaded every time this screen becomes visible (not just on first mount) so a sale
  // recorded on MarketplaceCollect is reflected here immediately when navigating back.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return (
    <Box>
      <AppToolBar
        back="/top?tab=qrlab"
        onBack={() => navigate('/top?tab=qrlab')}
        title={t('marketplace.title')}
        actions={
          <IconButton aria-label={t('marketplace.view_sales_history')} onClick={() => navigate('/marketplace/history')}>
            <HistoryIcon />
          </IconButton>
        }
      />

      {!loading && products.length === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 4, px: 4 }}>
          <Typography align="center" color="text.secondary">{t('marketplace.empty_message')}</Typography>
        </Box>
      )}

      {/* 1商品 = 1つの正方形タイル(マイアカウント/マイ連絡先と同じ方式)。末尾の破線タイルが追加ボタン。 */}
      <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5, p: 2 }}>
        {products.map((product) => (
          <ButtonBase
            key={product.id}
            onClick={() => navigate(`/marketplace/detail?id=${product.id}`)}
            sx={{
              aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 0.75, p: 1.5, borderRadius: 2,
              border: 1, borderColor: 'divider', bgcolor: 'background.paper', textAlign: 'center',
            }}
          >
            <Typography sx={{ fontWeight: 'bold', width: '100%', wordBreak: 'break-word' }}>
              {product.name}
            </Typography>
            <Typography sx={{ width: '100%', fontSize: { xs: '1.3rem', sm: '1.45rem' }, fontWeight: 700, lineHeight: 1.2, color: 'text.primary', overflowWrap: 'anywhere' }}>
              {`${product.price.toLocaleString()} ${t('marketplace.price_unit')}`}
            </Typography>
            {product.stock <= 0 ? (
              <Chip size="small" color="error" label={t('marketplace.out_of_stock')} />
            ) : (
              <Chip
                size="small"
                variant="outlined"
                label={`${t('marketplace.stock')} ${product.stock}${t('marketplace.stock_unit')}`}
              />
            )}
          </ButtonBase>
        ))}
        <ButtonBase
          onClick={() => navigate('/marketplace/form')}
          aria-label={t('common.add')}
          sx={{
            aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 0.5, borderRadius: 2, border: 2, borderStyle: 'dashed',
            borderColor: 'primary.main', color: 'primary.main',
          }}
        >
          <AddIcon fontSize="large" />
          <Typography sx={{ fontWeight: 'bold' }}>{t('common.add')}</Typography>
        </ButtonBase>
      </Box>
    </Box>
  );
}
