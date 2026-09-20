# Windows 服务启动修正：fix2

日期：2026-09-20。应用与手机版本仍为 0.1.0；只更改 Windows 服务安装脚本。

## 已定位的实际故障

安装已写入程序文件、快捷方式及卸载注册项，但 Plus 服务停留在 Paused。Broker 错误日志反复记录 `Cannot find module 'C:\Program'`；注册表中的 AppParameters 是没有保留引号的 `C:\Program Files\TIEZ Plus\broker-runtime\services\broker\index.cjs`。

Windows PowerShell 5.1 调用 NSSM 时丢掉了预期的内嵌引号，导致 Node 把带空格的入口路径拆开。这与旧版是否卸载无关。

## 修复与用户授权的本机操作

- AppDirectory 仍使用安装目录的绝对路径；AppParameters 改成无空格的相对入口 `services\broker\index.cjs`。
- 直接读取注册表验证最终写入值，不解析 NSSM 的 UTF-16 管道输出。
- 用户明确要求“直接给我装上”后，只停止并重新配置 `TiezPlusBroker`，替换它自己的安装脚本，重新启动并核验服务。未删除数据、未操作旧服务、未读写系统剪贴板，未启动桌面主程序。
- 实际运行账户为 LocalService；修复后服务状态 Running、启动类型 Automatic；HTTP `/api/v1/info` 返回正确的 Plus 实例，HTTP/WS 18083、MQTT 18883。后续再次检查仍运行，无新增启动错误。
- 桌面与开始菜单入口、卸载注册项均已存在；不需要用户再次重装当前电脑。

## 验证与后续安装包

- `npm test`：35 / 35 通过。
- 新增实际 Windows PowerShell 5 → Node 启动测试：工作目录同时含中文和空格，相对入口按完整路径执行。
- 本机真实 LocalService 启动及 HTTP 健康检查已验证；这不等于手机端到端和真实剪贴板验收已经完成。
- `TIEZ Plus_0.1.0_x64-setup-fix2.exe` 包含 fix1 和本次修复。旧版无后缀及 fix1 安装包仅保留作构建记录，不能再用于安装。Android APK 不变。
