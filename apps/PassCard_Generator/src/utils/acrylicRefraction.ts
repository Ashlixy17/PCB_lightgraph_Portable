import * as THREE from 'three';

/**
 * 亚克力真实折射材质（屏幕空间折射，参考 codrops "Real-time Multiside Refraction" 的折射部分）。
 *
 * 渲染约定（PassPreview3D.renderFrame 配合）：
 *   Pass A —— 把内侧印刷层渲染到 envRT；
 *   Pass B —— 把亚克力背面法线编码到 backfaceMap；
 *   Pass C —— 用斯涅尔折射采样 envRT，再由外侧印刷层覆盖到亚克力之上。
 *
 * backfaceMap 让平行板折射同时考虑入射面和出射面的法线，不需要按
 * 视角硬编码可见性分支。
 *
 * 空间约定：法线/入射方向均在观察空间（normalMatrix / modelViewMatrix），
 * 避免亚克力 z 向非均匀缩放（厚度）导致法线错误。
 */

// 亚克力（PMMA）折射率
export const ACRYLIC_IOR = 1.49;

export interface AcrylicRefractionOptions {
  envMap: THREE.Texture;
  /** Back-face normal buffer rendered from the same camera. */
  backfaceMap?: THREE.Texture;
  /** 0 = 清透，1 = 全磨砂（散射采样模糊，模拟磨砂玻璃） */
  frost?: number;
  /** Fraction of captured light retained by the refractive surface. */
  transmission?: number;
  /** 折射位移强度（乘在 refracted.xy 上） */
  refractionStrength?: number;
  /** 折射率（默认亚克力 1.49） */
  ior?: number;
  /** 亚克力厚度，单位与模型相同 */
  thickness?: number;
  /** 相机投影矩阵的 X/Y 缩放，用于把视空间位移换算为屏幕 UV */
  projectionScale?: THREE.Vector2;
}

/**
 * 主折射材质：屏幕空间折射 + 背面法线 + 可选磨砂散射。
 * 输出为不透明颜色（alpha=1），并接入 three 的色彩空间转换以匹配场景其他材质。
 */
export function createAcrylicRefractionMaterial(
  opts: AcrylicRefractionOptions
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      // 注意：不能命名为 envMap —— three 会把它当作内置环境贴图 uniform 每帧覆盖为 null
      envTex: { value: opts.envMap },
      backfaceTex: { value: opts.backfaceMap ?? opts.envMap },
      resolution: { value: new THREE.Vector2(1, 1) },
      projectionScale: { value: opts.projectionScale ?? new THREE.Vector2(1, 1) },
      slabThickness: { value: opts.thickness ?? 0.4 },
      // 注意：不能命名为 ior —— three 的 refreshUniformsPhysical 会用 material.ior（undefined）覆盖
      refractIor: { value: opts.ior ?? ACRYLIC_IOR },
      refractionStrength: { value: opts.refractionStrength ?? 0.5 },
      frost: { value: opts.frost ?? 0 },
      transmission: { value: opts.transmission ?? 1 },
      backfaceBlend: { value: opts.backfaceMap ? 0.33 : 0 },
    },
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: false,
    vertexShader: `
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec3 vViewPosition;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // 光线方向：从相机指向当前表面点。
        vViewDir = normalize(mvPosition.xyz);
        vViewPosition = mvPosition.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D envTex;
      uniform sampler2D backfaceTex;
      uniform vec2 resolution;
      uniform vec2 projectionScale;
      uniform float slabThickness;
      uniform float refractIor;
      uniform float refractionStrength;
      uniform float frost;
      uniform float transmission;
      uniform float backfaceBlend;

      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec3 vViewPosition;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / resolution;

        // 对平行亚克力板，折射后的屏幕偏移来自两次光线的横向斜率差，
        // 而不是直接把三维折射方向当作 UV 偏移。这样 IOR=1 时偏移严格为 0。
        vec3 incident = normalize(vViewDir);
        vec3 normal = normalize(vViewNormal);
        if (dot(incident, normal) > 0.0) normal = -normal;

        // Approximate the second interface by mixing in a back-face normal
        // buffer, as in the Codrops multiside refraction method.
        vec4 backSample = texture2D(backfaceTex, uv);
        if (backSample.a > 0.01 && backfaceBlend > 0.0) {
          vec3 backNormal = normalize(backSample.rgb * 2.0 - 1.0);
          normal = normalize(mix(normal, -backNormal, backfaceBlend));
        }
        vec3 refracted = refract(incident, normal, 1.0 / refractIor);
        float incidentZ = max(abs(incident.z), 0.0001);
        float refractedZ = max(abs(refracted.z), 0.0001);
        vec2 viewDelta = (refracted.xy / refractedZ - incident.xy / incidentZ) * slabThickness;
        vec2 disp = 0.5 * projectionScale * viewDelta / max(abs(vViewPosition.z), 0.0001);
        disp *= refractionStrength;

        vec2 sampleUv = uv + disp;
        vec4 envSample = texture2D(envTex, sampleUv);
        float envA = envSample.a;

        vec3 color;
        if (frost > 0.01) {
          // 磨砂：多次小抖动采样平均，模拟磨砂玻璃的散射模糊（偏移以像素计，frost 0~1 映射到 0~8px）
          vec2 base = uv + disp;
          float s = frost * (12.0 / max(resolution.x, resolution.y));
          vec2 o1 = vec2(
            hash12(gl_FragCoord.xy + vec2(1.7, 7.3)) - 0.5,
            hash12(gl_FragCoord.xy + vec2(3.1, 2.9)) - 0.5
          ) * s;
          vec2 o2 = vec2(
            hash12(gl_FragCoord.xy + vec2(9.4, 4.1)) - 0.5,
            hash12(gl_FragCoord.xy + vec2(5.3, 11.7)) - 0.5
          ) * s;
          color = (texture2D(envTex, base + o1).rgb
                 + texture2D(envTex, base + o2).rgb
                 + texture2D(envTex, base - o1).rgb
                 + texture2D(envTex, base - o2).rgb) * 0.25;
        } else {
          color = envSample.rgb;
        }

        // Keep a faint glass body even where a refracted ray leaves the
        // captured card area; this avoids hard holes at the silhouette edge.
        color = mix(vec3(0.96), color, transmission * clamp(envA, 0.0, 1.0));
        float fresnel = pow(1.0 - abs(dot(normalize(incident), normalize(normal))), 3.0);
        color = mix(color, vec3(1.0), 0.08 * fresnel);
        gl_FragColor = vec4(color, 0.18 + 0.62 * clamp(envA, 0.0, 1.0));
        #include <colorspace_fragment>
      }
    `,
  });
}
