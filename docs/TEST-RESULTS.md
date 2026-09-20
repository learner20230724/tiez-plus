# TIEZ Plus 0.1.0 构建与测试记录

日期：2026-09-20。环境：Windows x64；本目录独立 Git 仓库。以下是构建期验证，**不是已在用户手机和当前 Windows 剪贴板上验收的声明**。

后续状态：本页保留首版构建时的记录。当天用户明确授权直接安装后，已修复并启动本机 Plus 服务，实际 LocalService 与 HTTP 健康检查通过；新增测试后 Node 共 35 项通过。详情见 `INSTALLER-FIX2.md`。桌面剪贴板及手机端到端仍未在本机测试。

## 自动化结果

| 项目 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 持久化、传输、发现选择、隔离 | `npm test` | 25 / 25 通过 |
| Rust 持久化回执、去重与文件授权 | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plus_` | 5 / 5 通过；不运行应用主程序 |
| 手机 TypeScript | `npm run check:mobile` | 通过 |
| 独立版本配置 | `npm --prefix apps/mobile run validate:versions` | 通过；旧 EAS 发布入口禁用 |
| 桌面前端 | `npm run build:desktop` | TypeScript / Vite 构建通过 |
| Windows x64 安装包 | `scripts/build-windows.ps1` | Release / NSIS 构建通过，未运行安装程序 |
| Android ARM64 APK | `scripts/build-android.ps1` | 原生 Kotlin / CMake / Hermes / R8 构建通过，release 签名验证通过 |
| 原项目隔离校验 | `npm run check:isolation` | 304 个原项目源文件与起始 SHA-256 一致 |
| 旧服务 | 只读查询 `Get-Service TieZLocalMqttServer` | Running；未停止、修改或重启 |

Node 联调用临时 SQLite、随机本机端口的独立 Broker、模拟电脑协议端和模拟剪贴板；UDP 测试仅发向 loopback，不探测日常设备。强制终止测试仅结束测试自行创建的 SQLite 子进程。

重点验证：长中文/换行/空格/表情全文一致；发送期间继续编辑与多草稿部分成功不丢字；保存指示只对应完整已落盘快照；PUBACK 不等于送达；回执丢失与断线不自动重发正文；同消息 ID 持久化去重；崩溃恢复与事务回滚；90 天只清理已送达；拉取零剪贴板写入；手动复制先取全文且检查写入结果；历史分页使用摘要但搜索/详情使用全文；设备选择不悄悄切换电脑；TCP 占用不杀进程；主题权限及独立应用/更新配置。

## 安装包

最终安装包、SHA-256 与构建结果见根目录 `artifacts/`。Windows 包未商业代码签名；Android 使用本项目独立 release keystore，不是原版或 debug 签名。签名私钥不在安装包、Git 或说明文件中。

构建脚本仅生成安装包，**没有运行 EXE、安装服务、启动 Plus 正式客户端、连接 ADB 或安装 APK**。

Windows 包内含私有 Node、Aedes/WS/mDNS 依赖、NSSM 和 Plus 安装/卸载脚本；NSIS 生成清单已静态检查。服务安装代码和真实防火墙行为未在这台正在使用的电脑上执行。

Android 使用私有 Node 22.23.2、JDK 17、Android SDK 36、NDK 27.1.12297006、CMake 3.22.1，仅构建 ARM64。为避开中文路径工具链问题，构建脚本使用自有临时盘符和临时目录，并规范化自动生成的 autolinking/CMake 路径；结束后解除自己的映射，不修改系统环境变量和依赖源码。

APK 静态检查：包名 `io.github.learner20230724.tiezplus`，versionName `0.1.0` / versionCode `1`，minSdk **24**、targetSdk **36**；仅含 `arm64-v8a`，无 debug 标记，`allowBackup=false`。APK v2 / RSA-4096 签名通过；ZIP 对齐和全部 **20 个 ARM64 ELF 库**的 LOAD 段均通过 16 KiB 对齐检查。公钥证书 SHA-256：`b91168536b754de321972b053749155ba5a20299b1bab8042862c01ff1cac2d5`。这些静态检查不替代 nubia 实机运行。

可复现构建步骤不意味着每次生成完全相同的二进制字节：签名、压缩及构建时间元数据可能变化，应核对本次交付的 `SHA256SUMS.txt`。

附加只读验证命令（项目根目录；`JAVA_HOME` 指向 `.runtime/jdk17`）：

```powershell
./.runtime/android-sdk/build-tools/36.0.0/apksigner.bat verify --verbose --print-certs artifacts/TIEZ-Plus-0.1.0-arm64-v8a.apk
./.runtime/android-sdk/build-tools/36.0.0/zipalign.exe -c -P 16 4 artifacts/TIEZ-Plus-0.1.0-arm64-v8a.apk
python scripts/verify-apk.py
./scripts/artifact-checksums.ps1
```

## 仍需后续验收

按 `ACCEPTANCE.md` 在隔离 Windows VM 和 nubia M153 执行真实安装/升级/卸载、原生 NSD、厂商后台策略、Wi-Fi/IP 切换、休眠恢复、真实 Windows / Android 剪贴板与断网场景。没有借自动化通过来宣称这些实机项目已完成。

已知首版边界：可信个人 IPv4 局域网，HTTP/WS 无 TLS；多实例需选设备名；只传文字，文件/WebDAV 是明确分开的旧功能；最终 250 ms 尚显示“保存中”的输入在系统强杀前未必落盘；Windows 文本剪贴板不支持 NUL 时返回已保存但复制失败；上游富文本修复为选择性移植，不承诺所有 Office 软件已经验证。
