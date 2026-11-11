// Ported 1:1 from the Vue app's src/lib/invoiceData.ts.
export class InvoiceData {
  address: string;
  amount: number;
  message: string;
  type: number;

  constructor(addr: string, amount = 0, message = '', type = 2) {
    this.address = addr.split('-').join('');
    this.amount = amount;
    this.message = message;
    this.type = type;
  }

  static fromJsonString(jsonString: string): InvoiceData | null {
    try {
      const json = JSON.parse(jsonString);
      const type = json.type;
      if (json.v !== 2 || (type !== 1 && type !== 2)) {
        return null;
      }
      const address = json.data.addr;
      if (!address || address.length === 0) {
        return null;
      }
      const amount = json.data.amount || 0;
      const message = json.data.msg || '';
      return new InvoiceData(address, amount, message, type);
    } catch {
      return null;
    }
  }

  toJsonString(): string {
    const json = {
      v: 2,
      type: this.type,
      data: {
        name: '',
        addr: this.address,
        amount: this.amount,
        msg: this.message,
      },
    };
    return JSON.stringify(json);
  }
}
