export function niceTicks(min: number, max: number, target = 4): { ticks: number[]; lo: number; hi: number } {
  const upper = max <= min ? min + 1 : max;
  const span = upper - min;
  const power = Math.floor(Math.log10(span / target));
  const bases = [1, 2, 2.5, 5];
  let step = 10 ** power;
  while (span / step > target) {
    const scale = step / (10 ** power);
    const next = bases.find(value => value > scale);
    step = next === undefined ? 10 ** (power + 1) : next * 10 ** power;
  }
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(upper / step) * step;
  while ((hi - lo) / step > target) {
    const scale = step / (10 ** power);
    const next = bases.find(value => value > scale);
    step = next === undefined ? 10 ** (power + 1) : next * 10 ** power;
    lo = Math.floor(min / step) * step;
    hi = Math.ceil(upper / step) * step;
  }
  const count = Math.round((hi - lo) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((lo + i * step).toFixed(10)));
  return { ticks, lo: Number(lo.toFixed(10)), hi: Number(hi.toFixed(10)) };
}
