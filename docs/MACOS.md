# TIEZ Plus macOS 本地适配

基于 `learner20230724/tiez-plus` master（下载时提交 `e38d635cfe6810b75adb55a99925a414400fa6b2`）。源码最初通过 GitHub API 下载归档，现已核对归档内容与原仓库提交一致，并接回原仓库 Git 历史；macOS 适配作为独立提交保存。

## 安装与使用

Apple Silicon，最低 macOS 12。应用名仍为 **TIEZ Plus**，与旧版 TieZ 保持不同的应用标识和数据目录。

- 安装：将 `TIEZ Plus.app` 放入 `/Applications`，启动应用。
- 显示窗口：菜单栏图标或 `Control + Option + Shift + V`。
- 手机与 Mac 接入同一可信局域网。手机沿用 Plus 协议自动发现；也可扫描桌面端的 Plus 连接码。
- 收到手机文字后仍先保存全文，再写入剪贴板，再发送持久化回执。客户端退出时不会声称送达，不自动重发正文。
- 首次显式启动沿用 Plus 的登录启动行为；可以在设置中关闭。
- 自动粘贴使用 `⌘V`。系统可能要求辅助功能/自动化授权；拒绝授权时返回错误并保留历史，可以手动 `⌘V`。本次安装不替用户改变系统隐私权限。
- macOS 如询问本地网络访问，请允许，手机才能连接。

## macOS 实现

- 当前用户数据：`~/Library/Application Support/io.github.learner20230724.tiezplus.desktop/`。
- 内置 Node 22.23.4 arm64 + Aedes，随应用启动，不注册 Windows 服务，不需要管理员权限。退出时终止自己的 Broker；父进程意外退出时 Broker 自动结束。
- Broker 身份、端口信息与日志在数据目录下的 `broker/`；目录权限 0700，身份文件 0600。连接仍限定可信个人 LAN，不适用于公共 Wi-Fi。
- 使用 macOS 钥匙串保存随机 AES-256-GCM 密钥，每条记录使用独立随机 nonce。钥匙串不可用时停止加密写入，不退化为明文。
- 接入 NSPasteboard 的变更序号、图片、HTML、Finder 文件路径，使用原有保存与去重流程。
- 本机签名为 ad hoc，未做 Apple 公证，面向此机器本地使用。

## 构建

先安装 Node/npm、Rust 和 Xcode Command Line Tools，然后：

```sh
npm ci
npm --prefix apps/desktop ci
./scripts/build-macos.sh
```

脚本只构建，不自动安装或启动应用。Node 官方二进制固定版本并核对 SHA-256；私有运行时随包分发，无需终端 PATH。产物在 `artifacts/TIEZ-Plus-0.1.0-macos-arm64.zip`。

仅读取连接健康状态，不读取或改写剪贴板：

```sh
node scripts/probe-desktop.cjs 3 1000
```

## 验证范围与限制

- Node 自动化：46 通过，8 项 Windows 专用测试跳过。
- Rust 库测试：7 项通过，包括回执持久化/崩溃恢复、慢处理并发网络、加密随机 nonce/错误密钥/篡改拒绝。
- `cargo check` 和前端生产构建通过。
- 修复无边框窗口在 `Resized` 回调中调用 macOS `is_maximized` 导致的事件循环；底层 Tao 会临时切换窗口样式，不应在该回调内查询。
- 已验证应用级 MQTT ping（非仅 Broker PUBACK）以及重启后重新连接。诊断模式不读写系统剪贴板。
- 正常运行日志记录到真实 `send_text status=delivered`；没有读取该消息正文或主动替用户重发。
- 修复后实测空闲 CPU 0%，进程 RSS 约 90 MB。
- 签名与内嵌 Node 完整性验证通过，已安装至 `/Applications/TIEZ Plus.app`。
- 最终版本重新启动后应用级 ping 通过。辅助功能 UI 检查接口持续超时，未完成窗口截图和逐项交互验收；不将此记录为界面验收通过。
- 已处理 macOS Dock 的 Reopen 事件，用于重新显示隐藏的主窗口。
- 原始源码隔离检查依赖开发者 Windows 机器旁边的原始上游目录；此 Mac 没有那些目录，无法运行该检查，不作为通过项。
- Windows 注册表/Win+V、游戏模式、Windows 专有富文本格式及已安装程序枚举不适用于 Mac。
- 尚未全面验收手机双向互传、睡眠换网、各办公软件富文本、Finder 多文件粘贴及自动粘贴权限流程。
- 没有修改手机安装或旧版 TieZ 的数据/服务。
