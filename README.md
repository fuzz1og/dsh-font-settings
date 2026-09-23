# dsh-font-settings

DeepSeek Harness Web UI 插件：在「设置 → 通用」提供 **UI 字体**、**代码/等宽字体**与
**侧边栏终端字号**。选中的值是一个 CSS font-family 栈，不是枚举 id。

## 安装（远程）

插件以 **GitHub 仓库为分发源**（未发布到 npm），三种安装方式：

### 1. 跟随默认分支（推荐）

```bash
dsh plugin --profile web add github:fuzz1og/dsh-font-settings
```

### 2. 固定到版本 tag / commit（可复现）

```bash
dsh plugin --profile web add github:fuzz1og/dsh-font-settings#v0.6.0
# 或
dsh plugin --profile web add github:fuzz1og/dsh-font-settings#<commit-sha>
```

### 3. 从 DSH STORE 市场安装

本插件对 DSH STORE 的固定源码扫描为**零权限信号**，上架后会自动归入 `source-verified`。
之后在 GUI 的 Plugins / Store 里搜索 `dsh-font-settings` 即可一键安装。

### 安装后

```bash
# 确认挂载（应出现唯一一条 - id: font-settings）
dsh --profile web --dump-config | grep -A2 font-settings

# 卸载
dsh plugin --profile web remove dsh-font-settings
```

- 本包声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把它加入 profile 的
  `dsh.profile.bundles`，无需手改 patch 文件。**重启 DSH 并刷新 GUI 后生效。**
- 远程 / LAN 打开 GUI：偏好是 **per-device** 的（非 loopback 走浏览器本地存储）；
  Tier 2「读取本机字体」需要安全上下文（HTTPS 或 localhost），纯 HTTP 的 LAN 访问下按钮会置灰。
- 兼容性：dsh `>=0.1.7-alpha.1 <0.2.0`；`0.1.7-alpha.1` / `0.1.7-alpha.2` 实测兼容，
  `0.1.6-alpha.2` 及更早不兼容（无 `configForms` 服务）。见「兼容性与已知限制」。

## 使用

**主路径 · 自由文本（所有浏览器，零权限）**
输入框直接写 CSS 栈（如 `'Fira Code', monospace`），回车应用；清空回车恢复默认。
这条路永远可用，也是唯一一条不依赖任何浏览器能力/权限的路。

**Tier 1 · 常用候选**
面板内置一份常用家族（界面 / 等宽各一份），点击即用。非 Chromium 浏览器也有东西可点。

**Tier 2 · 读取本机字体（可选增强，Chromium 桌面版）**

- 点「读取本机字体」→ 在点击手势里调用 `window.queryLocalFonts()`；
- 结果按 family 归并后缓存进 localStorage，下次打开面板直接可见；
- Firefox / Safari / Chrome Android、或非安全上下文（非 HTTPS/localhost）：按钮置灰并说明原因；
- 拒绝授权：提示可在站点设置重新授权后重试；
- 读到的 `postscriptName` / `fullName` 同时用于终端 `local()` 别名（见下）。

## 设计取舍

参考 opencode 的主路径（自由文本 CSS 栈，无服务端枚举）与 mcut 的分层增强：

| 层 | 来源 | 可用性 |
| --- | --- | --- |
| 主路径 | 任意 CSS font-family 栈 | 全部浏览器，零权限 |
| Tier 1 | 内置常用候选 | 全部浏览器，零权限 |
| Tier 2 | `queryLocalFonts()` 本机枚举 | Chromium 桌面版，权限 + 手势 |

**宿主扫描已删除**。浏览器本来就无法枚举字体，而宿主能枚举的只是「运行 dsh 的那台机器」——
用远程 / LAN GUI 打开时会读到错误的机器。同时，宿主侧的 `node:fs` / `process.env` /
`fetch(` 会触发 DSH STORE 的 files / credentials / network 权限信号，使插件无法自动上架。
唯一实质损失是「非 Chromium 没有下拉枚举」，这也是所有主流项目共同接受的现状。

## 持久化

- **loopback**：走官方 `ctx.configForms.get("font-settings")`，写本条目自己的
  volatile `Config`（5 个字段；条目 id `font-settings` 即命名空间）。
- **非 loopback**：宿主机文档属于另一台机器，偏好改为 per-device `localStorage`；
  远端页面不再写宿主机文档。
- 自定义 HTTP 路由（`/font-settings`）与宿主字体扫描路由已删除。

## 终端字体与字号

侧边栏终端用一行写死的字体栈构造 xterm，不引用任何 dsh 字体 token，因此只能用
`@font-face` 别名改写 `ui-monospace` / `SFMono-Regular` / `Menlo` / `Consolas`
（`monospace` 通用族无法遮蔽）：

```css
@font-face{font-family:ui-monospace;src:local('Maple Mono NF CN Regular'),local('MapleMono-NF-CN-Regular');font-weight:400;font-style:normal}
```

