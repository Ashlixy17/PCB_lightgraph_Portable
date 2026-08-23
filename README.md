
<h1 align="center">PCB_Lightgraph_Portable</h1>

<p align="center">
  <img alt="Language" src="https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=black">
  <img alt="Framework" src="https://img.shields.io/badge/Framework-HTML5%20Canvas-E34F26?logo=html5&logoColor=white">
  <br>
  <img alt="Runtime" src="https://img.shields.io/badge/Runtime-Browser-4285F4?logo=googlechrome&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-D22128">
   <a href="https://github.com/Ashlixy17/PCB_lightgraph_Portable/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Ashlixy17/PCB_lightgraph_Portable?style=social"></a>
</p>

<p align="center">
  <strong>PCB_lightgraph_Portable</strong> 是 PCB_lightgraph 的HTML便携版
  <br>
  不用安装，不用编译，双击即可开始创作
  <br>
  <strong>已完全实现与安装版相同功能！</strong>
</p>

<p align="center">
  什么？你连下载的都懒得下载？那好吧<br>
  <a href="https://ashlixy17.github.io/PCB_lightgraph_Portable/">点击此处开始使用网页版</a>
</p>

## Web界面&完整功能
![PCB_lightgraph Portable 界面预览](assets/interface-preview.png)

---
- **单文件离线运行**：`PCB_lightgraph_portable.html` 内置全部界面与算法，支持双击直接打开。
- **自动分图**：彩色识别输出线路、阻焊、丝印与背透光层；纯灰度三分模式保留三层输出。
- **工艺与细节控制**：支持 ENIG 沉金、HASL 喷锡、OSP 玫瑰金、裸露基材绑定、灯条参考图，以及拉普拉斯增强 / Canny 描边等。
- **大图也能顺手调参**：渐进式渲染，拖动时快速预览无卡顿；内置快捷裁剪与图纸快捷编辑，可直接回读笔画修改。
- **工程可携带**：可导出安装版兼容的 `.pcblg` 工程包，保存原图、参数与灯条，工程压缩包已完全兼容安装版。

## 快速开始

1. 双击 `PCB_lightgraph_portable.html`，推荐使用 Chrome 或 Edge。
2. 在 `文件 → 导入图片` 中选择你想处理的图片；需要时可先在快捷裁剪窗口调整范围。
3. 调整基础参数、裸露基材或边缘处理，并可通过 `编辑 → 图纸快捷编辑` 直接修图。
4. 使用 `文件 → 导出图纸` 导出生产层 PNG；彩色模式还会导出背透光层与 LED 灯条参考图。

支持滚轮缩放、右键平移；快捷裁剪与图纸快捷编辑同样支持缩放和平移。
> [!WARNING]
> 导入图像上限为 **1600 万像素** ( 浏览器限制 )，超过时会自动 **等比缩小**，并可能造成卡顿现象。

> [!TIP]
> 当你遇到任何问题、任何新想法都可以直接在issue中提出，欢迎**任何人**提交Pull Request来参与贡献。

## 便携版说明

| 项目 | HTML 的处理方式 |
| --- | --- |
| 文件 | 图纸和 `.pcblg` 工程包均通过浏览器下载／导入，不会静默写入磁盘。 |
| 偏好 | 界面设置存于当前浏览器的 `localStorage`；工程文件可跨设备携带。 |
| 图层 | 彩色模式支持铜层、阻焊、丝印、背透光层与 LED 灯条参考图；灰度模式专注三层输出。 |

## 技术与许可

- 基于 Canvas `ImageData` 在浏览器本地逐像素处理，不依赖外部运行时。
- 移植桌面版的主要分层、边缘处理、工程包兼容与渐进式渲染思路。
- 本项目采用 [MIT License](https://opensource.org/licenses/MIT) 开源；素材版权与后续制板合规性由使用者自行确认。

## 支持

<p align="center">
  <img src="assets/support-star.gif" alt="感谢支持" width="180">
</p>

**原安装版软件**：
[PCB_lightgraph](https://github.com/tomatorigid/PCB_lightgraph) 可以前去支持一下哦！<br>
**PCB绘制交流群**(非群主)：<br>
[[QQ]雷霆PCB的雷霆大群-1](https://qm.qq.com/q/v7i4PKNlzW) <br>
[[QQ]雷霆PCB的雷霆大群-2](https://qm.qq.com/q/pVp5vf3RLi) <br>
如果你有任何关于**嘉立创EDA**和**PCB打印**的问题，都可以进群询问。

### 如果觉得软件对你有帮助，求求你点个 Star 吧！(ﾉ>ω<)ﾉ 
## Star History

<a href="https://www.star-history.com/?repos=Ashlixy17%2FPCB_lightgraph_Portable&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Ashlixy17/PCB_lightgraph_Portable&type=date&theme=dark&legend=top-left&sealed_token=-vuOSmKl1mfmWZqRmQxaKV68_LdrKaxgbtP6ow5LTxZAqKXrFPuJlf_TLV4PEJHK8RSDoeqwlDO113NTfDH0C8MXbow6LaiplWBXvNFHThBPQ34uWYpCpBnDkML5nfM9pZXcG3kvY9zROVCHJ12Ppw9YuopEaY_C_0YhMctwgUDQSNdrnpCNsby8culz" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Ashlixy17/PCB_lightgraph_Portable&type=date&legend=top-left&sealed_token=-vuOSmKl1mfmWZqRmQxaKV68_LdrKaxgbtP6ow5LTxZAqKXrFPuJlf_TLV4PEJHK8RSDoeqwlDO113NTfDH0C8MXbow6LaiplWBXvNFHThBPQ34uWYpCpBnDkML5nfM9pZXcG3kvY9zROVCHJ12Ppw9YuopEaY_C_0YhMctwgUDQSNdrnpCNsby8culz" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Ashlixy17/PCB_lightgraph_Portable&type=date&legend=top-left&sealed_token=-vuOSmKl1mfmWZqRmQxaKV68_LdrKaxgbtP6ow5LTxZAqKXrFPuJlf_TLV4PEJHK8RSDoeqwlDO113NTfDH0C8MXbow6LaiplWBXvNFHThBPQ34uWYpCpBnDkML5nfM9pZXcG3kvY9zROVCHJ12Ppw9YuopEaY_C_0YhMctwgUDQSNdrnpCNsby8culz" />
 </picture>
</a>


## 声明

本网站是一款将 2D 插画转换为 PCB 分层图纸的开源HTML工具（以下简称“本工具”），**主要面向学习与个人创作**。

1. **素材版权由使用者负责**：本工具不会为输入图像做版权审查。若您使用他人的原创作品（插画、角色形象、图片等）进行制作，请确保已获得相应授权；因素材侵权产生的纠纷与责任由使用者自行承担，与作者及本工具无关。
2. **肖像与隐私**：请勿使用本工具处理涉及他人肖像、隐私或敏感内容的图像。
3. **商用免责**：若有商家／商贩使用本工具进行 PCB 周边产品的生产与销售，由此产生的产品质量、商业模式、版权纠纷及其他一切问题与后果，均与作者及本工具无关，作者不承担任何责任。
4. **按现状提供（AS-IS）**：本工具按现状提供，不附带任何明示或暗示的担保，作者不对其适用性、可靠性或特定用途作出任何保证。
5. 使用本工具即视为已阅读并同意以上内容。
