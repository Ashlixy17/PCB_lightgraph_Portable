import {spawn} from 'node:child_process';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspace = path.resolve(appRoot, '../..');
const suites = ['ui', 'regions', 'wand'];
const requested = process.argv.slice(2);
const selected = requested.length ? requested : suites;
if (selected.some(name => !suites.includes(name))) throw new Error('测试名称只能是 ui、regions 或 wand');
for (const name of selected) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(workspace, 'tests', `${name}.browser.test.cjs`)], {
      cwd: workspace,
      stdio: 'inherit',
      env: {...process.env, NODE_PATH: path.join(appRoot, 'node_modules')},
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  if (code !== 0) process.exit(code);
}
