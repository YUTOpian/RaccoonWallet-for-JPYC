import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Chip, CardActionArea, Typography, CircularProgress, Divider, IconButton, Dialog, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTransactions } from '../hooks/useTransactions';
import type { TransactionWrapper } from '../lib/transactionWrapper';
import { useAppStore } from '../store/appStore';
import { AddressBookHelper, TxAnnotationsHelper, WalletsHelper } from '../lib/storage';
import type { TxAnnotationRecord } from '../lib/storage';
import { loadSafetyContext } from '../hooks/useAddressSafety';
import { isSuspiciousTransfer } from '../lib/addressSafety';
import type { PeerEvent } from '../lib/addressSafety';
import { CHAINS } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import emptyImage from '../assets/image_empty1_large.png';
import iconReceiveGreen from '../assets/icon_transaction_receive_green.png';
import iconReceiveRed from '../assets/icon_transaction_receive_red.png';
import iconCheck from '../assets/icon_transaction_check.png';
import iconUnconfirmed from '../assets/icon_transaction_unconfirmed.png';
import { CHAIN_ICONS } from '../lib/chainIcons';
import { getTxChainIcon } from '../lib/txChainMeta';

export default function TransactionHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fetchTransactions } = useTransactions();
  const setTransaction = useAppStore((s) => s.setTransaction);
  const transactionListCache = useAppStore((s) => s.transactionListCache);
  const setTransactionListCache = useAppStore((s) => s.setTransactionListCache);

  // Seed from the cached result of the previous visit (if any) so returning to this screen
  // shows the last-known list instantly instead of a blank spinner. A background refetch
  // below (which runs every time regardless of whether a cache existed) then replaces both
  // this state and the store cache once fresh data arrives, so anything that changed on-chain
  // since the last visit still shows up "in real time" - just without the loading flash.
  const [loading, setLoading] = useState(transactionListCache == null);
  const [grouped, setGrouped] = useState<Record<string, TransactionWrapper[]>>(transactionListCache?.grouped ?? {});
  const [peerNames, setPeerNames] = useState<Record<string, string>>(transactionListCache?.peerNames ?? {});
  // Moved here from NavigationDrawer's "Transaction" entry: "view my transactions" isn't
  // indexed/loaded by this wallet on-chain, so it means "open my address on a public
  // block explorer" - opened in the system browser, chosen via this chain picker since
  // the destination URL depends on which chain to look at.
  const [walletAddress, setWalletAddress] = useState('');
  // アドレスポイズニングの疑いがある取引(annotationKey)。未登録・未送信の相手からの0円/少額、登録済みの相手に似たアドレスなど。
  const [suspicious, setSuspicious] = useState<Set<string>>(new Set());
  const [chainDialogOpen, setChainDialogOpen] = useState(false);
  // 取引ごとに付けた会計用のタグ・メモ(annotationKey → 記録)。一覧の各行に表示する。
  const [annotations, setAnnotations] = useState<Record<string, TxAnnotationRecord>>({});
  // 'unclassified' = タグ(売上・経費・私用)がまだ付いていない取引だけを表示する。月末の付け忘れ確認用。
  const [filter, setFilter] = useState<'all' | 'unclassified'>('all');

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      setWalletAddress(wallet?.address ?? '');
      // キャッシュ表示の段階でも、付けたタグ・メモがすぐ出るよう、起動時にも読み込む。
      setAnnotations(await TxAnnotationsHelper.getAll());
    })();
  }, []);

  const openExplorer = (chain: ChainKey) => {
    setChainDialogOpen(false);
    window.open(`${CHAINS[chain].blockExplorerUrl}/address/${walletAddress}`, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    (async () => {
      // Only show the spinner when there's nothing cached to display yet - if we already
      // have a previous result on screen (from transactionListCache), this fetch happens
      // quietly in the background and simply swaps the list once it resolves, rather than
      // hiding the existing content behind a spinner every time this screen is opened.
      if (transactionListCache == null) {
        setLoading(true);
      }
      // JPYC取引履歴: JPYC の送受信だけに絞る(他のトークンは取得自体を省略)。
      await fetchTransactions(100, true, async (confirmed, unconfirmed) => {
        const all = [...unconfirmed, ...confirmed];
        const next: Record<string, TransactionWrapper[]> = {};
        for (const transaction of all) {
          const key = transaction.dateString;
          (next[key] ??= []).push(transaction);
        }
        setGrouped(next);
        setLoading(false);
        setAnnotations(await TxAnnotationsHelper.getAll());

        // Resolve every distinct sender/receiver address in the list to an address-book
        // contact name, when one is registered, so rows can show "田中さん" instead of a
        // raw address (see the from/to Typography below) - looked up once per fetch
        // rather than per row.
        const addresses = new Set<string>();
        for (const transaction of all) {
          addresses.add(transaction.senderAddress.toLowerCase());
          addresses.add(transaction.receiverAddress.toLowerCase());
        }
        const entries = await Promise.all(
          [...addresses].map(async (address) => {
            const contact = await AddressBookHelper.findByAddress(address);
            return [address, contact?.name ?? null] as const;
          })
        );
        const resolvedPeerNames = Object.fromEntries(entries.filter(([, name]) => name != null) as [string, string][]);
        setPeerNames(resolvedPeerNames);

        // アドレス詐欺対策: 履歴に紛れ込んだ不審な取引に印を付ける(判定は端末内のデータだけで行う)。
        const wallet = await WalletsHelper.getActive();
        const context = await loadSafetyContext(wallet?.address ?? null);
        const events: PeerEvent[] = all.map((tx) => ({
          address: tx.peer,
          direction: tx.isReception ? 'in' : 'out',
          amount: Number(tx.amount.replace(/,/g, '')) || 0,
          symbol: tx.currencySymbol,
          chain: tx.chain,
          at: tx.timestamp.getTime(),
        }));
        const peers = [...events, ...context.peers];
        setSuspicious(new Set(all
          .filter((_tx, i) => isSuspiciousTransfer(events[i], { contacts: context.contacts, sent: context.sent, peers }))
          .map((tx) => tx.annotationKey)));

        // Save this fetch's result so the next time this screen is opened (without a full
        // reload) it can render immediately from cache while a fresh fetch runs underneath.
        setTransactionListCache({ grouped: next, peerNames: resolvedPeerNames });
      }, 'JPYC');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToDetail = (transaction: TransactionWrapper) => {
    setTransaction(transaction);
    navigate('/transaction/detail');
  };

  const unclassifiedCount = useMemo(
    () => Object.values(grouped).flat().filter((tx) => (annotations[tx.annotationKey]?.tag ?? '') === '').length,
    [grouped, annotations],
  );
  const visible = useMemo(() => {
    if (filter === 'all') return grouped;
    const next: Record<string, TransactionWrapper[]> = {};
    for (const [dateKey, list] of Object.entries(grouped)) {
      const rows = list.filter((tx) => (annotations[tx.annotationKey]?.tag ?? '') === '');
      if (rows.length > 0) next[dateKey] = rows;
    }
    return next;
  }, [grouped, annotations, filter]);
  const hasAny = Object.keys(grouped).length > 0;

  const dateKeys = Object.keys(visible).slice().reverse();

  return (
    <Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, px: 2 }}>
          <Typography sx={{ flexGrow: 1 }}>{t('transaction.jpyc_list_heading')}</Typography>
          <IconButton onClick={() => navigate('/transaction/export')} aria-label={t('transaction.export_button')} color="primary">
            <FileDownloadIcon />
          </IconButton>
          <IconButton onClick={() => setChainDialogOpen(true)} aria-label={t('common.view_on_explorer')} color="primary">
            <OpenInNewIcon />
          </IconButton>
        </Box>

        {!loading && hasAny && (
          <Box sx={{ display: 'flex', gap: 1, px: 2, mt: 1 }}>
            <Chip
              size="small" label={t('transaction.filter_all')}
              color={filter === 'all' ? 'primary' : 'default'} variant={filter === 'all' ? 'filled' : 'outlined'}
              onClick={() => setFilter('all')}
            />
            <Chip
              size="small" label={`${t('transaction.filter_unclassified')} (${unclassifiedCount})`}
              color={filter === 'unclassified' ? 'primary' : 'default'} variant={filter === 'unclassified' ? 'filled' : 'outlined'}
              onClick={() => setFilter('unclassified')}
            />
          </Box>
        )}

        {loading ? (
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress color="primary" />
          </Box>
        ) : hasAny && dateKeys.length === 0 ? (
          <Typography align="center" sx={{ mt: 4, color: 'text.secondary' }}>{t('transaction.filter_unclassified_empty')}</Typography>
        ) : dateKeys.length === 0 ? (
          <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box component="img" src={emptyImage} sx={{ width: '50%' }} />
            <Typography sx={{ fontSize: 'large', color: 'text.secondary' }}>{t('transaction.no_transaction_title')}</Typography>
            <Typography sx={{ color: 'text.secondary' }}>
              {(t('transaction.no_transaction_message', { returnObjects: true }) as string[]).map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </Typography>
          </Box>
        ) : (
          dateKeys.map((dateKey) => (
            <Box key={dateKey}>
              <Divider />
              <Typography sx={{ mt: 1, px: 2 }}>{visible[dateKey][0].dateString}</Typography>
              <Divider />
              {visible[dateKey].map((transaction, index) => (
                <Box key={index}>
                  <Card sx={{ m: 1 }} elevation={0}>
                    <CardActionArea onClick={() => goToDetail(transaction)}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', p: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          {getTxChainIcon(transaction.chain) && (
                            <Box component="img" src={getTxChainIcon(transaction.chain)} sx={{ width: 16, height: 16, borderRadius: '50%', mr: 0.5 }} />
                          )}
                          <Box component="img" src={transaction.isReception ? iconReceiveGreen : iconReceiveRed} sx={{ width: 16, height: 16 }} />
                          <Box sx={{ display: 'flex', alignItems: 'center', ml: 1, flexGrow: 1 }}>
                            <Typography component="span" sx={{ fontSize: 'large', color: transaction.isReception ? 'primary.main' : 'nemOrange', fontWeight: 'bold' }}>
                              {transaction.isReception ? '+' : '-'}
                            </Typography>
                            <Typography component="span" sx={{ fontSize: 'large', ml: 0.5 }}>
                              {transaction.amount} {transaction.currencySymbol}
                            </Typography>
                            <Box sx={{ flexGrow: 1 }} />
                            <Box component="img" src={transaction.isConfirmed ? iconCheck : iconUnconfirmed} sx={{ width: 16, height: 16 }} />
                          </Box>
                        </Box>
                        {suspicious.has(transaction.annotationKey) && (
                          <Box sx={{ mt: 0.5 }}>
                            <Chip size="small" color="error" label={t('safety.history_suspicious')} sx={{ fontWeight: 700 }} />
                            <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 0.5 }}>{t('safety.history_suspicious_note')}</Typography>
                          </Box>
                        )}
                        {(() => {
                          const annotation = annotations[transaction.annotationKey];
                          if (!annotation || (annotation.tag === '' && annotation.memo === '' && !annotation.category)) return null;
                          return (
                            <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                              {annotation.tag !== '' && (
                                <Chip size="small" color="primary" variant="outlined" label={annotation.category ? `${t(`transaction.tag_${annotation.tag}`)} / ${annotation.category}` : t(`transaction.tag_${annotation.tag}`)} sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0 }} />
                              )}
                              {annotation.memo !== '' && (
                                <Typography variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>{annotation.memo}</Typography>
                              )}
                            </Box>
                          );
                        })()}
                        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary', wordBreak: 'break-all' }}>
                          {t('transaction.from_label')}: {peerNames[transaction.senderAddress.toLowerCase()] ?? transaction.senderAddress}
                        </Typography>
                        {peerNames[transaction.senderAddress.toLowerCase()] && (
                          <Typography variant="caption" sx={{ color: 'text.disabled', wordBreak: 'break-all' }}>
                            <Chip size="small" color="success" variant="outlined" label={t('safety.history_contact')} sx={{ mr: 0.5, height: 18, fontSize: '0.65rem' }} />
                            {transaction.senderAddress}
                          </Typography>
                        )}
                        <Typography variant="body2" sx={{ color: 'text.secondary', wordBreak: 'break-all' }}>
                          {t('transaction.to_label')}: {peerNames[transaction.receiverAddress.toLowerCase()] ?? transaction.receiverAddress}
                        </Typography>
                        {peerNames[transaction.receiverAddress.toLowerCase()] && (
                          <Typography variant="caption" sx={{ color: 'text.disabled', wordBreak: 'break-all' }}>
                            <Chip size="small" color="success" variant="outlined" label={t('safety.history_contact')} sx={{ mr: 0.5, height: 18, fontSize: '0.65rem' }} />
                            {transaction.receiverAddress}
                          </Typography>
                        )}
                      </Box>
                    </CardActionArea>
                  </Card>
                  {index < visible[dateKey].length - 1 && <Divider />}
                </Box>
              ))}
            </Box>
          ))
        )}
      </Box>

      <Dialog open={chainDialogOpen} onClose={() => setChainDialogOpen(false)}>
        <DialogTitle>{t('common.select_chain')}</DialogTitle>
        <List sx={{ minWidth: 240, pt: 0 }}>
          {(Object.keys(CHAINS) as ChainKey[]).map((chain) => (
            <ListItemButton key={chain} onClick={() => openExplorer(chain)}>
              <ListItemIcon>
                <Box component="img" src={CHAIN_ICONS[chain]} sx={{ width: 24, height: 24, borderRadius: '50%' }} />
              </ListItemIcon>
              <ListItemText primary={CHAINS[chain].name} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
    </Box>
  );
}
