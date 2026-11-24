# 水面

使用原生 WebGL 2 和 GLSL 实现的全屏流动水面，包含多尺度波纹、浅水河床、折射和反射效果。固定镜头下可通过按钮依次切换白天、傍晚和月光夜晚。

河床使用 Poly Haven 的 [Dry River Pebbles](https://polyhaven.com/a/dry_river_pebbles) 颜色和法线贴图，作者 Amal Kumar，许可为 [CC0](https://polyhaven.com/license)。

在项目目录运行：

```powershell
python -m http.server 8000
```

然后在浏览器打开 `http://localhost:8000`。需要支持 WebGL 2 的现代浏览器。画质会在性能不足时自动降低；系统启用“减少动态效果”时显示静止画面，并即时切换光线。

本地 `reference` 文件夹中的 Shadertoy 源码仅供参考，不纳入仓库；水面效果为独立实现。
