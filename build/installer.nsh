# 自定义 NSIS 安装脚本（构建时由 electron-builder 的 nsis.include 引入）
#
# 背景：本机构建时设了 win.signAndEditExecutable=false（为绕开 winCodeSign 需要的软链接特权），
# 因此主程序 exe 保留的是 Electron 默认图标。electron-builder 模板创建快捷方式时，
# 图标参数用的是 $appExe（见 templates/nsis/include/installer.nsh 的 addDesktopLink/addStartMenuLink），
# 结果桌面/开始菜单快捷方式显示的是 Electron 通用图标，而不是我们设计的「玄枢」图标。
#
# 解法：模板里 addDesktopLink/addStartMenuLink 在 customInstall 之前执行（installSection.nsh 第 68/69 行 vs 第 81 行），
# 所以这里在安装末尾用随包附带的 resources/icon.ico 把快捷方式重建一次即可。
#
# 注意：本文件刻意保持纯 ASCII —— 快捷方式名走 ${SHORTCUT_NAME} 变量、exe 名走 ${APP_EXECUTABLE_FILENAME}，
# 不硬编码中文，避免 NSIS 脚本的非 ASCII 编码问题。

!macro customInstall
  ${If} ${FileExists} "$INSTDIR\resources\icon.ico"
    # 只为「实际存在」的快捷方式换图标：用户若在安装界面取消了桌面快捷方式，这里不会强行创建。
    ${If} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
    ${If} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
