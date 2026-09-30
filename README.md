# OpenCode V2 Antigravity Auth Adapter

*Read this in [English](#english) | [中文](#chinese)*

---
<a name="english"></a>
## English

This is an **OpenCode V2 port/adapter** for the original `opencode-antigravity-auth` plugin.

The original plugin was built for the OpenCode V1 API and **does not work** in OpenCode V2 (and later). This adapter introduces a compatibility layer that intercepts local network requests and routes them to a local proxy, 100% preserving the original V1 core logic (token refreshing, endpoint routing, account pooling, etc.), making it fully functional in OpenCode V2.

> ⚠️ **Disclaimer & Warning**: Using Antigravity OAuth **violates Google's Terms of Service**. Many users in the original plugin's repository have reported their Google accounts being banned or shadowbanned as a result. **Use this at your own risk!**

### Features
- ✅ **OpenCode V2 Compatible**: Fully adapts to V2's `export default { id, setup }` API and `ctx.session.hook`.
- ✅ **Automatic Timeout Patch**: The default `npm install` automatically patches the notoriously short 30-second authorization timeout up to 120 seconds.
- ✅ **Full HTTP Interception**: Proxies and strips conflicting V2 headers (like `x-goog-api-key`) while preserving V1's `Authorization: Bearer` logic.
- ✅ **Local Account Pool**: Inherits the original plugin's multi-account rotation and auto-refresh mechanisms.
- ✅ **Logout Syncing**: Cleanly wipes V1 cached local accounts and states whenever you log out via OpenCode V2.

### Installation

**1. Clone into your OpenCode plugins directory:**
```bash
git clone https://github.com/YSQI-ai/opencode-agr-auth-for_v2.git ~/.config/opencode/plugins/antigravity
cd ~/.config/opencode/plugins/antigravity
```

**2. Install dependencies (Crucial!)**
```bash
# This triggers a postinstall script that fixes the 30s timeout bug.
npm install
```

**3. Restart the OpenCode background service**
```bash
opencode service restart
```

### Usage

**1. Log in:**
```bash
opencode auth login
```
Select `Google`, then choose **"OAuth with Google (Antigravity)"**. A browser window will pop up. Finish authorizing and returning to the CLI.

**2. Chat / Execute Models:**
```bash
opencode run "Hello, who are you?" --model=google/gemini-3.1-pro-preview
```

**3. Log out:**
```bash
opencode auth logout
```
*(This triggers V2's disconnect hook, clearing both OpenCode V2 credentials and the V1 cached account pool natively).*

### Diagnostics
A diagnostic log is automatically generated at `~/.config/opencode/plugins/antigravity/debug.log`. Use this to troubleshoot if you encounter issues:
```bash
tail -f ~/.config/opencode/plugins/antigravity/debug.log
```

---
<a name="chinese"></a>
## 中文

这是 `opencode-antigravity-auth` 的 **OpenCode V2 移植适配版**。

原版基于 OpenCode V1 插件 API 编写，无法在 OpenCode V2（及以上版本）中运行。此项目通过编写 V2 适配层（无缝拦截并重写本地网络请求），100% 保留了原插件的所有核心逻辑（包含 Token 刷新、双端点路由、账号轮换等），使你可以在 OpenCode V2 中正常使用。

> ⚠️ **警告 (免责声明)**：使用 Antigravity OAuth **违反 Google 服务条款**。原插件仓库已有大量用户报告因此导致 Google 账号被封禁或被影子封禁（Shadowban）。**使用本插件造成的任何风险由使用者自行承担！**

### 功能特性
- ✅ **兼容 OpenCode V2**：完美适配 V2 `export default { id, setup }` API 和 `ctx.session.hook` 等。
- ✅ **自动修复原版 Timeout Bug**：原生 npm 安装过程将自动打补丁，把极易失败的 30 秒授权超时上限提升至 120 秒。
- ✅ **全链路 HTTP 拦截**：本地自建代理流式转发，完美伪装并剥离不兼容的 Headers (如 `x-goog-api-key`)。
- ✅ **本地账号池**：继承原版的多账号轮转和自动刷新逻辑。
- ✅ **登出同步清理**：执行 V2 登出时，完美同步销毁 V1 本地缓存的账号池，防止“幽灵登录”。

### 安装指南

**1. 克隆本仓库到 OpenCode 插件目录**
```bash
git clone https://github.com/YSQI-ai/opencode-agr-auth-for_v2.git ~/.config/opencode/plugins/antigravity
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

### 使用方法

**1. 登录账号**
```bash
opencode auth login
```
在列表中选择 `Google`，然后选择 **"OAuth with Google (Antigravity)"**。浏览器会自动弹出 Google 授权页面。完成授权后，回到控制台即可看到认证成功的提示。

**2. 测试调用模型**
```bash
opencode run "Hello, who are you?" --model=google/gemini-3.1-pro-preview
```

**3. 登出清理**
```bash
opencode auth logout
```
*(执行此操作将彻底删除 V2 凭据，并同步清空 V1 残留的账号池缓存文件)。*

### 故障排查 (Diagnostics)
插件内置了调试日志，自动生成在根目录的 `debug.log` 中。
```bash
tail -f ~/.config/opencode/plugins/antigravity/debug.log
```

## 协议 / License
适配层代码采用 **MIT License**。本项目依赖的 `opencode-antigravity-auth` 及其下游依赖亦为 MIT 或 ISC 等宽松开源协议。
