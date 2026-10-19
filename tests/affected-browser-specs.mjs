import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const extensions = ['.ts', '.tsx', '.mjs', '.js'];
const posix = file => file.replace(/\\/g, '/');
const relative = (root, file) => posix(path.relative(root, file));
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

function resolveImport(root, importer, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/')
    ? path.resolve(root, specifier.slice(2))
    : path.resolve(root, path.dirname(importer), specifier);
  const candidates = [base, ...extensions.map(ext => base + ext),
    ...extensions.map(ext => path.join(base, 'index' + ext))];
  const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!found) throw new Error(`Cannot resolve ${specifier} from ${importer}`);
  return relative(root, found);
}

function imports(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?[^;"']*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g)]
    .map(match => match[1] ?? match[2] ?? match[3]);
}

export function importGraph(root) {
  const graph = new Map();
  function scan(directory) {
    if (!fs.existsSync(path.join(root, directory))) return;
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) scan(file);
      else if (extensions.includes(path.extname(file))) {
        graph.set(file, new Set(imports(read(root, file))
          .map(specifier => resolveImport(root, file, specifier)).filter(Boolean)));
      }
    }
  }
  for (const directory of ['components', 'lib', 'hooks', 'app', 'tests/ui']) scan(directory);
  return graph;
}

export function harnessViews(root) {
  const source = read(root, 'tests/ui/main.tsx');
  const components = new Map();
  const shared = new Set();
  for (const match of source.matchAll(/\bimport\s+(?:type\s+)?([^;]+?)\s+from\s*["']([^"']+)["']/g)) {
    const file = resolveImport(root, 'tests/ui/main.tsx', match[2]);
    if (!file) continue;
    const names = match[1].replace(/[{}]/g, '').split(',');
    for (const name of names) {
      const tokens = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      components.set(tokens.at(-1), file);
      // Shared harness helpers can affect props even without rendering JSX.
      if (/^[a-z]/.test(tokens.at(-1))) shared.add(file);
    }
  }
  // Local JSX wrappers (e.g. OrderRecoveryFixture) also render imported components.
  const wrappers = new Map();
  for (const match of source.matchAll(/\bfunction\s+([A-Z]\w*)\s*\(/g)) {
    if (match[1] === 'Fixture') continue;
    const end = source.indexOf('\nfunction ', match.index + 1);
    wrappers.set(match[1], source.slice(match.index, end < 0 ? source.length : end));
  }
  function rendered(fragment, visited = new Set()) {
    const files = new Set(shared);
    for (const match of fragment.matchAll(/<([A-Z]\w*)\b/g)) {
      const name = match[1];
      if (components.has(name)) files.add(components.get(name));
      else if (wrappers.has(name) && !visited.has(name)) {
        visited.add(name);
        for (const file of rendered(wrappers.get(name), visited)) files.add(file);
      } else if (!['React', 'Fixture'].includes(name) && !visited.has(name)) {
        throw new Error(`Unmapped harness component: ${name}`);
      }
    }
    return files;
  }
  const views = new Map();
  const branches = [...source.matchAll(/parameters\.get\(\s*["']view["']\s*\)\s*===\s*["']([a-z0-9-]+)["']/g)];
  for (const branch of branches) {
    const start = source.lastIndexOf('\n', branch.index);
    if (!/\bif\s*\(/.test(source.slice(start, branch.index))) continue;
    const returnStart = source.indexOf('return ', branch.index);
    const end = source.indexOf(';', returnStart);
    if (returnStart < 0 || end < 0) throw new Error(`Cannot parse view: ${branch[1]}`);
    views.set(branch[1], rendered(source.slice(returnStart, end)));
  }
  const fallbackStart = source.lastIndexOf('return <main');
  if (fallbackStart < 0) throw new Error('Cannot parse harness fallback');
  const fallback = rendered(source.slice(fallbackStart, source.indexOf(';', fallbackStart)));
  views.set('', fallback);
  // Conditional views in the final pricing return share its conservative mapping.
  for (const branch of branches) if (!views.has(branch[1])) views.set(branch[1], new Set(fallback));
  if (views.size < 2) throw new Error('No harness view branches found');
  return views;
}

function allSpecs(root) {
  return fs.readdirSync(path.join(root, 'tests/pricing-browser'))
    .filter(file => file.endsWith('.spec.ts')).map(file => `tests/pricing-browser/${file}`).sort();
}

export function specViews(root) {
  const specs = new Map();
  for (const file of allSpecs(root)) {
    const source = read(root, file);
    const views = new Set();
    const calls = [...source.matchAll(/\bgoto\s*\(\s*(['"`])([\s\S]*?)\1/g)];
    const count = [...source.matchAll(/\bgoto\s*\(/g)].length;
    if (!count || calls.length !== count) views.add('*');
    for (const call of calls) {
      const url = call[2];
      const matches = [...url.matchAll(/[?&]view=([a-z0-9-]+)/g)];
      for (const match of matches) views.add(match[1]);
      if (/[?&]view=[^&#]*\$\{/.test(url)) views.add('*');
      else if (!/[?&]view=/.test(url)) {
        if (url === '/' || url.startsWith('/?')) views.add('');
        else views.add('*');
      } else if (!matches.length) views.add('*');
    }
    specs.set(file, views);
  }
  return specs;
}

export function affectedSpecs({ root, changed }) {
  const all = allSpecs(root);
  const everything = reason => ({ all: true, specs: all, reason });
  const files = [...new Set(changed.map(file => posix(file).replace(/^\.\//, '')))].sort();
  const global = files.find(file => /^(?:tests\/ui\/|public\/|playwright[^/]*\.ts$|app\/globals\.css$|package\.json$|pnpm-lock\.yaml$|vite\.config\.)/.test(file));
  if (global) return everything(`Shared browser input changed: ${global}`);
  try {
    const graph = importGraph(root);
    const views = harnessViews(root);
    const specs = specViews(root);
    const reachable = new Map();
    for (const [view, roots] of views) {
      const seen = new Set();
      const pending = [...roots];
      while (pending.length) {
        const file = pending.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        pending.push(...(graph.get(file) ?? []));
      }
      reachable.set(view, seen);
    }
    const unmapped = files.filter(file => /^(components|lib|hooks|app)\//.test(file)
      && ![...reachable.values()].some(seen => seen.has(file)));
    if (unmapped.length) return everything(`No harness view reaches: ${unmapped.join(', ')}`);
    const affectedViews = new Set([...reachable].filter(([, seen]) => files.some(file => seen.has(file))).map(([view]) => view));
    const selected = [...specs].filter(([spec, used]) => files.includes(spec)
      || (affectedViews.size > 0 && [...used].some(view => view === '*' || !views.has(view) || affectedViews.has(view))))
      .map(([spec]) => spec).sort();
    return { all: false, specs: selected, reason: selected.length
      ? `Selected ${selected.length}/${all.length} specs for: ${files.join(', ')}`
      : 'No browser specs affected' };
  } catch (error) {
    return everything(`Mapping failed: ${error.message}`);
  }
}

// Compare paths rather than importing node:url, keeping the CLI dependency-free.
const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
if (invoked) {
  const root = process.cwd();
  let result;
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--base' || !args[1] || args[1].startsWith('-'))) throw new Error('Usage: node tests/affected-browser-specs.mjs [--base <ref>]');
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
    const changed = [...git(['diff', '--name-only', '-z', args[1] ?? 'HEAD', '--']),
      ...git(['diff', '--name-only', '-z', '--']), ...git(['ls-files', '--others', '--exclude-standard', '-z'])];
    result = affectedSpecs({ root, changed });
  } catch (error) {
    result = { all: true, specs: allSpecs(root), reason: `Fail safe: ${error.message}` };
  }
  console.log(result.specs.join(' '));
  console.error(`# ${result.reason}`);
}
