import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const rootRequire = createRequire(import.meta.url);
const chains = [
  ['shadcn', 'fast-glob', 'micromatch', 'braces'],
  ['shadcn', 'ts-morph', '@ts-morph/common', 'fast-glob', 'micromatch', 'braces'],
  ['vinext', 'vite-plugin-commonjs', 'vite-plugin-dynamic-import', 'fast-glob', 'micromatch', 'braces'],
];

for (const chain of chains) {
  let require = rootRequire;
  for (const dependency of chain.slice(0, -1)) {
    require = createRequire(dependency === 'vinext' ? import.meta.resolve('vinext') : require.resolve(dependency));
  }
  const braces = require('braces');
  describe(`braces security through ${chain.join(' → ')}`, () => {
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      it(`${method} rejects excessive nesting before recursive processing`, () => {
        const pattern = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
        expect(() => braces[method](pattern)).toThrow('Input nesting exceeds max depth (100)');
      });
    }
    it('bounds parentheses and mixed parser nesting too', () => {
      expect(() => braces.parse('('.repeat(101) + 'x' + ')'.repeat(101))).toThrow(SyntaxError);
      expect(() => braces.parse('{('.repeat(51) + 'x' + ')}'.repeat(51))).toThrow(SyntaxError);
    });
    it('preserves normal alternatives, ranges and escaped literals', () => {
      expect(braces.expand('src/{app,lib}/*.{ts,tsx}')).toEqual([
        'src/app/*.ts', 'src/app/*.tsx', 'src/lib/*.ts', 'src/lib/*.tsx',
      ]);
      expect(braces.expand('file{1..3}.ts')).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
      expect(braces.expand('\\{literal\\}')).toEqual(['{literal}']);
      expect(braces.compile('{a,b}')).toBe('(a|b)');
    });
    it('allows the boundary and does not count escaped, quoted or bracketed braces as nesting', () => {
      expect(() => braces.parse('{'.repeat(100) + 'x' + '}'.repeat(100))).not.toThrow();
      expect(() => braces.parse('\\{'.repeat(101))).not.toThrow();
      expect(() => braces.parse('"' + '{'.repeat(101) + '"')).not.toThrow();
      expect(() => braces.parse('[' + '{'.repeat(101) + ']')).not.toThrow();
    });
  });
}
