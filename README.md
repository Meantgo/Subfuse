<div align="center">

<img src="assets/icon-128.png" width="96" height="96" alt="SubFuse Logo" />

# SubFuse

**全机进程自适应路由 · 多机场容灾自动切换桌面端**

Next-Gen Multi-Airport Subscription Aggregator & Intelligent Process-Adaptive Proxy Switcher

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-gray.svg)](#预编译安装包下载)
[![Test](https://img.shields.io/badge/tests-24%2F24%20passing-brightgreen.svg)](#开发者编译与运行)

</div>

---

## 为什么选择 SubFuse？

- **全机进程自适应**：自动扫描电脑正在运行的真实应用。浏览器与开发工具走代理优选，系统服务与国内应用（微信、网银等）自动直连规避，免去复杂规则手写。
- **AI 专线锁定防封**：为 Claude、ChatGPT、Cursor 等敏感 AI 进程锁定固定节点，杜绝频繁漂移 IP 触发风控封号。
- **多机场自动容灾**：支持粘贴多个订阅链接（支持逗号或换行），某机场出现 403 或故障时自动跳过容错，毫秒级自愈切换备用节点。
- **极简双模设计**：
  - **自动规则（推荐）**：全机进程自适应分流 + AI 专线锁定 + 故障自愈。
  - **全局手动代理**：整机全部流量锁定指定单一节点，稳定不换。

---

## 快速上手

1. **粘贴订阅**：在输入框填入一个或多个机场链接，点击 **「合并配置」**。
   > **提示**：若机场节点为动态更新，请确保使用最新的订阅链接。
2. **选择模式**：
   - 勾选 **「自动规则」**，根据需要指定 AI 锁定节点，或自定义进程策略。
   - 或勾选 **「全局手动代理」**，选择指定节点。
3. **启动代理**：点击 **「启动代理」**，SubFuse 即刻自动接管系统代理（端口 7890）。

---

## 预编译安装包下载

Release 安装包位于 `outputs/` 目录中：

| 平台 | 格式 | 文件路径 |
| :--- | :--- | :--- |
| **macOS (Apple Silicon)** | DMG 镜像 | `outputs/SubFuse-1.0.0-arm64.dmg` |
| **macOS (Apple Silicon)** | ZIP 便携包 | `outputs/SubFuse-1.0.0-mac.zip` |
| **Windows (x64)** | ZIP 免安装包 | `outputs/SubFuse-1.0.0-win-x64.zip` |

---

## 本地开发与构建

```bash
# 1. 克隆与安装依赖
cd subfuse
pnpm install

# 2. 运行自动化测试 (24/24 项单元测试)
pnpm test

# 3. 启动桌面端调试
pnpm start

# 4. 构建全平台发布包 (macOS & Windows)
pnpm build:all
```

---

## 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。
