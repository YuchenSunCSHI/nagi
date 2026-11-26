# 水面

使用原生 WebGL 2 和 GLSL 实现的全屏流动水面，包含远处的天际线、多尺度波纹、浅水河床、折射和反射效果。固定镜头下可通过按钮依次切换白天、傍晚和月光夜晚。

重构优先级与进度见 [重构路线图](./ROADMAP.md)。

天际线位于距画面顶部约 28% 的位置。白天保留清浅的近水与水下细节，河床细节和水面反光向远处逐渐减弱，形成由浅到深的过渡。天空以清晰的蓝色为主，只在靠近天际线处渐淡，与远水柔和相接；天空左亮右蓝，波光也偏向画面左侧。

河床使用 Poly Haven 的 [Dry River Pebbles](https://polyhaven.com/a/dry_river_pebbles) 颜色和法线贴图，作者 Amal Kumar，许可为 [CC0](https://polyhaven.com/license)。

水下鱼影使用 [Polyy.AI 的 2D Fish Sprites Pack](https://polyyai.itch.io/2d-fish-sprites-pack) 中的虹鳟、锦鲤、大口黑鲈和沟鲶贴图（[来源镜像](https://github.com/ZaneH/herdr-aquarium-theme/tree/main/mods/aquarium/assets)），许可为 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)；每次打开页面时鱼的初始位置随机，随后在各自范围内缓慢游动、平滑改变路线和速度，并受水面折射影响。

河床上分布着随水流轻摆的水草，同样会受到水面折射和光线变化的影响。

在项目目录使用 Node.js 24 运行：

```powershell
npm ci
npm run dev
```

打开 Vite 输出的本地地址。需要支持 WebGL 2 的现代浏览器。画质会在性能不足时自动降低；系统启用“减少动态效果”时显示静止画面，并即时切换光线。

`npm run build` 执行类型检查并输出静态站点；可用 `npm run preview` 预览构建。运行 `npx playwright install chromium` 后，使用 `npm run test:browser` 在 `/nagi/` 子路径验证构建。参考帧的精确哈希适合同环境对比，跨平台时请结合图像判断。

在水面上短距离移动鼠标并停下，会产生向外扩散的点状涟漪；较长的划动则留下平滑、向两侧扩散并逐渐消散的水迹。天空区域不会触发水面交互。启用“减少动态效果”时不会产生动态涟漪。

划过水面会惊动附近的鱼，它们沿原来的游动方向偏转不超过 30° 并加速，随后逐渐减速，从新的位置继续游动；轻触的影响较小。启用“减少动态效果”时鱼保持静止。

风声和水浪环境音默认关闭，可通过左上角的“声音”按钮开启或关闭；音量可通过设备系统设置调整。音效由 [MOSS-SoundEffect v2.0](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0) 本地生成，经过循环接缝和响度平滑处理，并使用 Web Audio 无间隙循环播放。模型使用 Apache-2.0 许可。

开启声音后，鼠标划过水面时还会播放划水声：开始和停止时平滑淡入淡出，持续划动时平滑循环，声音随划动时长变化。划水声同样由 MOSS-SoundEffect v2.0 本地生成。

## GitHub Pages

在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。将部署工作流提交到 `main` 后，每次推送到 `main` 都会自动更新预览，也可在 Actions 页面手动运行。部署成功后，可通过工作流显示的地址访问；默认地址为 `https://yuchensuncshi.github.io/nagi/`。

本地 `reference` 文件夹中的 Shadertoy 源码仅供参考，不纳入仓库；水面效果为独立实现。
