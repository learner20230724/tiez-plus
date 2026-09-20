# TIEZ Plus

独立于旧版 TieZ 的个人局域网剪贴板工具：**先保存，再发送；电脑处理完成才算送达。**

**Windows 安装修正：后续安装请使用 `TIEZ Plus_0.1.0_x64-setup-fix2.exe`。** 已修正首次安装的服务不存在误判，以及 `Program Files` 路径引号丢失导致的启动失败。记录见 `docs/INSTALLER-FIX1.md`、`docs/INSTALLER-FIX2.md`；用户授权后，本机 Plus 服务已直接修复并验证运行。手机 APK 不变，无须关闭旧版或杀毒软件。

## 首版行为

- 手机发现同一局域网的 Plus 服务，单实例自动连接；有多个新实例时选设备名，记住的电脑优先。自动发现受限时扫描电脑上的 **Plus 连接码**。
- Windows 安装包带私有 Node 与 Aedes Broker。安装时才注册独立 `TiezPlusBroker` 服务，客户端在登录用户会话访问剪贴板，服务不访问剪贴板。
- 手机多条草稿写入 SQLite，短防抖 250 ms；发送前刷盘并事务性创建发件记录。输入框显示“已保存”后才表示落盘，强制结束进程前尚显示“保存中”的最后输入不作落盘保证。
- MQTT QoS 1 仅保证到 Broker 的传输。只有电脑**保存全文 → 写入剪贴板 → 保存回执**全部完成，手机才显示“已送达”。10 秒没有回执显示“未确认送达”，不是断言电脑没收到。
- 失败/未确认记录在“手机历史”里查看全文、搜索、复制、原样重试、编辑后再次发送、确认后删除。原样重试沿用消息 ID；成功记录再次发送使用新 ID。
- 不自动补发。恢复网络只连接、探测电脑状态、查询最近未确认记录的状态；不会发送它们的正文。
- 已送达记录从确认时起保留 90 天；草稿、失败和未知记录不自动清理。
- 拉取电脑当前剪贴板与最近 50 条可导出文字历史，只展示。**点击复制才写入手机剪贴板**；历史正文单独读取，不能拿摘要代替全文。
- 受敏感标签/隐私规则保护的内容不远程导出。文本 UTF-8 上限 1 MiB，超限仍保留手机全文，不截断。
- 原文件/图片/视频传输作为独立功能保留，使用带会话授权的文件传输二维码；WebDAV 在设置中配置、在拉取页显式读取，不是 MQTT 的隐式回退。

## 不影响旧版

| 项目 | Plus 的独立配置 |
| --- | --- |
| Git/源代码 | 本目录独立仓库，无旧仓库 remote 绑定 |
| Android | `io.github.learner20230724.tiezplus`，独立 release 签名 |
| Windows | `io.github.learner20230724.tiezplus.desktop`，进程 `tiez-plus.exe` |
| 桌面数据 | `%APPDATA%\io.github.learner20230724.tiezplus.desktop`（或用户明确选择的 Plus 数据位置） |
| Broker 数据 | `%ProgramData%\TIEZ Plus\broker` |
| 后台服务 | `TiezPlusBroker`，以 LocalService 运行 |
| 端口 | 仅本机 MQTT 18883；LAN HTTP/WS 18083；UDP 发现 18084；可选文件传输 18085 |
| 发现 | `_tiezplus._tcp` + UDP；TCP 被占用时另选空闲端口，不结束其他进程 |
| 默认快捷键 | `Ctrl+Alt+Shift+V`；不接管旧版 `Alt+C` 或 Win+V |
| 开机启动 | 首次显式启动 Plus 后写入当前用户独立的 `TIEZ Plus` 启动项 |
| 更新 | 原作者更新服务/EAS 绑定已移除；首版禁用自动更新 |

没有迁移旧数据库、覆盖旧 APK、停止旧服务或自动安装/启动 Plus。卸载脚本只移除 Plus 服务、防火墙规则与 Plus 启动项，保留历史数据。

## 安装与首次试用（请另行安排，不在开发中自动执行）

