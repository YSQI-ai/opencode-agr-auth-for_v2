# OpenCode V2 Antigravity Auth Adapter

这是 `opencode-antigravity-auth` 的 **OpenCode V2 移植版**。

原版 `opencode-antigravity-auth` 基于 OpenCode V1 插件 API 编写，无法在 OpenCode V2 (及以上版本) 中运行。此项目通过编写 V2 适配层（无缝拦截并重写本地网络请求），100% 保留了原插件的所有核心逻辑（包含 Token 刷新、双端点路由、账号轮换等），使你可以在 OpenCode V2 中正常使用。

> ⚠️ **警告 (免责声明)**：使用 Antigravity OAuth **违反 Google 服务条款**。原插件仓库已有大量用户报告因此导致 Google 账号被封禁或被影子封禁（Shadowban）。使用本插件造成的任何风险由使用者自行承担！

## 功能特性

- ✅ **兼容 OpenCode V2**：完美适配 V2 `export default { id, setup }` API 和 `ctx.session.hook` 等。
- ✅ **自动修复原版 Timeout Bug**：原生 npm 安装过程将自动打补丁，把极易失败的 30 秒授权超时上限提升至 120 秒。
- ✅ **全链路 HTTP 拦截**：本地自建代理流式转发，完美伪装并剥离不兼容的 Headers (如 `x-goog-api-key`)。
- ✅ **本地账号池**：继承原版的多账号轮转和自动刷新逻辑。
- ✅ **工具注册**：成功注册 `google_search` 及其事件钩子。

## 安装指南

**1. 克隆本仓库到 OpenCode 插件目录**（或其他你想存放的位置）
```bash
git clone https://github.com/YourUsername/opencode-v2-antigravity-auth.git ~/.config/opencode/plugins/antigravity
cd ~/.config/opencode/plugins/antigravity
```

**2. 安装依赖**
```bash
# 此步骤极度重要！依赖安装后会自动触发 postinstall 脚本，修补原插件的 Timeout 缺陷
npm install
```

**3. 重启 OpenCode 后台服务**
```bash
opencode service restart
```

## 使用方法

### 1. 登录账号

打开终端输入：
```bash
opencode auth login
```
在列表中选择 `Google`，然后选择 **"OAuth with Google (Antigravity)"**。
浏览器会自动弹出 Google 授权页面。完成授权后，回到控制台即可看到认证成功的提示。

### 2. 测试调用模型

登录成功后，即可直接使用受支持的模型（如 `gemini-3.1-pro-preview` 等）：
```bash
opencode run "Hello, who are you?" --model=google/gemini-3.1-pro-preview
```

## 故障排查 (Diagnostics)

本插件内置了完善的调试日志，排查问题非常方便。
日志文件自动生成在插件根目录的 `debug.log` 中。

**查看实时日志**：
```bash
tail -f ~/.config/opencode/plugins/antigravity/debug.log
```

常见正常链路日志：
- `http.request: no v1 fetch yet`：尚未登录。此时请求会透传给 Google，并被 `unregistered callers` 拒绝。
- `loader result keys=apiKey,fetch fetch=function`：环境初始化成功。
- `http.request rewritten -> local proxy`：拦截命中，流量已接管至本地 V1 核心。
- `stripping x-goog-api-key (V1 authenticates via Authorization: Bearer)`：成功剥离冲突的 V2 鉴权头。

## 卸载

1. 删掉插件目录 `rm -rf ~/.config/opencode/plugins/antigravity`
2. 重启服务 `opencode service restart`

## 协议

适配层代码采用 **MIT License**。  
此项目依赖的 `opencode-antigravity-auth` 及其下游依赖亦为 MIT 或 ISC 等宽松开源协议。
