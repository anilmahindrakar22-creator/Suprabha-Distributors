const dropped = new Set(['pvt', 'ltd', 'limited', 'private', 'india', 'i', 'co']);
const taxRate = /(^|\s)\d+(?:\.\d+)?\s*%(?=\s|$)/g;

function words(value: string): string[] {
  return value.toLowerCase().replace(/&/g, ' ').replace(taxRate, ' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/).filter(word => word && !dropped.has(word));
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function matches(groupWords: string[], brandWords: string[]): boolean {
  if (!brandWords.length) return false;
  for (let start = 0; start + brandWords.length <= groupWords.length; start++) {
    if (brandWords.every((word, i) => groupWords[start + i] === word)) return true;
  }
  const [only] = brandWords;
  return brandWords.length === 1 && only.length >= 6
    && groupWords.some(word => word.length >= 6 && distance(word, only) <= 2);
}

/** Returns a brand code only when exactly one brand matches the Tally group name. */
export function suggestBrand(groupName: string, brands: { code: string; name: string }[]): string | null {
  const groupWords = words(groupName);
  const found = brands.filter(brand => matches(groupWords, words(brand.name)));
  return found.length === 1 ? found[0].code : null;
}

/** Group name without tax rates and company-form words, keeping the original case. */
export function cleanBrandName(groupName: string): string {
  return groupName.replace(taxRate, ' ').split(/\s+/)
    .filter(word => word && !['pvt', 'ltd', 'limited', 'private'].includes(word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')))
    .join(' ').trim();
}
