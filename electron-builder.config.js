// electron-builder 打包配置（ESM，因为项目 package.json 设了 "type":"module"）。
//
// 本机（标准 Windows 用户）打包的两个坑，已在下面配置里解决：
//  1) winCodeSign 解压失败：electron-builder 在 win32 下会执行 app-builder 的
//     rcedit 命令改写 exe 的图标/版本信息，该命令内部要去下载 winCodeSign 工具链。
//     这个压缩包里含指向 darwin/linux 的软链接，而标准用户没有「创建符号链接」
//     特权，7za 解压必然报 "Cannot create symbolic link" 并使构建中止。
//     → 解法：win.signAndEditExecutable = false，整个 rcedit/签名环节直接跳过。
//  2) assets/icon.ico 必须用「标准 DIB(BMP) 条目」，不能用 PNG 条目编码，
//     否则内置的 NSIS 3.0.4.1 会报 invalid icon file size / unable to read icon。
//     → 见 assets/gen-icon.mjs（已按此格式生成）。
//
// 本项目为个人本地软件，不做代码签名，未签名安装包照常可安装使用。

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.laoge.aigateway',
  // productName 用于 exe 名/安装目录，刻意保持 ASCII，避免非 ASCII 路径在
  // NSIS / 构建工具链里出问题；中文名走下面的 shortcutName / uninstallDisplayName
  // 与前端标题，用户看到的仍是「玄枢」。
  productName: 'XuanShu',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: [
    'dist/**',
    'electron/**',
    // assets/ 是 buildResources（构建资源），默认不会打进应用包；
    // 托盘图标是运行时需要的，必须显式列进来，否则托盘会空白。
    'assets/tray.png',
  ],
  asarUnpack: [
    '**/dist/**',
  ],
  // 把图标额外放进 resources/（安装后位于 $INSTDIR\resources\icon.ico）。
  // 自定义安装脚本要用它给桌面/开始菜单快捷方式指定图标——因为跳过 rcedit 后
  // 主程序 exe 是 Electron 默认图标，快捷方式必须显式指定 IconFile 才能显示「玄枢」。
  extraResources: [
    { from: 'assets/icon.ico', to: 'icon.ico' },
  ],
  win: {
    target: 'nsis',
    icon: 'assets/icon.ico',
    // 关键：跳过「改写 exe 资源 + 签名」这一步。
    // electron-builder 在 win32 下会用 app-builder 的 rcedit 命令改写 exe 的
    // 图标/版本信息，而该命令内部要下载 winCodeSign 工具链——它包含指向
    // darwin/linux 的软链接，标准 Windows 用户没有「创建符号链接」特权，
    // 解压必然失败导致构建中止（报 Cannot create symbolic link）。
    // 设 false 后整个 rcedit/签名环节被跳过，构建可直接产出未签名安装包。
    // 代价：主程序 exe 保留 Electron 默认图标与版本信息（安装包图标仍可自定义）。
    signAndEditExecutable: false,
    // 空签名模块（字符串形式，避免函数被配置序列化剥离）：
    // 万一将来重新开启 signAndEditExecutable，用它代替内置签名，同样不下载 winCodeSign。
    sign: 'tools/unsigned-sign.cjs',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '玄枢',
    uninstallDisplayName: '玄枢',
    deleteAppDataOnUninstall: true,
    // 自定义安装脚本：在安装末尾用 resources/icon.ico 重建快捷方式，解决
    // 「跳过 rcedit → exe 是 Electron 默认图标 → 快捷方式也没图标」的问题。
    include: 'build/installer.nsh',
  },
};

export default config;
