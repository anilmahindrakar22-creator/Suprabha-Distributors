const units = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(value: bigint): string {
  for (const [scale, label] of [[BigInt(10000000), 'Crore'], [BigInt(100000), 'Lakh'], [BigInt(1000), 'Thousand'], [BigInt(100), 'Hundred']] as const) {
    if (value >= scale) return `${words(value / scale)} ${label}${value % scale ? ` ${words(value % scale)}` : ''}`;
  }
  const small = Number(value);
  return small < 20 ? units[small] : `${tens[Math.floor(small / 10)]}${small % 10 ? `-${units[small % 10]}` : ''}`;
}

export function rupeesInWords(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new RangeError('Expected non-negative integer paise');
  const integer = BigInt(paise);
  const hundred = BigInt(100);
  return `Rupees ${words(integer / hundred)}${integer % hundred ? ` and ${words(integer % hundred)} Paise` : ''} Only`;
}
