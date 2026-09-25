# 手机 HomeView 的隔离界面预览

电脑标题栏另有 `node scripts/desktop-ui-preview.mjs`，访问 `http://127.0.0.1:18767/desktop.html`。渲染真实 AppHeader / PlusStatus，用 mock Tauri API 记录 `window.__qa.drags` 和命令名；测试拖动调用、按钮排除和窄窗布局，不连接服务、不操作剪贴板或系统窗口。

仅用于桌面浏览器视觉回归，不是手机应用，不连接 Broker，也不访问任何真实剪贴板。

## 运行

安装项目的 mobile / desktop 依赖后，在项目根目录执行：

```powershell
node scripts/mobile-ui-preview.mjs
```

只监听 `127.0.0.1:18766`。用一个独立的无头 Playwright CLI 会话访问，视口 `390 × 844`：

- `/`：深色、很长的第一条剪贴板。
- `/?theme=light&short=1`：浅色、一行剪贴板。
- 右上角历史 → 点击记录 → 加入待推送。
- 拉取 → 刷新：模拟剪贴板不变；点击电脑记录：复制完整模拟全文。

输出放入 `output/playwright/`（Git 忽略）。页面的 `window.__qa` 是合成测试数据：检查 `writes`、`clipboard`、`fullRemote`、`historyText`，不要代替实际 SQLite / MQTT 单元与联调测试。

此预览渲染真实的 `apps/mobile/src/plus/HomeView.tsx`，使用原主题颜色；底部导航、图标库和事件依赖为 fixture。Android 原生键盘、字体、状态栏、权限和真机剪贴板仍需在手机验收。不要在此引入 `runtime.ts`、NSD、真实数据库或系统剪贴板 API。
