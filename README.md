# 水面

使用原生 WebGL 2 和 GLSL 实现的全屏流动水面，包含多尺度波纹、浅水河床、折射和反射效果。固定镜头下可通过按钮依次切换白天、傍晚和月光夜晚。

河床使用 Poly Haven 的 [Dry River Pebbles](https://polyhaven.com/a/dry_river_pebbles) 颜色和法线贴图，作者 Amal Kumar，许可为 [CC0](https://polyhaven.com/license)。

在项目目录运行：

```powershell
python -m http.server 8000
```

然后在浏览器打开 `http://localhost:8000`。需要支持 WebGL 2 的现代浏览器。画质会在性能不足时自动降低；系统启用“减少动态效果”时显示静止画面，并即时切换光线。

风声和水浪环境音默认关闭，可通过左上角的“声音”按钮开启或关闭；音量可通过设备系统设置调整。音效由 [MOSS-SoundEffect v2.0](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0) 本地生成，经过循环接缝和响度平滑处理，并使用 Web Audio 无间隙循环播放。模型使用 Apache-2.0 许可。

## GitHub Pages

在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。将部署工作流提交到 `main` 后，每次推送到 `main` 都会自动更新预览，也可在 Actions 页面手动运行。部署成功后，可通过工作流显示的地址访问；默认地址为 `https://yuchensuncshi.github.io/nagi/`。

本地 `reference` 文件夹中的 Shadertoy 源码仅供参考，不纳入仓库；水面效果为独立实现。