`local()` 只匹配 **FullName / PostScript 名**，传家族名会静默失败。这两个字段现在来自
`queryLocalFonts()` 的 `fullName` / `postscriptName`，不再解析字体文件的 sfnt name 表。
没有 face 时（手输自定义栈、或未读取本机字体）只遮蔽 `ui-monospace` 并用家族名兜底。

**终端字号**通过给同一批别名加 `size-adjust` 生效：终端的 `fontSize: 13` 是写死的字面量，
只能按比例缩放。基准优先取活动终端真实渲染的字号，读不到时退回 13px 并只警告一次。
直接盖 CSS `font-size` 会让 xterm 的单元格测量与行渲染脱钩（实测每格漂移 ≈3.8px），故不采用。
选择器与回退基准是内部 DOM 依赖，DSH / xterm 升级后需要复核。

## 兼容性与已知限制

| 维度 | 声明 |
| --- | --- |
| DSH | `>=0.1.7-alpha.1 <0.2.0`（逐版本见 `dsh.compatibility.dshReleases`） |
| Node.js | `>=18.17.0` |
| Profile / 平台 | `dsh.client.platform = web`，`dsh.compatibility.profiles = ["web"]` |
| 本机枚举 | Chromium 桌面版 103+；Firefox / Safari / Chrome Android 无 |

逐版本实测（每个版本都在隔离安装 + 一次性 DSH_HOME 内跑通设置行 / LFA / 持久化）：

| DSH 版本 | 状态 | 证据 |
| --- | --- | --- |
| `0.1.7-alpha.2` | ✅ `compatible` | 真实 GUI E2E：设置行渲染、Tier 1、`queryLocalFonts()` 读到 148 个族、别名用 `postscriptName`、`configForms` 写回 profile patch、字号 `size-adjust`、清空恢复默认；0 console error |
| `0.1.7-alpha.1` | ✅ `compatible` | 隔离安装 `@deepseek-ai/dsh@0.1.7-alpha.1` + 一次性 DSH_HOME，同样 E2E 全部通过；宿主 `settings.configure` 与客户端 `configForms` 均存在 |
| `0.1.6-alpha.2` 及更早 | ❌ `incompatible` | 客户端无 `configForms` 服务（`inject` 不满足、设置行不挂载），宿主无 `settings.configure` |

DSH STORE 的兼容性策略只看官方最新 3 个 release；当前窗口为 `0.1.7-alpha.2` / `0.1.7-alpha.1` / `0.1.6-alpha.2`，
矩阵中已有 2 个 `compatible`，满足 `requiredCompatibleReleases: 1`。

- 非 Chromium 没有下拉枚举，请用主路径或 Tier 1。
- 本机枚举需要安全上下文：纯 HTTP 的 LAN 访问下 API 不存在（按「不支持」置灰）。
- `local()` 别名依赖浏览器能匹配到该字体；Chrome「Limiting Access to Local Fonts」提案会进一步
  限制 `local()`，届时别名可能失效，主路径不受影响。
- 家族名被全局改写，所以面板里那几行「以自身字体预览」的示例文字也会跟着变，属外观副作用。

## 上架声明

- **依赖**：无运行期 `dependencies` / `optionalDependencies` / bundled 依赖，无生命周期脚本。
  peer 只声明宿主已提供的 `react`、`@deepseek-ai/dsh-settings`（optional）、
  `@deepseek-ai/schemastery`（optional）。
- **权限**：文件 / 网络 / 命令 / 凭据 **全无**。插件不读写任何文件（偏好落盘由宿主 settings 服务完成），
  不发起任何请求，不读 `process.env`，不 spawn 进程。
- **外部服务**：无。不访问 CDN、字体 API、Webhook 或遥测。
- **失败边界**：`schemastery` 解析失败 → `Config` 导出 `undefined`、只警告一次、
  偏好退回 per-device 存储，**DSH 启动不受影响**；`queryLocalFonts()` 不支持或拒绝 →
  按钮置灰并说明原因，主路径不受影响。

因此运行期源文件（`package.json`、`cordis.patch.yml`、`lib/*.js`）对 DSH STORE
固定源码策略的扫描结果为**零权限信号**，符合 `source-verified` 自动上架条件；
`test/permission-signals.test.mjs` 复刻官方正则把这条契约锁住。

## 验收

```bash
npm test                          # 全部回归（零信号 / 宿主形状 / 持久化 / LFA）
npm run verify:disposable-profile # 一次性 DSH_HOME：安装 → dump-config → 卸载
```

本地联调（独立 profile，不碰真实 `web`）：

```bash
dsh fontdev --from-default-profile web --dump-config   # 首次创建 profile（只合成配置，不启动）
dsh plugin --profile fontdev add "$PWD"                 # 安装本地 checkout
dsh fontdev --no-open --port 3081                       # 启动
```

## License

MIT
