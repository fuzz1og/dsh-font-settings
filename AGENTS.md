# AGENTS.md — dsh-font-settings

DSH Web UI 插件：在「设置 → 通用」提供 UI 字体、代码/等宽字体与侧边栏终端字号。

**架构一句话**：opencode 式主路径（存 CSS font stack 的自由文本 combo）+ mcut 式可选增强层
（Tier 1 内置常用候选、Tier 2 手势触发的 `queryLocalFonts()`），宿主只声明 `Config`。

## 硬约束（改任何东西前先读）

1. **零权限信号**。DSH STORE 的自动上架策略对每个运行期源文件做纯文本正则扫描
   （含注释），命中 files / network / commands / credentials / protectedDsh 任一项即 `blocked`。
   运行期源文件 = `package.json`、`cordis.patch.yml`、`lib/*.js`（`test/`、`docs/` 被排除）。
   - 禁止：`node:fs`、`readFile(`/`writeFile(`/…、`$DSH_HOME`、`.dsh/profiles`、
     `fetch(`/`WebSocket(`、`process.env`、`child_process`、`exec(`/`spawn(`、`apiKey`/`password` 等字面量。
   - 验证：`npm test`（`test/permission-signals.test.mjs` 复刻了官方正则）。
     权威交叉验证（需要本地 DSH-Store clone）：对上述四个文件跑
     `permissionSignals()`（来自 `src/automation-source-policy.mjs`），必须全 false。
2. **宿主不可失败求值**。`lib/index.js` 不得有非 `node:` 的静态 import；
   `@deepseek-ai/schemastery` 走受保护 `require`，失败时 `Config` 为 `undefined` 且只警告一次。
   Loader 在模块求值时只读一次 `Config`，晚到即永久不可配置。
3. **combo 是主路径**。自由文本 + 回车应用 + 空值恢复默认，永远可用、零权限。
   下拉只是增强；非 Chromium 没有枚举是**可接受**的现状，不要为了枚举把宿主扫描加回来。
4. **`local()` 只认 `fullName` / `postscriptName`**，家族名会静默失败。
   终端别名必须用 `queryLocalFonts()` 返回的这两个字段生成，不要再解析 sfnt。
5. **偏好按设备**：loopback 走 `ctx.configForms.get("font-settings")`；非 loopback 走
   `localStorage`（远端页面不该写宿主机文档）。不要新增自定义 HTTP 路由。

## 命令

```bash
npm test                          # 全部回归（含零信号、宿主形状、客户端持久化/LFA）
npm run verify:disposable-profile # 一次性 DSH_HOME 安装 → dump-config → 卸载
```

本地联调（不碰真实 `web` profile）：

```bash
dsh fontdev --from-default-profile web --dump-config   # 首次创建 profile（只合成配置，不启动）
dsh plugin --profile fontdev add "$PWD"                 # 安装本地 checkout
dsh fontdev --no-open --port 3081                       # 启动
```

## 文件地图

| 路径 | 内容 |
| --- | --- |
| `lib/index.js` | 宿主：`name` / `inject=[]` / 5 个 volatile `Config` 字段 / `settings.configure({auto:false})`。没有路由、没有扫描 |
| `lib/client.js` | 浏览器半区：combo、picker 面板、Tier 1 候选、LFA 读取与缓存、`configForms`/localStorage 持久化、主题覆盖 + 终端 `@font-face` 别名 |
| `cordis.patch.yml` | bundle patch：插入唯一 `font-settings` 条目 |
| `test/client-harness.mjs` | 客户端 VM 测试基座（react/store/configForms/DOM/localStorage 桩） |
| `test/permission-signals.test.mjs` | 零信号回归 |
| `test/host-boot.test.mjs` | 宿主形状 + 求值不可失败 |
| `test/client-persistence.test.mjs` | loopback / 非 loopback 两条持久化路径 |
| `test/client-local-fonts.test.mjs` | LFA 归并、缓存、别名来源 |

## 关键 DSH API 事实

- 命名空间 = profile 条目 id = `font-settings`。客户端 `ctx.configForms.get("font-settings")`
  得到 `ConfigForm`：`getSnapshot()` → `{status, value, revision, writable, mode}`；
  `subscribe(fn)`；`mutate(ops)`（ops 为 `{op:"set",path:[field],value}`）。
  `mode === "host"` 仅当 `ctx.remote.$host.isLoopback`；否则是 `"memory"`（写不落盘）。
- `queryLocalFonts()`：Chromium 桌面版 103+；Firefox/Safari/Chrome Android 无；
  需要安全上下文 + 瞬时用户激活 + `local-fonts` 权限（可拒绝）。
  **必须在点击处理器里同步调用**，之前不能 await。返回 `FontData{family, fullName, postscriptName, style, blob()}`。
- 终端字体栈写死在 `dsh-client-ui-sidebar-terminal`，只能用 `@font-face` 别名 +
  `size-adjust` 覆盖；`monospace` 通用族无法遮蔽。
- **兼容边界 `0.1.7-alpha.1`**：`configForms`（客户端）与 `settings.configure`（宿主）
  都是 0.1.7-alpha.1 才有的；`0.1.6-alpha.2` 及更早不兼容。改动依赖这两个 API 的代码后，
  用隔离安装的旧版复跑 E2E（`npm i @deepseek-ai/dsh@0.1.7-alpha.1` + 一次性 DSH_HOME）。

## 提交约定

- 本地提交，不主动 push（远程发布由使用者决定）。
- 改运行期源文件后必须重跑 `npm test` 与 `npm run verify:disposable-profile`。
