// 以页面入口为基准，兼容本地 HTTP 预览和仓库子路径发布。
export function generatorAssetUrl(relativePath: string): string {
  return new URL(`./PassCard_Generator_assets/${relativePath}`, document.baseURI).href;
}