1. 先在隔离 Windows 虚拟机验收安装包和真实剪贴板，再在你的电脑安排试用。
2. Windows 安装程序需要管理员权限来注册 Plus 服务及防火墙规则。无需另外安装 Node。启动 **TIEZ Plus** 客户端；手机端“电脑已就绪”才代表可以处理文字。
3. Android 安装 `arm64-v8a` APK，可与旧版并存。目标手机是 **nubia M153 / Snapdragon 8 Elite**，最低 Android 7.0（API 24），以实际 APK 清单为准；未连接或操作你的手机。
4. 手机和电脑接入同一可信 Wi-Fi/LAN。Windows 网络类别应是“专用”。多台 Plus 电脑先按设备名选择；必要时用桌面状态栏的 Plus 连接码。
5. 写一小段测试文字，看到“已保存”后发送；电脑客户端运行时手机才会得到送达回执。拉取后先查看，再手动复制。

Windows 包未进行商业代码签名，系统可能提示未知发布者。Android 使用本项目自己的签名，不会覆盖原版。请核对 `artifacts/SHA256SUMS.txt`。

## 安全边界与已知限制

- 这是**可信个人局域网**模式：免确认自动入网不能识别同网恶意设备。HTTP/WS 未启用 TLS；任何能接入此可信网段的原生客户端都可能自行注册，不能用于公共 Wi-Fi。
- 防火墙仅开放本地子网、专用网络、Plus 专用可执行文件。不关闭防火墙、不改公网映射、不自动把公共网络改为专用。
- 首版发现为 IPv4；访客网络隔离、跨 VLAN、多播被拦截可能导致自动发现失败。不会扫描整段 IP。
- 电脑在剪贴板写入与回执持久化之间崩溃时，显示“结果待确认”，不会再次自动覆盖剪贴板。用户确认确需重写时，可从历史“编辑/再次发送”创建新 ID。
- 电脑只保证接收文字并写入剪贴板，不自动向当前前台程序按 Ctrl+V。
- 原版富文本兼容逻辑保留，增量移植 WPS 预览/空白及修饰键修复；没有整体合并 1.0 测试分支，也不宣称所有办公软件格式已经实机验证。
- NSD、厂商省电策略、实际休眠/切换 Wi-Fi、真实系统剪贴板及安装升级卸载，需要按 `docs/ACCEPTANCE.md` 在隔离机/手机验收。自动化通过不等于这些测试已经做过。

## 开发与构建

PowerShell，在本目录执行：

```powershell
npm ci
npm --prefix apps/mobile ci
npm --prefix apps/desktop ci
npm test
npm run check:mobile
npm run build:desktop
npm run check:isolation
./scripts/build-windows.ps1 -SkipBuild  # 仅准备内嵌运行时资源
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plus_
./scripts/build-windows.ps1
./scripts/build-android.ps1
```

- 调试编译桌面程序默认是隔离模式，不启用剪贴板监控、Plus MQTT 客户端或热键。自动化测试只用 mock 剪贴板和临时 SQLite。不要在当前工作电脑做真实粘贴测试。
- Android JDK、SDK、Node 22、Gradle 缓存和临时文件全部在 `.runtime`；为避免 Windows 中文路径工具链崩溃，脚本临时映射一个空闲盘符，并规范化自动生成的 autolinking/CMake 路径，在 `finally` 解除自己建立的映射。没有改变系统 PATH/Java/SDK，也没有修改依赖源码。
- 首次构建下载工具链，需要网络。脚本识别当前 HTTP(S) 代理，配置仅作用于私有构建环境。
- `.secrets` 保存独立 Android release keystore 与密码，只允许当前用户/SYSTEM 读取。**请备份；丢失会影响后续原地更新。不能提交或随安装包发布。**
- `artifacts` 只放构建产物和校验文件；脚本不运行安装包、不连接 ADB、不安装服务。
- 来源与选择性移植记录见 `docs/UPSTREAM.md`，协议见 `docs/PROTOCOL.md`。GPL-3.0 与上游版权信息保留；原 Broker 的 MIT 许可证另见其目录。
- 本次构建与自动化结果见 `docs/TEST-RESULTS.md`；待做的实机项目见 `docs/ACCEPTANCE.md`。Android 禁用系统自动备份，避免把手机草稿和发件正文交给系统云备份。
