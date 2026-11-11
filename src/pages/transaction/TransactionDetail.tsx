import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Card, Typography, Divider, Link as MuiLink, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ethers } from 'ethers';
import AppToolBar from '../../components/AppToolBar';
import { TransactionWrapper } from '../../lib/transactionWrapper';
import { isEvmChainKey, CHAINS, getProvider } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CustomChainsHelper, TxAnnotationsHelper } from '../../lib/storage';
import type { TxAnnotationRecord, TxAnnotationTag } from '../../lib/storage';
import { categorySuggestions, supportsCategory } from '../../lib/txCategories';
import { resolveTxChainDisplay } from '../../lib/txChainMeta';
import type { TxChainDisplay } from '../../lib/txChainMeta';
import { useAppStore } from '../../store/appStore';
import { isRefundable, refundAmount, resolveRefundAsset } from '../../lib/refund';
import type { RefundAsset } from '../../lib/refund';
import { loadSafetyContext } from '../../hooks/useAddressSafety';
import { WalletsHelper } from '../../lib/storage';
import { isSuspiciousTransfer } from '../../lib/addressSafety';
import iconReceiveGreen from '../../assets/icon_transaction_receive_green.png';
import iconReceiveRed from '../../assets/icon_transaction_receive_red.png';
import iconCheck from '../../assets/icon_transaction_check.png';
import iconUnconfirmed from '../../assets/icon_transaction_unconfirmed.png';

