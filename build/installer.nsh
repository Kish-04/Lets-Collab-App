!macro customInstall
  IfFileExists "$INSTDIR\resources\ViGEmBusSetup_x64.msi" checkViGEmDriver doneViGEmDriver

  checkViGEmDriver:
    ClearErrors
    FileOpen $0 "$INSTDIR\resources\ViGEmBusSetup_x64.msi" r
    IfErrors doneViGEmDriver
    FileSeek $0 0 END $1
    FileClose $0
    IntCmp $1 1024 doneViGEmDriver doneViGEmDriver installViGEmDriver

  installViGEmDriver:
    ExecWait '"msiexec.exe" /i "$INSTDIR\resources\ViGEmBusSetup_x64.msi" /quiet /norestart'

  doneViGEmDriver:
!macroend
