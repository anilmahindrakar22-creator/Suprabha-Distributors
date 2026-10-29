/** Parse rupees exactly, without floating point multiplication. */
export function rupeesToPaise(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const value = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? '').padEnd(2, '0'));
  return value <= BigInt('9000000000000000') ? Number(value) : null;
}

/** Shorthand is reserved for the workspace header. */
export function formatPaise(paise: number, compact = false): string {
  if (compact && Math.abs(paise) >= 10000000) {
    const crore = Math.abs(paise) >= 1000000000;
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(paise / (crore ? 1000000000 : 10000000))} ${crore ? 'Cr' : 'L'}`;
  }
  const integer = BigInt(paise);
  const absolute = integer < BigInt(0) ? -integer : integer;
  const fraction = absolute % BigInt(100);
  return `${integer < BigInt(0) ? '−' : ''}₹${new Intl.NumberFormat('en-IN').format(absolute / BigInt(100))}${fraction ? `.${fraction.toString().padStart(2, '0')}` : ''}`;
}

export function permilleLabel(sharePermille: number): string {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(sharePermille / 10)}%`;
}
