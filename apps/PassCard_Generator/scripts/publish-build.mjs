import {cp, mkdir, realpath, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspace = await realpath(path.resolve(appRoot, '../..'));
const source = path.join(appRoot, 'dist');
const resources = path.join(workspace, 'PassCard_Generator_assets');
const pending = path.join(workspace, '.cache', 'PassCard_Generator_assets.pending');

await stat(path.join(source, 'PassCard_Generator.html'));
await stat(path.join(source, 'PassCard_Generator_assets'));
await mkdir(path.dirname(pending), {recursive: true});
// 只替换生成器的产物目录，不能让构建清空仓库根目录。
for (const target of [pending, resources]) {
  if (!target.startsWith(workspace + path.sep)) throw new Error('构建路径超出工作区');
}
await rm(pending, {recursive: true, force: true});
await cp(path.join(source, 'PassCard_Generator_assets'), pending, {recursive: true});
await rm(resources, {recursive: true, force: true});
await rename(pending, resources);
await cp(path.join(source, 'PassCard_Generator.html'), path.join(workspace, 'PassCard_Generator.html'));
console.log('已构建 PassCard_Generator.html 和 PassCard_Generator_assets/');
