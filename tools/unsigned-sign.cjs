// 空签名模块：本项目为个人本地软件，不做代码签名。
// electron-builder 会 require 本模块并调用其 sign 函数；直接返回，
// 文件保持未签名状态，打包继续。这样可跳过内置 winCodeSign 的
// 下载/解压——winCodeSign 内含 darwin 软链接，标准 Windows 用户
// 无「创建符号链接」特权会解压失败，导致安装包构建中止。
async function sign(/* configuration */) {
  return;
}

module.exports = { sign };
