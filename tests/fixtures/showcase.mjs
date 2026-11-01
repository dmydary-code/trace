// Creates a disposable Git repository for documentation screenshots and manual UI checks.
// Usage: node tests/fixtures/showcase.mjs /absolute/path/to/new/checkout-web
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass a new directory for the example repository');
await mkdir(repo, {recursive: false});
const git = (...args) => execFileSync('git', ['-C', repo, ...args], {stdio: 'pipe'});
git('init', '-b', 'main'); git('config', 'user.name', 'Example Reviewer'); git('config', 'user.email', 'reviewer@example.invalid');
const files = {
  'package.json': JSON.stringify({name: 'checkout-web', private: true, type: 'module', dependencies: {react: '^19.0.0'}}, null, 2) + '\n',
  'src/api/promo.js': 'export function applyPromo(total, percent) {\n  return total;\n}\n',
  'src/hooks/usePromo.js': "import { useState } from 'react';\nimport { applyPromo } from '../api/promo.js';\n\nexport function usePromo(total) {\n  const [percent, setPercent] = useState(0);\n  return { total, setPercent };\n}\n",
  'src/components/PromoField.jsx': "export function PromoField({ onApply }) {\n  return <button onClick={() => onApply(10)}>Apply offer</button>;\n}\n",
  'src/pages/Checkout.jsx': "import { usePromo } from '../hooks/usePromo.js';\nimport { PromoField } from '../components/PromoField.jsx';\n\nexport function Checkout({ total }) {\n  const promo = usePromo(total);\n  return <main><h1>Checkout</h1><p>{promo.total}</p></main>;\n}\n",
  'tests/promo.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { applyPromo } from '../src/api/promo.js';\n\ntest('keeps the total without a promotion', () => {\n  assert.equal(applyPromo(1000, 0), 1000);\n});\n",
};
for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(repo, path)), {recursive: true}); await writeFile(join(repo, path), text); }
git('add', '.'); git('commit', '-m', 'Example checkout before promo support'); git('switch', '-c', 'feature/promo-codes');
files['src/api/promo.js'] = 'export function applyPromo(total, percent) {\n  const discount = total * percent / 100;\n  return Math.round((total - discount) * 100) / 100;\n}\n';
files['src/hooks/usePromo.js'] = files['src/hooks/usePromo.js'].replace('return { total, setPercent };', 'return { total: applyPromo(total, percent), setPercent };');
files['src/components/PromoField.jsx'] = files['src/components/PromoField.jsx'].replace('Apply offer', 'Apply 10% discount');
files['src/pages/Checkout.jsx'] = files['src/pages/Checkout.jsx'].replace('<p>{promo.total}</p>', '<p>{promo.total}</p><PromoField onApply={promo.setPercent} />');
files['tests/promo.test.js'] += "\ntest('applies a ten percent promotion', () => {\n  assert.equal(applyPromo(1000, 10), 900);\n});\n";
for (const [path, text] of Object.entries(files)) await writeFile(join(repo, path), text);
console.log(repo);
