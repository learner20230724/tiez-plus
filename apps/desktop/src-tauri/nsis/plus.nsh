!include "LogicLib.nsh"
!macro NSIS_HOOK_PREINSTALL
  ; Only our independently named service is touched during an explicit installation/upgrade.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$s = Get-Service -Name TiezPlusBroker -ErrorAction SilentlyContinue; if ($$s -and $$s.Status -ne 1) { Stop-Service -InputObject $$s -ErrorAction Stop; $$s.WaitForStatus(1,[TimeSpan]::FromSeconds(20)) }"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot stop TiezPlusBroker. Installation was cancelled; no other service was touched."
    Abort
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\broker-runtime\install-service.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "TIEZ Plus broker setup failed. Existing TieZ was not modified. See ProgramData\TIEZ Plus or run the Plus service installer again."
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\broker-runtime\uninstall-service.ps1"'
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TIEZ Plus"
  ; Keep Plus histories and all original TieZ data. Never restart Explorer or edit Win+V policies.
!macroend
