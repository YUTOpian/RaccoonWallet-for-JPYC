import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, CircularProgress, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup,
  TextField, Typography,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { useTransactions } from '../../hooks/useTransactions';
import { AddressBookHelper, TxAnnotationsHelper } from '../../lib/storage';
import { resolveTxChainDisplay } from '../../lib/txChainMeta';
import {
  DEFAULT_MONEYFORWARD_SETTINGS, buildExportCsv, countRowsForFormat, downloadCsv, filterByPeriod,
} from '../../lib/accountingExport';
import type { ExportFormat, ExportRow, MoneyForwardSettings } from '../../lib/accountingExport';

const pad = (n: number) => String(n).padStart(2, '0');
const toInputDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 送受信全履歴(全通貨)を、期間で絞って会計用CSVにする画面。タグ・メモは取引詳細で付ける。
export default function TransactionExport() {
  const { t } = useTranslation();
  const { fetchTransactions } = useTransactions();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const today = new Date();
  const [from, setFrom] = useState(toInputDate(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(toInputDate(today));
  const [format, setFormat] = useState<ExportFormat>('freee');
  const [mf, setMf] = useState<MoneyForwardSettings>(DEFAULT_MONEYFORWARD_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchTransactions(1000, false, async (confirmed) => {
        const annotations = await TxAnnotationsHelper.getAll();
        // Resolve each distinct chain's name and each distinct counterparty once, not per row.
        const chainIds = [...new Set(confirmed.map((tx) => tx.chain ?? ''))];
        const chainNames = Object.fromEntries(
          await Promise.all(chainIds.map(async (id) => [id, (await resolveTxChainDisplay(id)).name] as const)),
        );
        const peers = [...new Set(confirmed.map((tx) => tx.peer.toLowerCase()))];
        const peerNames = Object.fromEntries(
          await Promise.all(peers.map(async (address) => [address, (await AddressBookHelper.findByAddress(address))?.name ?? ''] as const)),
        );
        if (cancelled) return;
        setRows(confirmed.map((tx): ExportRow => {
          const annotation = annotations[tx.annotationKey];
          return {
            timestamp: tx.timestamp,
            chainName: chainNames[tx.chain ?? ''] ?? '',
            hash: tx.hash,
            isReception: tx.isReception,
            senderAddress: tx.senderAddress,
            receiverAddress: tx.receiverAddress,
            peerName: peerNames[tx.peer.toLowerCase()] ?? '',
            amount: tx.amount,
            currencySymbol: tx.currencySymbol,
            tag: annotation?.tag ?? '',
            category: annotation?.category ?? '',
            memo: annotation?.memo ?? '',
          };
        }));
        setLoading(false);
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inPeriod = useMemo(() => filterByPeriod(rows, from, to), [rows, from, to]);
  const count = countRowsForFormat(format, inPeriod);

  const onDownload = () => {
    const prefix = format === 'freee' ? 'freee_statement' : format === 'moneyforward' ? 'moneyforward_journal' : 'transactions';
    downloadCsv(buildExportCsv(format, inPeriod, mf), prefix);
  };

  return (
    <Box>
      <AppToolBar back="/transaction/list" title={t('transaction.export_title')} />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FormControl>
          <FormLabel sx={{ mb: 1 }}>{t('transaction.export_period')}</FormLabel>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              type="date" size="small" label={t('transaction.export_period_from')} value={from}
              onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }}
            />
            <Typography>〜</Typography>
            <TextField
              type="date" size="small" label={t('transaction.export_period_to')} value={to}
              onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }}
            />
          </Box>
        </FormControl>

        <FormControl>
          <FormLabel>{t('transaction.export_format')}</FormLabel>
          <RadioGroup value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <FormControlLabel value="freee" control={<Radio />} label={t('transaction.export_format_freee')} />
            <FormControlLabel value="moneyforward" control={<Radio />} label={t('transaction.export_format_mf')} />
            <FormControlLabel value="generic" control={<Radio />} label={t('transaction.export_format_generic')} />
          </RadioGroup>
        </FormControl>

        {format === 'moneyforward' && (
          <>
            <TextField
              size="small" label={t('transaction.export_mf_wallet_account')} value={mf.walletAccount}
              onChange={(e) => setMf({ ...mf, walletAccount: e.target.value })}
            />
            <TextField
              size="small" label={t('transaction.export_mf_expense_account')} value={mf.expenseAccount}
              onChange={(e) => setMf({ ...mf, expenseAccount: e.target.value })}
            />
            <Typography variant="caption" color="text.secondary">{t('transaction.export_note_mf')}</Typography>
          </>
        )}
        {format !== 'generic' && (
          <Typography variant="caption" color="text.secondary">{t('transaction.export_note_accounting')}</Typography>
        )}
        <Typography variant="caption" color="text.secondary">{t('transaction.export_note_history')}</Typography>

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1 }}>
            <CircularProgress size={20} color="primary" />
            <Typography color="text.secondary">{t('transaction.export_loading')}</Typography>
          </Box>
        ) : (
          <Typography align="center" color="text.secondary">
            {count === 0 ? t('transaction.export_no_rows') : t('transaction.export_count', { count })}
          </Typography>
        )}

        <Button
          variant="contained" fullWidth startIcon={<FileDownloadIcon />}
          disabled={loading || count === 0} onClick={onDownload}
        >
          {t('transaction.export_download')}
        </Button>
      </Box>
    </Box>
  );
}
