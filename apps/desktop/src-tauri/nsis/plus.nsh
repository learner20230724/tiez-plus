!include "LogicLib.nsh"
!macro PlusInstallCheckLog STEP
  DetailPrint "${STEP}: exit=$0 $1"
  Push $2
  FileOpen $2 "$TEMP\TIEZ-Plus-install.log" a
  FileWrite $2 "${STEP}: exit=$0$\r$\n$1$\r$\n"
  FileClose $2
  Pop $2
!macroend
!macro NSIS_HOOK_PREINSTALL
  ; Only our independently named service is touched during an explicit installation/upgrade.
  ; Missing service is normal on first install. Explicit exit codes are essential:
  ; -Command otherwise returns 1 for Get-Service's suppressed not-found error.
  nsExec::ExecToStack /TIMEOUT=30000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "try { try { $$s = Get-Service -Name TiezPlusBroker -ErrorAction Stop } catch { if ($$_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) { throw }; $$s = $$null }; if ($$s -and $$s.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) { if ($$s.Status -ne [System.ServiceProcess.ServiceControllerStatus]::StopPending) { Stop-Service -InputObject $$s -ErrorAction Stop }; $$s.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(20)) }; exit 0 } catch { Write-Output $$_.Exception.Message; exit 1 }"'
  Pop $0
  Pop $1
  !insertmacro PlusInstallCheckLog "PREINSTALL"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法完成 TIEZ Plus 服务检查，安装已取消。未操作旧版 TieZ。$\r$\n$\r$\n返回码：$0$\r$\n$1$\r$\n$\r$\n诊断日志：$TEMP\TIEZ-Plus-install.log"
    Abort
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\broker-runtime\install-service.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  !insertmacro PlusInstallCheckLog "POSTINSTALL"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "TIEZ Plus 服务安装失败；旧版未被修改。$\r$\n返回码：$0$\r$\n$1$\r$\n$\r$\n诊断日志：$TEMP\TIEZ-Plus-install.log"
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\broker-runtime\uninstall-service.ps1"'
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TIEZ Plus"
  ; Keep Plus histories and all original TieZ data. Never restart Explorer or edit Win+V policies.
!macroend
