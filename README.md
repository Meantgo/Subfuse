# SubFuse

**多机场订阅聚合与全机进程自适应路由客户端**

Next-Gen Multi-Airport Subscription Aggregator & Intelligent Process-Adaptive Proxy Switcher

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Meantgo/Subfuse?color=brightgreen)](https://github.com/Meantgo/Subfuse/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-gray.svg)](#预编译安装包下载)
[![Test](https://img.shields.io/badge/tests-24%2F24%20passing-brightgreen.svg)](#本地构建与开发)

</div>

---

## 概述与设计理念

SubFuse 是一款面向多机场订阅管理与本地进程级路由的桌面代理工具。针对传统客户端配置繁琐、多订阅源合并单点失效以及 AI 敏感服务因频繁换 IP 导致风控封号等痛点设计：

- **进程级自适应分流**：启动时自动识别本机运行的进程与应用。系统底层服务及国内常用软件（微信、网银等）走直连规避，常用浏览器与开发工具自动匹配代理策略。
- **AI 专线锁定防封号**：支持为 Claude、ChatGPT、Cursor 等易受 IP 漂移影响的服务指定固定落地节点，隔离后台测速与切换逻辑，降低账号风控隐患。
- **多订阅源聚合与容灾**：支持多个订阅链接同时输入与解析。具备故障隔离与 403 容错能力，单一节点或订阅异常时自动跳过，保障节点池正常合并与秒级自愈。
- **双运行模式**：
  - **自动规则（推荐）**：全机进程自适应路由 + AI 专线锁定 + 故障自愈。
  - **全局手动代理**：整机全部流量锁定指定单一节点，稳定不切换。

---

## 操作流程

1. **输入订阅**：在输入框填入一个或多个机场链接（支持中英文逗号或换行分隔），点击 **「合并配置」**。
   > 若机场节点为动态更新，建议填入服务商最新的订阅链接。
2. **模式与策略配置**：
   - 模式选择 **「自动规则」**，可根据需要为 AI 工具锁定特定节点，或微调自定义进程。
   - 亦可选择 **「全局手动代理」**，指定单一固定出口。
3. **启动代理**：点击 **「启动代理」** 接入系统网络接管（默认本地端口 7890）。

---
<img width="884" height="794" alt="截屏2026-08-27 15 18 05" src="https://github.com/user-attachments/assets/20745b68-e3fc-41c1-a4a3-5173ac63b214" />
<div align="center">

<img src="assets/icon-128.png" width="96" height="96" alt="SubFuse Logo" />

## 预编译安装包下载

各平台安装包已同步发布至 [GitHub Releases](https://github.com/Meantgo/Subfuse/releases/latest)：

| 平台 | 格式 | 下载链接 |
| :--- | :--- | :--- |
| **macOS (Apple Silicon)** | DMG 镜像 | [SubFuse-1.0.0-arm64.dmg](https://github.com/Meantgo/Subfuse/releases/download/v1.0.0/SubFuse-1.0.0-arm64.dmg) |
| **macOS (Apple Silicon)** | ZIP 便携包 | [SubFuse-1.0.0-mac.zip](https://github.com/Meantgo/Subfuse/releases/download/v1.0.0/SubFuse-1.0.0-mac.zip) |
| **Windows (x64)** | ZIP 免安装包 | [SubFuse-1.0.0-win-x64.zip](https://github.com/Meantgo/Subfuse/releases/download/v1.0.0/SubFuse-1.0.0-win-x64.zip) |

---

## 本地构建与开发

```bash
# 1. 克隆工程并安装依赖
cd subfuse
pnpm install

# 2. 执行自动化测试 (24 项核心测试)
pnpm test

# 3. 启动开发模式
pnpm start

# 4. 构建发布产物 (包含全平台代码混淆与防护打包)
pnpm run build:prod
```

> **构建提示**：国内网络下 electron-builder 从 GitHub 下载 Electron 二进制
> 可能被限流（429），构建前先设置镜像：
> ```bash
> export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> ```
> 依赖已在 `pnpm-workspace.yaml` 固定 `@electron/get@3.1.0`（3.0.0 发布版
> 缺失 electron-builder 需要的导出，会导致构建崩溃）。

---

## 开源协议

本项目遵循 [MIT License](LICENSE) 开源协议。
