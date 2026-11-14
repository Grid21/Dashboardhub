; Dashboard Hub - extra steps for the Windows uninstaller (picked up automatically by electron-builder).
; At the end of an uninstall, ask whether to delete the person's own data too.
; Nothing is asked when the uninstall is silent, and nothing is asked (or deleted) when a new version
; is installed over an old one, because the old version's uninstaller runs silently then.

!macro customUnInstall
  ${ifNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Do you also want to delete your Dashboard Hub data?$\r$\n$\r$\nThis removes your panels, notes, network profiles, saved servers and settings from this computer, and it cannot be undone.$\r$\n$\r$\nChoose No to keep them, for example if you plan to install Dashboard Hub again." IDYES deleteHubData IDNO keepHubData
    deleteHubData:
      SetShellVarContext current
      RMDir /r "$APPDATA\dashboard-hub"
    keepHubData:
  ${endIf}
!macroend
