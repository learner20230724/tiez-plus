# Windows 桌面启动修正：fix3

日期：2026-09-21。Windows 应用版本仍为 0.1.0，手机 0.1.1 无需再次更新。

## 根因

用户报告双击无窗口、手机显示电脑程序未响应。旧 EXE 在隔离模式下实际启动即退出，标准输出记录：

```text
failed to initialize plugin `updater`: Error deserializing 'plugins.updater' within your Tauri configuration: invalid type: null, expected struct Config
```

移除原作者更新配置时遗漏了更新插件注册。错误发生在正常日志初始化与窗口显示之前，旧错误分支还以退出码 0 结束。此前验证 Broker 正常不能证明桌面客户端可用。

## 修复

- 主程序、库入口移除未配置的 updater 插件及相应权限；不恢复上游更新服务。
- 插件初始化前启用 `%LOCALAPPDATA%\TIEZ Plus\startup.log`；启动失败退出码非零，正常使用时显示错误提示。
- 手动启动显示窗口；再次双击唤起已有实例。只有 `--minimized` / `--autostart` 保持静默。
- 本机 Broker 注册请求绕过代理，避免本地回环请求被系统代理转发。
- 增加 `TIEZ_PLUS_DIAGNOSTICS=1`：允许协议健康检查，但禁用剪贴板监控、读写路径、快捷键、系统钩子及自动启动初始化。仅供短时启动诊断，不作为正常使用模式。
- 增加 `node scripts/probe-desktop.cjs`：临时注册一个诊断设备，仅发送带关联 ID 的 MQTT ping，验证桌面应用回复；不读取历史或剪贴板，不发送文字，不输出凭据。它会在实际 Broker 增加一个诊断设备注册记录。

## 本机实际验证及修复

用户已授权直接安装修复。仅操作 Plus：

1. 生产构建成功；49 / 49 Node 测试通过，304 个旧项目源文件校验不变。
2. 新 EXE 在诊断模式下保持运行，应用层 MQTT ping 通过；未进行剪贴板或历史请求。
3. 停止本次诊断进程，备份旧 EXE 至忽略提交的 `.runtime/tiez-plus-before-fix3.exe`，替换 `C:\Program Files\TIEZ Plus\tiez-plus.exe`，核对 SHA-256 一致。
4. 按用户请求正常启动已安装程序，窗口可见，界面显示“Plus 服务已连接，可接收手机文字”；正常模式应用层 MQTT ping 再次通过。正常启动会启用产品自身的剪贴板监控，但没有执行测试文字发送、拉取或剪贴板写入。
5. 再次启动 EXE，第二进程退出，已有窗口被唤起，仍只有一个桌面客户端。
6. 未停止 Broker、未修改旧服务、未删除或迁移用户数据。fix3 安装包保留 fix1 / fix2 修复；此前安装包只留作构建记录，不应再安装。

本次验证不等于手机实机文字发送、真实剪贴板写入、重启自动启动、升级卸载等完整验收；这些不得标为已完成。
