# 水面

使用原生 WebGL 2 和 GLSL 实现的全屏流动水面，包含远处的天际线、多尺度波纹、浅水河床、折射和反射效果。在右下角可直接选择白天、傍晚或月光。

重构优先级与进度见 [重构路线图](./ROADMAP.md)，水景控件样式见 [界面规范](./DESIGN.md)。

天际线位于距画面顶部约 28% 的位置。白天保留清浅的近水与水下细节，阳光在偏左的波峰上形成细碎亮点；河床细节与水面反光向远处逐渐减弱。天空以清晰的蓝色为主，左亮右蓝，靠近天际线时渐淡，与远水柔和相接。

河床使用 Poly Haven 的 [Dry River Pebbles](https://polyhaven.com/a/dry_river_pebbles) 颜色和法线贴图，作者 Amal Kumar，许可为 [CC0](https://polyhaven.com/license)。

水下鱼影使用 [Polyy.AI 的 2D Fish Sprites Pack](https://polyyai.itch.io/2d-fish-sprites-pack) 中的虹鳟、锦鲤、大口黑鲈和沟鲶贴图（[来源镜像](https://github.com/ZaneH/herdr-aquarium-theme/tree/main/mods/aquarium/assets)），许可为 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)；每次打开页面时鱼的初始位置随机，随后在各自范围内缓慢游动、平滑改变路线和速度，并受水面折射影响。

河床上分布着随水流轻摆的水草，同样会受到水面折射和光线变化的影响。

在项目目录使用 Node.js 24 运行：

```powershell
npm ci
npm run dev
```

打开 Vite 输出的本地地址。需要支持 WebGL 2 的现代浏览器。画质会在性能不足时自动降低；系统启用“减少动态效果”时显示静止画面，并即时切换光线。

首屏先渲染水面和天空，鱼群与河床纹理各自加载完后再显示。画面素材加载结束后，音频才以低优先级在后台下载。背景音下载期间，扬声器按钮显示等待图标且不可点击；下载完成后可手动开启，失败时可点击重试。划水声加载不影响开关。

左下角可切换「宁静湖面」和「日照金山」。雪山仅供观景，首次选择时才加载渲染模块并生成地形，不下载雪山照片。WebGL 使用程序化高度场生成地形，主峰加入不对称的岔脊和沟壑，根据高度和坡度分布积雪。岩面和雪面的细节使用三维程序噪声生成，避免平面纹理沿陡坡拉伸，在晨光、傍晚、月光下随照向变化。低对比度的近坡与山脚的薄雾拉开远近层次。

**水面调参**默认隐藏。需要时，在 Vite 开发地址后加 `?tuning=1`；宽屏在左下角，窄屏在左上角。可实时调整天际线位置、白天天空蓝度、白天远水过渡宽度、整体反光强度和「波光增强（白天）」。波光滑块范围为 0–200%，默认 200%，0% 仅关闭额外增强。可一键恢复默认；临时调整不保存，面板不包含在生产构建中。

`npm run build` 执行类型检查并输出静态站点；可用 `npm run preview` 预览构建。运行 `npx playwright install chromium` 后，使用 `npm run test:browser` 在 `/nagi/` 子路径验证构建，包括三种光照参考帧和切换期间的天际线稳定性。参考帧的精确哈希适合同环境对比，跨平台时请结合图像判断。

在水面上短距离移动鼠标并停下，会产生向外扩散的点状涟漪；较长的划动则留下平滑、向两侧扩散并逐渐消散的水迹。天空区域不会触发水面交互。启用“减少动态效果”时不会产生动态涟漪。

划过水面会惊动附近的鱼，它们沿原来的游动方向偏转不超过 30° 并加速，随后逐渐减速，从新的位置继续游动；轻触的影响较小。启用“减少动态效果”时鱼保持静止。

湖畔环境音默认关闭，可通过右下角的扬声器图标开启或关闭；音量可通过设备系统设置调整。来源为 LG 在 Freesound 发布的 [230727 - Am Behlersee 1](https://freesound.org/people/LG/sounds/713159/)（[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)）。网页使用 55 秒立体声 FLAC 版本；从原录音截取 0:35–1:35，减弱低频风噪、调整响度，并将首尾交叉淡化后交给 Web Audio 循环播放。

开启声音后，鼠标划过水面时还会播放划水声：开始和停止时平滑淡入淡出，持续划动时平滑循环，声音随划动时长变化。划水声由 [MOSS-SoundEffect v2.0](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0) 本地生成，模型使用 Apache-2.0 许可。

## GitHub Pages

在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。将部署工作流提交到 `main` 后，每次推送到 `main` 都会自动更新预览，也可在 Actions 页面手动运行。部署成功后，可通过工作流显示的地址访问；默认地址为 `https://yuchensuncshi.github.io/nagi/`。

本地 `reference` 文件夹中的 Shadertoy 源码仅供参考，不纳入仓库；水面效果为独立实现。
