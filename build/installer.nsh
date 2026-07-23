!macro customInstall
  ExecWait '"msiexec.exe" /i "$INSTDIR\resources\ViGEmBusSetup_x64.msi" /quiet /norestart'
!macroend
