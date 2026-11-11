/**
 * A single token transfer (ERC-20 on an EVM chain),
 * shaped for display in TransactionList/TransactionDetail.
 *
 * `chain` identifies which network a given entry came from, so mixed multi-chain lists
 * (Home, TransactionList) can label/link each row correctly. It's a plain string rather than
 * lib/chains.ts's ChainKey because history now spans more than the curated EVM chains: it can
 * also be a CustomChainRecord id (a hand-added EVM network, see lib/storage.ts).
 * lib/txChainMeta.ts resolves any of these back to a display name/icon/explorer link.
 */
export class TransactionWrapper {
  readonly hash: string;
  readonly timestamp: Date;
  readonly dateString: string;
  readonly timeString: string;
  readonly isReception: boolean;
  readonly isConfirmed: boolean;
  readonly senderAddress: string;
  readonly receiverAddress: string;
  readonly amount: string;    // formatted, e.g. "1000.0"
  readonly currencySymbol: string; // "JPYC", "USDC", "XEM", "XYM", ...
  readonly feeAmount: string; // formatted native-coin gas fee; '' when not applicable/unknown 
  readonly chain?: string;    // which network this transfer happened on, when known - see class doc above

  /** Key under which this transfer's 会計メモ・タグ are stored (TxAnnotationsHelper). */
  get annotationKey(): string {
    return `${this.chain ?? ''}:${this.hash}:${this.currencySymbol}:${this.isReception ? 'in' : 'out'}`.toLowerCase();
  }

  get peer(): string {
    return this.isReception ? this.senderAddress : this.receiverAddress;
  }

  constructor(params: {
    hash: string;
    timestamp: Date;
    isReception: boolean;
    isConfirmed: boolean;
    senderAddress: string;
    receiverAddress: string;
    amount: string;
    currencySymbol: string;
    feeAmount: string;
    chain?: string;
  }) {
    this.hash = params.hash;
    this.timestamp = params.timestamp;
    this.dateString = params.timestamp.toLocaleDateString();
    this.timeString = params.timestamp.toLocaleTimeString();
    this.isReception = params.isReception;
    this.isConfirmed = params.isConfirmed;
    this.senderAddress = params.senderAddress;
    this.receiverAddress = params.receiverAddress;
    this.amount = params.amount;
    this.currencySymbol = params.currencySymbol;
    this.feeAmount = params.feeAmount;
    this.chain = params.chain;
  }
}
