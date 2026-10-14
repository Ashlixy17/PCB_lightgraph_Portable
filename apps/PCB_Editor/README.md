# PCB 编辑器源码

PCB 编辑器使用 TypeScript 维护，构建后生成仓库根目录的 `PCB_lightgraph_portable.html`。生成的 HTML 保留全部界面、样式和脚本，仍可直接双击打开。

开发环境需要 Node.js 20.11 或更高版本。从仓库根目录运行：

```powershell
npm.cmd ci --prefix apps/PCB_Editor
npm.cmd run lint --prefix apps/PCB_Editor
npm.cmd run build --prefix apps/PCB_Editor
npm.cmd test --prefix apps/PCB_Editor
```

浏览器测试默认使用本机安装的 Microsoft Edge。测试覆盖界面交互、图层像素、选区与魔棒、工程包兼容、撤销重做以及接近图像上限的操作。

- `src/app.ts`：编辑器逻辑、图像算法和运行状态。
- `src/types.d.ts`：图像、选区、工程包等数据结构。
- `src/elements.d.ts`：固定页面与动态弹窗的 DOM 节点类型；新增节点时同步维护对应条目。
- `template.html`：HTML 和 CSS 的维护入口，保留脚本插入标记。
- `scripts/build.mjs`：校验编译结果，再替换根目录的单文件 HTML。

修改逻辑后执行构建，将生成的 HTML 与源码一同提交。修改界面和样式时编辑 `template.html`；直接修改生成的 HTML 会在下次构建时被覆盖。

TypeScript 开启严格类型检查，编译失败时保留已有 HTML。工程文件和浏览器偏好仍按原有规则校验与恢复；类型声明不替代运行时校验。

通行证模板设计已独立为 `PCB-PassCard-Generator`，不由此构建流程生成。
