import {mkdir, readFile, realpath, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspace = await realpath(path.resolve(appRoot, '../..'));
const target = path.join(workspace, 'PCB_lightgraph_portable.html');
const pending = path.join(workspace, '.cache', 'PCB_lightgraph_portable.html.pending');
const marker = '/* @PCB_EDITOR_SCRIPT@ */';
const template = await readFile(path.join(appRoot, 'template.html'), 'utf8');
const script = await readFile(path.join(appRoot, 'dist', 'pcb-editor.js'), 'utf8');
if (template.split(marker).length !== 2) throw new Error('HTML 模板必须包含一个脚本插入标记');
if (/<\/script\s*>/i.test(script)) throw new Error('脚本中包含会截断 HTML 的结束标签');
new Function(script);
// 先完成编译和校验，再原子替换单文件入口，避免构建失败留下半个页面。
for (const file of [target, pending]) {
  if (!file.startsWith(workspace + path.sep)) throw new Error('构建路径超出工作区');
}
await mkdir(path.dirname(pending), {recursive: true});
await writeFile(pending, template.replace(marker, () => script.trimEnd()), 'utf8');
await rename(pending, target);
console.log('已构建 PCB_lightgraph_portable.html（保留单文件离线运行）');
