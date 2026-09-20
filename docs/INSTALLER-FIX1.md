# Windows 安装检查修正：fix1

日期：2026-09-20。仅修正 Windows 安装器，不改电脑主程序、Broker 协议、手机 APK 或历史数据库。应用版本仍为 0.1.0，安装器修订号为 fix1。

## 故障与原因

旧包在首次安装时出现 `Cannot stop TiezPlusBroker`。当 Plus 服务尚未安装，`Get-Service -ErrorAction SilentlyContinue` 虽不输出错误，但 PowerShell `-Command` 仍可能以 1 退出；旧安装钩子把这个返回值一律解释为“停止服务失败”。已经在 Windows PowerShell 5.1 复现：旧命令返回 1，明确成功退出的命令返回 0。不是必须退出旧 TieZ，也不需要禁用杀毒软件。

## 修正

- 只有“服务不存在”按首次安装正常放行，明确 `exit 0`。
- Plus 服务已经停止时直接放行；运行中只停止 `TiezPlusBroker`；正在停止时只等待。
- 查询权限错误、停止失败及等待超时仍阻止安装，不吞掉真实故障。
- 安装前检查和服务安装步骤记录退出码与实际错误到 `%TEMP%\TIEZ-Plus-install.log`，错误对话框显示详情及日志位置。
- 不触碰旧 `TieZLocalMqttServer` 或其他服务。

## 验证

- `node --test tests/installer.test.mjs`：8 / 8 通过。使用生产钩子中实际的 PowerShell 命令，覆盖不存在、已停止、运行中、正在停止、查询拒绝、停止拒绝和超时；服务对象/操作均模拟。
- `npm test`：33 / 33 通过，包括原 25 项与新增 8 项。
- `node scripts/test-installer-smoke.cjs`：无界面的测试辅助 EXE 验证真实的 32 位 NSIS → nsExec → Sysnative 64 位 PowerShell 调用与转义，缺失服务按成功返回。服务命令被替换为模拟函数；此辅助程序不安装文件/服务、不改注册表、不操作剪贴板。
- 原项目 304 个源文件校验一致，旧服务仍运行。未在当前电脑运行正式安装器或注册 Plus 服务。

## 使用

关闭旧包的失败对话框和安装窗口，改用 `artifacts/TIEZ Plus_0.1.0_x64-setup-fix1.exe`。无需清理旧版、旧数据或手动删除服务。Android APK 无须重新安装。

原 `TIEZ Plus_0.1.0_x64-setup.exe` 保留作原始构建记录，**不要继续用它安装**。校验文件已同时记录文件名；请按 `fix1` 文件名核对。如果还有错误，请提供新对话框或它显示的安装日志。