export default function TransactionDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const transaction = useAppStore((s) => s.transaction);
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;
  // Prefer the chain the transaction actually happened on (set for every history entry -
  // curated EVM or custom EVM); only fall back to whatever chain the app
  // currently has selected for older/edge-case callers that never set it.
  const transactionChain: string = transaction?.chain ?? activeChain;
  const [chainDisplay, setChainDisplay] = useState<TxChainDisplay>({ name: '' });
  const [feeAmount, setFeeAmount] = useState<string | null>(null);
  // 会計用の分類(売上/経費/私用)とメモ。履歴はチェーンから都度取得するので、端末内に別保存する。
  const [tag, setTag] = useState<TxAnnotationTag>('');
  const [memo, setMemo] = useState('');
  const [category, setCategory] = useState('');
  const [allAnnotations, setAllAnnotations] = useState<Record<string, TxAnnotationRecord>>({});
  // アドレスポイズニングの疑い(未登録・未送信の相手からの0円/少額、登録済みの相手に似たアドレスなど)。
  const [suspicious, setSuspicious] = useState(false);
  // 返金に使う通貨(JPYC / 登録済みトークン)。割り出せない通貨の取引には、返金ボタンを出さない。
  const [refundAsset, setRefundAsset] = useState<RefundAsset | null>(null);
  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const setCalculatorFormula = useAppStore((s) => s.setCalculatorFormula);
  const setCalculatorValue = useAppStore((s) => s.setCalculatorValue);
  const setBackPathFromSendConfirmation = useAppStore((s) => s.setBackPathFromSendConfirmation);
  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);

  useEffect(() => {
    if (!(transaction instanceof TransactionWrapper) || !isRefundable(transaction)) {
      setRefundAsset(null);
      return;
    }
    let cancelled = false;
    void resolveRefundAsset(transactionChain, transaction.currencySymbol).then((asset) => {
      if (!cancelled) setRefundAsset(asset);
    });
    return () => { cancelled = true; };
  }, [transaction, transactionChain]);

  // 通常の送金確認画面に、宛先(元の送り主)・金額・通貨・チェーンをあらかじめ入れて開く。
  const onRefund = () => {
    if (!(transaction instanceof TransactionWrapper) || refundAsset === null) return;
    const amount = refundAmount(transaction);
    if (isEvmChainKey(transactionChain)) {
      setActiveChain(transactionChain);
      setSendCustomChainId(null);
    } else {
      setSendCustomChainId(transactionChain);
    }
    if (refundAsset.kind === 'token') {
      setSendCurrency(refundAsset.meta.address);
      setSendTokenMeta(refundAsset.meta);
    } else {
      setSendCurrency('jpyc');
      setSendTokenMeta(null);
    }
    setReceiverAddress(transaction.senderAddress);
    setCalculatorFormula(amount);
    setCalculatorValue(Number(amount));
    setBackPathFromSendConfirmation('/transaction/detail');
    navigate('/send/confirmation');
  };

  useEffect(() => {
    if (!(transaction instanceof TransactionWrapper)) return;
    let cancelled = false;
    (async () => {
      const wallet = await WalletsHelper.getActive();
      const context = await loadSafetyContext(wallet?.address ?? null);
      const event = { address: transaction.peer, direction: transaction.isReception ? 'in' as const : 'out' as const, amount: Number(transaction.amount.replace(/,/g, '')) || 0 };
      const flagged = isSuspiciousTransfer(event, { ...context, peers: [{ ...event, symbol: transaction.currencySymbol, at: transaction.timestamp.getTime() }, ...context.peers] });
      if (!cancelled) setSuspicious(flagged);
    })();
    return () => { cancelled = true; };
  }, [transaction]);

  useEffect(() => {
    // Fail safe: land here directly (e.g. a stale bookmark) with no transaction selected.
    if (transaction === null || !(transaction instanceof TransactionWrapper)) {
      navigate('/transaction/list', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const display = await resolveTxChainDisplay(transactionChain);
      if (!cancelled) setChainDisplay(display);
    })();
    return () => { cancelled = true; };
  }, [transactionChain]);

  useEffect(() => {
    if (!(transaction instanceof TransactionWrapper)) return;
    let cancelled = false;
    (async () => {
      const all = await TxAnnotationsHelper.getAll();
      const saved = all[transaction.annotationKey];
      if (cancelled) return;
      setAllAnnotations(all);
      setTag(saved?.tag ?? '');
      setMemo(saved?.memo ?? '');
      setCategory(saved?.category ?? '');
    })();
    return () => { cancelled = true; };
  }, [transaction]);

  const saveAnnotation = (nextTag: TxAnnotationTag, nextMemo: string, nextCategory: string) => {
    if (!(transaction instanceof TransactionWrapper)) return;
    // 費目は売上・経費のときだけ持つ(私用・未分類に戻したら外す)。
    const cat = supportsCategory(nextTag) ? nextCategory.trim() : '';
    void TxAnnotationsHelper.set(transaction.annotationKey, { tag: nextTag, memo: nextMemo, ...(cat ? { category: cat } : {}) });
  };

  useEffect(() => {
    // The gas fee isn't available from the Transfer log this transaction was found from
    // (see useTransactions.ts), so it's looked up here, once, only for the single
    // transaction being viewed — not for every row in a list. Only meaningful for EVM
    // chains (curated or custom).
    if (transaction === null || transaction.feeAmount !== '0') {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Native-currency decimals: the curated chain's own config for a curated chain, or
        // 18 for a custom EVM chain - same "every EVM chain's native currency uses 18 in
        // practice" assumption lib/customChains.ts's fetchCustomChainNativeBalance makes.
        let provider: ethers.JsonRpcProvider | null = null;
        let nativeDecimals = 18;
        if (isEvmChainKey(transactionChain)) {
          provider = getProvider(transactionChain);
          nativeDecimals = CHAINS[transactionChain].nativeCurrency.decimals;
        } else if (transactionChain.startsWith('custom-')) {
          const record = await CustomChainsHelper.get(transactionChain);
          if (record) provider = new ethers.JsonRpcProvider(record.rpcUrl);
        }
        if (!provider) return;
        const receipt = await provider.getTransactionReceipt(transaction.hash);
        if (!receipt || cancelled) return;
        const gasPrice = receipt.gasPrice ?? (await provider.getTransaction(transaction.hash))?.gasPrice;
        if (!gasPrice || cancelled) return;
        const fee = receipt.gasUsed * gasPrice;
        if (!cancelled) setFeeAmount(ethers.formatUnits(fee, nativeDecimals));
      } catch (e) {
        console.warn('Failed to load transaction fee', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction?.hash, transactionChain]);

  if (transaction === null) {
    return null;
  }

  const explorerUrl = chainDisplay.explorerTxUrl?.(transaction.hash);
  const showFeeRow = transaction.feeAmount !== '';

  return (
    <Box>
      <AppToolBar back="/transaction/list" title={t('transaction.detail_title')} />

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {chainDisplay.icon && <Box component="img" src={chainDisplay.icon} sx={{ width: 16, height: 16, mr: 0.5, borderRadius: '50%' }} />}
            <span>{transaction.dateString} {transaction.timeString}</span>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="body2" color="text.secondary">{chainDisplay.name}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <Box component="img" src={transaction.isReception ? iconReceiveGreen : iconReceiveRed} sx={{ width: 16, height: 16 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', ml: 1, flexGrow: 1 }}>
              <Typography component="span" sx={{ fontSize: 'large', color: transaction.isReception ? 'primary.main' : 'nemOrange', fontWeight: 'bold' }}>
                {transaction.isReception ? '+' : '-'}
              </Typography>
              <Typography component="span" sx={{ fontSize: 'large', ml: 0.5 }}>{transaction.amount} {transaction.currencySymbol}</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Box component="img" src={transaction.isConfirmed ? iconCheck : iconUnconfirmed} sx={{ width: 16, height: 16 }} />
            </Box>
          </Box>
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>{transaction.peer}</Typography>
          {suspicious && (
            <Alert severity="error" sx={{ mt: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('safety.history_suspicious')}</Typography>
              <Typography sx={{ fontSize: '0.82rem', mt: 0.5 }}>{t('safety.history_detail_note')}</Typography>
            </Alert>
          )}
        </Box>
      </Card>
      <Divider />

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('transaction.from_label')}</Typography>
          <Typography sx={{ color: 'primary.main', wordBreak: 'break-all' }}>{transaction.senderAddress}</Typography>
        </Box>
      </Card>
      <Divider />

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('transaction.to_label')}</Typography>
          <Typography sx={{ color: 'primary.main', wordBreak: 'break-all' }}>{transaction.receiverAddress}</Typography>
        </Box>
      </Card>
      <Divider />

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
          <Typography variant="body2" color="text.secondary">Amount: {transaction.amount} {transaction.currencySymbol}</Typography>
          {showFeeRow && (
            <Typography variant="body2" color="text.secondary">
              Fee: {feeAmount ?? (transaction.feeAmount === '0' ? '…' : transaction.feeAmount)} {chainDisplay.nativeCurrencySymbol ?? ''}
            </Typography>
          )}
        </Box>
      </Card>
      <Divider />

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
          <Typography variant="body2" color="text.secondary">Hash:</Typography>
          {explorerUrl ? (
            <MuiLink href={explorerUrl} target="_blank" rel="noopener" sx={{ wordBreak: 'break-all' }}>{transaction.hash}</MuiLink>
          ) : (
            <Typography sx={{ wordBreak: 'break-all' }}>{transaction.hash}</Typography>
          )}
        </Box>
      </Card>
      <Divider />

      {/* 返金: 確認済みの受け取りだけ。不審な取引(アドレス詐欺の疑い)には出さない。 */}
      {refundAsset !== null && !suspicious && (
        <Card sx={{ m: 1 }} elevation={0}>
          <Box sx={{ display: 'flex', flexDirection: 'column', p: 1, gap: 1 }}>
            <Button variant="outlined" onClick={onRefund}>{t('transaction.refund_button')}</Button>
            <Typography variant="caption" color="text.secondary">{t('transaction.refund_hint')}</Typography>
          </Box>
        </Card>
      )}

      <Card sx={{ m: 1 }} elevation={0}>
        <Box sx={{ display: 'flex', flexDirection: 'column', p: 1, gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('transaction.tag_label')}</Typography>
          <ToggleButtonGroup
            exclusive size="small" color="primary" value={tag}
            onChange={(_, next: TxAnnotationTag | null) => {
              // Tapping the selected button again clears it back to 未分類.
              const value = next ?? '';
              setTag(value);
              // 分類を変えたら、前の分類の費目は引き継がない(売上の費目を経費に残さない)。
              setCategory('');
              saveAnnotation(value, memo, '');
            }}
          >
            <ToggleButton value="sales">{t('transaction.tag_sales')}</ToggleButton>
            <ToggleButton value="expense">{t('transaction.tag_expense')}</ToggleButton>
            <ToggleButton value="personal">{t('transaction.tag_personal')}</ToggleButton>
          </ToggleButtonGroup>
          {supportsCategory(tag) && (
            <Autocomplete
              freeSolo size="small" options={categorySuggestions(tag, allAnnotations)}
              inputValue={category}
              onInputChange={(_, value) => setCategory(value)}
              onChange={(_, value) => {
                // 候補を選んだ時は、その場で保存する(入力欄から離れる前に画面を戻っても残るように)。
                const picked = typeof value === 'string' ? value : '';
                setCategory(picked);
                saveAnnotation(tag, memo, picked);
              }}
              onBlur={() => saveAnnotation(tag, memo, category)}
              renderInput={(params) => <TextField {...params} label={t('transaction.category_label')} />}
            />
          )}
          <TextField
            size="small" label={t('transaction.memo_label')} value={memo} multiline minRows={2}
            onChange={(e) => setMemo(e.target.value)}
            onBlur={() => saveAnnotation(tag, memo, category)}
          />
        </Box>
      </Card>
    </Box>
  );
}
