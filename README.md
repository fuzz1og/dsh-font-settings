# dsh-font-settings

DeepSeek Harness Web UI 插件：**字体偏好设置**——在「设置 → 通用」中提供 UI 字体、代码/等宽字体（系统字体枚举 + 自定义 CSS font-family）与**侧边栏终端字号**，通过主题覆盖层与 `@font-face` 别名实时生效。

## 安装

```bash
dsh plugin --profile web add github:fuzz1og/dsh-font-settings
```

该包声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把它加入 profile 的
`dsh.profile.bundles`，无需手改任何 patch 文件。

**重启 DSH 后生效。**

> 兼容性：适配 dsh **`>=0.1.7-alpha.1 <0.2.0`**，逐版本声明见
> `package.json` 的 `dsh.compatibility.dshReleases`（`0.1.7-alpha.1` 与
> `0.1.7-alpha.2` = `compatible`）；Node.js 要求 **`>=18.17.0`**。客户端 store 从
> `@deepseek-ai/dsh-client-store` 取（`@deepseek-ai/dsh-client-runtime` 已移除）；
> **宿主侧不再使用 `settings.register` / `settings.get(ns)`——这两个 API 在
> 0.1.7-alpha.1 已从 `@deepseek-ai/dsh-settings` 移除。** 字体偏好改住本插件
> 自己的 volatile `Config`，经 `settings.describe()` 读、`settings.mutate()` 写，
> 详见下文「0.5.0 适配说明」。权限、依赖、外部服务与失败边界见
> 「[上架声明](#上架声明依赖权限外部服务与失败边界052)」。

> 旧版（无 `dsh.bundle.patch`）需要手动在 `cordis.patch.yml` 插入挂载行：
> ```yaml
> - insert:
>     - id: font-settings
>       name: 'dsh-font-settings'
> ```
> 新安装无需此步骤。

## 0.5.2：DSH STORE 固定源码契约修复

对应 DSH STORE 自动检查（issue「作者修复请求：fuzz1og/dsh-font-settings」）的确定性原因，
本版本只改 manifest/文档/验收工具，不改运行时行为：

- 补 `repository`/`homepage`/`bugs`，指向 canonical GitHub 仓库
  `https://github.com/fuzz1og/dsh-font-settings`；
- 补 `engines.node`（`>=18.17.0`）与 `dsh.compatibility`（DSH 范围 + 逐版本
  `dshReleases`），与 `engines.dsh` 一致；
- 0.4.3 起已移除运行期 `dependencies`（`schemastery` 转为 optional peer），
  本版本确认 `dependencies`/`optionalDependencies`/生命周期脚本均为空；
- README 增加「上架声明：权限、依赖、外部服务与失败边界」；
- 新增一次性 Profile 安装/启动/卸载验收脚本与固定源码契约回归测试。

剩余 files / network / credentials 信号是插件真实且必要的能力，按 DSH STORE 策略应保持
`user-reviewed`（逐次本机风险审查），不适用 `source-verified` 自动批准。

## 0.5.0 适配说明（dsh 0.1.7-alpha.1）

dsh `0.1.7-alpha.1` 把设置模型改成 **Config 派生**：一个设置命名空间不再是一份
可以自行注册的文档，而是 **profile 条目自身的 `Config`**。`SettingsForms` 上已不
存在 `register()` 与 `get(ns)`：

| API | ≤ 0.1.6-alpha.2 | 0.1.7-alpha.1 |
| --- | --- | --- |
| `settings.register(ns, schema)` | 有 | **已移除** |
| `settings.get(ns)` | 有 | **已移除** |
| `settings.describe()` | 有 | 有（改为按条目投影 `Config`） |
| `settings.mutate(ns, ops, rev)` | 有 | 有 |

因此字体偏好从「自注册命名空间 `ui-font`」迁到 **本条目自己的 `Config`**
（条目 id `font-settings` 即命名空间键）：

- **读**：`settings.describe()` 取出 `ns === 本条目 id` 的那一行，同时拿到
  `value` 与 `revision`；
- **写**：`settings.mutate(ns, ops, revision)`，用同一次读到的 revision 做栅栏。

5 个字段全是 `.volatile()`：只有 volatile 字段能在不重启条目的情况下被 Loader
直接提交进运行中的 `Config` 引用（`_commitVolatile`），而 `mutate` 也只接受
volatile 路径。

**持久化位置变了**：偏好不再写入 `$DSH_HOME/settings.yaml`，而是写入 profile 的
Cordis patch（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）。0.1.7 本身也把
`settings.yaml` 退役了——启动时重命名为 `settings.yaml.imported` 并把各节并入
profile 条目。

**迁移旧值**：旧 `settings.yaml` 里的 `ui-font:` 一节会在启动时被并入 profile
条目；若该节未被接受，它只留在 `settings.yaml.imported` 中，在 GUI 里重选一次即可。

- 针对 DSH `0.1.7-alpha.1` 核对，源码回归运行 `npm test`。
- `@deepseek-ai/schemastery` 现在通过 **受保护的同步 `require`** 解析（先本包、
  再运行中的 harness 安装），而不是 0.4.3 的「首次使用时动态 import」：Loader 在
  **模块求值时**只读一次 `Config`（`dsh-app-boot` 的 `configOf`），晚到的 schema 会
  让条目永远不可配置——而偏好现在就住在 `Config` 里。解析失败时 `Config` 导出为
  `undefined`，路由答 503，harness 照常启动（「启动不可失败」的保证保留）。
- 可选 peer 收紧为 `@deepseek-ai/dsh-settings: ^0.1.7-alpha.1`。
- 本地源码测试通过不等于 profile 已安装或浏览器已加载，安装后重启 DSH 并刷新 GUI。

## 依赖缺失不再拖垮 DSH 启动（0.4.3+）

**症状**：重启后 DSH 起不来，报

```
failed to import loader entry font-settings (dsh-font-settings):
Cannot find package '@deepseek-ai/schemastery' imported from /home/tomy/daily/dsh-font-settings/lib/index.js
```

**原因**：profile 把这个包装成了 `link:`（或任何指向本地路径的 specifier），加载器于是
从**工作区 checkout** 导入它。而 `link:` **不会安装被链接包自己的依赖** —— 工作区里
没有可解析的 `@deepseek-ai/schemastery`，静态 `import` 在模块求值阶段就抛错，而加载器
对挂载失败的处理是**中止整个 profile**，于是一个插件的缺失依赖把整个 harness 拖死。

**修法**（两层）：

1. 安装方式：必须用已发布的 specifier，不能用 `link:` 或本地路径。

   ```bash
   dsh plugin --profile web add github:fuzz1og/dsh-font-settings
   ```

2. 插件侧：`@deepseek-ai/schemastery` 经**受保护的同步 `require`** 解析（先本包、
   再运行中的 harness 安装），模块里没有静态 import。于是本模块的求值永不失败：
   解析不到时 `Config` 导出为 `undefined`、条目没有可配置字段、`/font-settings` 返回
   503、并**只警告一次**说明原因——插件变为惰性，harness 照常启动。

   > 0.4.3 用的是「首次使用时动态 `import`」。0.5.0 改回求值期解析，因为 0.1.7 的
   > Loader 在**模块求值时**只读一次 `Config`（`dsh-app-boot` 的 `configOf`），而偏好
   > 现在就住在 `Config` 里——晚到的 schema 会让条目永远不可配置。第二个解析基址
   > （`process.argv[1]`，即 dsh 自身的入口）正是让 `link:`/工作区安装也能解析成功
   > 的关键：那条路径的 `node_modules` 看不到 harness 的依赖。

   `test/host-boot.test.mjs` 锁住这些不变量：宿主模块中不允许出现任何非 `node:` 的
   静态 import，且不得再调用已被移除的 `settings.register` / `settings.get`。

隔离目录模拟依赖不可解析的验证结果：

| 场景 | 模块加载 | 注册 settings | 警告 |
| --- | --- | --- | --- |
| 依赖缺失 | 不抛异常 | 否 | 1 条，含根因 |
| 依赖正常 | 不抛异常 | 是 | 0 |

> 排查同类问题：`ls -ld $DSH_HOME/profiles/<profile>/node_modules/<pkg>` —— 如果是指向
> 工作区的 symlink，就是 `link:` 安装，改用发布的 specifier 重装。

## 工作原理

| 环节 | 说明 |
| --- | --- |
| 宿主半区 | 拥有本条目自己的 volatile `Config`（条目 id `font-settings` 即设置命名空间键；持久化进 profile 的 `cordis.patch.yml`），提供三条同源路由：`GET/POST /font-settings` 经 `settings.describe()` / `settings.mutate()` 读写偏好、`GET /font-settings/fonts` 枚举已安装系统字体 |
| 系统字体枚举 | 浏览器无法列出已安装字体，且系统显示名与 CSS 家族名常不一致——宿主扫描各平台字体目录，解析每个字体文件的 sfnt name 表（nameID 16/1 取家族名，nameID 4/6 取 `local()` 可用的 FullName/PostScript 名，并从 `OS/2`/`head` 取字重与斜体），再按**角色**为每个家族挑出终端真正会请求的 regular/bold 字面（见「字重」一节）；TTC 集合读取第一个 face；并行扫描 + 10 分钟缓存（过期请求等待新扫描，启动预热与并发请求共用扫描；失败不延长缓存寿命）。平台目录见下节 |
| 客户端半区 | 通过主题服务的 `overrideTokens()` 叠加两个根 CSS 变量（`--dsw-font-family` / `--ds-font-family-code`），所有 `--dsw-font-*` 排版 token 都引用它们；此外另注入一张 `@font-face` 别名表覆盖侧边栏终端的字体与字号（见下节） |
| 依赖 | `webServer` + `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery` |

### 字体列表缓存与刷新

- 页面每 10 分钟重新请求列表，窗口重新获得焦点时检查过期；后台标签页的定时器可能被浏览器延迟。
- 「重新扫描字体」绕过客户端与 Host 列表缓存（`GET /font-settings/fonts?refresh=1`），并清空浏览器字体匹配探测缓存。字体安装、删除后可立即使用。
- 探测结果也有 10 分钟 TTL；成功获取新列表后重新探测，而非永久保留“字体可用”的结论。
- 扫描失败时按钮显示失败提示，页面暂保留上次列表以供参考，不冒充刷新成功；可以重试。
- 这不能清除操作系统或浏览器进程内部的字体缓存；某些字体变更仍需重启浏览器。刷新列表不会更改已保存的字体选择。

## 终端字体覆盖（0.3.0+）

侧边栏终端（`dsh-client-ui-sidebar-terminal`）用一行写死的字体栈构造 xterm：
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`。它**不引用任何 dsh 字体
token**，所以主题覆盖层对它完全无效——这就是「设置了等宽字体但终端没变」的原因。

该栈里 `ui-monospace` 在 Windows / Linux 的 Chromium 上都解析不到任何字体，于是
实际生效的永远是 `Consolas`（在没装 Consolas 的机器上则是 `monospace` 通用族）。

修法是注入 `@font-face` 改写这个栈里的具体家族名（`ui-monospace`、`SFMono-Regular`、
`Menlo`、`Consolas`），把它们指向所选字体的各个字面：

```css
@font-face{font-family:ui-monospace;src:local('Maple Mono NF CN Regular'),local('MapleMono-NF-CN-Regular');font-weight:400;font-style:normal}
/* … 同法为其余三个家族名生成 regular/bold/italic 各一条 … */
```

通用关键字 `monospace` **无法**被 `@font-face` 遮蔽（内核按浏览器自身的等宽字体偏好
解析，实测宽度不动），所以不列出它。

### `local()` 只认 FullName / PostScript，写家族名会静默失败

`local()` 匹配的是 **FullName（nameID 4）** 和 **PostScript 名（nameID 6）**，
不是家族名（nameID 1），也不是排版家族名（nameID 16）。传家族名不会报任何错，只是
永远匹配不上，终端于是悄无声息地回退到栈里的下一个家族。以 JetBrainsMono Nerd Font
为例：

| `local()` 实参 | 来源 | 结果 |
| --- | --- | --- |
| `JetBrainsMono Nerd Font` | nameID 16 | ✗ 失败 |
| `JetBrainsMono NF` | nameID 1 | ✗ 失败 |
| `JetBrainsMono NF Regular` | nameID 4 | ✓ |
| `JetBrainsMonoNF-Regular` | nameID 6 | ✓ |

因此宿主侧会解析每个字体文件的 `name` 表，把每个 face 的 FullName 与 PostScript 名
一起下发给客户端，用它们生成 `local()`，并按 `OS/2`/`head` 表补上 `font-weight` /
`font-style` 描述符。没有枚举到 face 时（手输自定义栈、或枚举路由不可用）只遮蔽
`ui-monospace` 并退回家族名：在 Windows / Linux 上它本来也解析不到，失败不损失任何
回退；而拿 `Consolas` 去赌就可能损失，所以不做。

### 字重：按角色挑 face，不能按字重排序截断（0.4.1 修复）

一个家族可能带几十个字面。例如 **NotoSansM Nerd Font Mono 有 36 个文件**：9 个字重 ×
4 种宽度（正常 / Cond / ExtCond / SemCond），斜体 0 个。而终端只请求两种字重——
xterm 基础文字用 `fontWeight: normal`、粗体单元格用 `fontWeightBold: bold`——其余全是
无用负担。

0.4.0 及更早的实现把每个家族的字面**按字重升序排序后截断到 8 个**，这是错的：最轻的
那批变体自己就能占满全部名额，Regular 和 Bold 被整个挤掉，于是 400 请求匹配不到任何
face，只能取最近的 250，终端就"太细"了。NotoSansM NFM 正是如此——它 **8 个 weight=250
的字面（ExtraLight / Thin × 4 种宽度）刚好填满 8 个名额**，`NotoSansM NFM Reg` 和
`NotoSansM NFM Bold` 都没进列表。

现在改为**按角色挑选**：对「正常」和「斜体」两组，各自取**正常宽度**下最接近 400 和
最接近 700 的字面，并把它们**重新标记为它们要满足的字重**（而不是字体文件自称的字重）。
只有当 bold 与 regular 不是同一个字面时才输出 bold，否则单字面家族仍由浏览器合成粗体，
而不是拿 regular 冒充 bold。

用该字体真实文件做的墨迹像素对照（`MonoWeight` @48px，值越大越粗）：

| 单独声明为 400 的参考字重 | 墨迹 | | 终端请求 `weight:400` | 墨迹 | 实际命中 |
| --- | --- | --- | --- | --- | --- |
| Thin(100) | 1800 | | 旧 CSS（8×250） | 1754 | **≈ Thin(100)** ← 太细 |
| ExtraLight(200) | 2271 | | 新 CSS（400/700） | 3896 | **= Regular(400)** |
| Regular(400) | 3896 | | | | |
| Bold(700) | 5468 | | 粗体单元格：旧 3379 → 新 5468 | | **= Bold(700)** |

顺带的好处：每家族只留 ≤4 个 face，整个枚举 payload 从约 120KB 降到 **35KB**。

### 终端字号（0.4.0+）

设置行里多了一个绝对 px 的「终端字号」，可选 **默认 / 11 / 12 / 13 / 14 / 15 / 16 /
18 / 20 / 22 / 24**；选「默认」时不输出任何缩放，行为退回 0.3.0。

字号只能**缩放**，不能**赋值**：终端的 `fontSize: 13` 是写死字面量，而 `Terminal`
实例所在的闭包被内联打包、也不 provide 任何服务，所以拿不到实例去写
`term.options.fontSize`。能改的只有渲染结果。

实现方式是把 `size-adjust` 加到已有的 `@font-face` 别名上：

```css
@font-face{font-family:ui-monospace;src:local('Consolas');font-weight:400;font-style:normal;size-adjust:123.08%}
```

之所以成立，是因为 xterm 的**单元格测量**（CharSizeService，canvas）和**行渲染**
（DomRenderer 注入的 `font-size`）走的是同一次字体匹配，`size-adjust` 缩放的是字体
匹配的结果本身，于是两边同步缩放、栅格不错位。

反过来，**直接用 CSS 盖 `font-size` 是坏的**。实测对照（Maple Mono NF CN，13px 基准）：

| 方案 | xterm 认为的格宽 | 实际步进 | 漂移 |
| --- | --- | --- | --- |
| 别名 + `size-adjust:150%` | 12.0 | 12.0 | **0** |
| 纯 CSS `font-size:20px !important` | 7.1475 | 10.9902 | **−3.84 ✗** |

因为终端字号固定 13px，绝对 px 可以无损换算成比例：`size-adjust = 目标px ÷ 基准px`。
基准优先取**当前活动终端真实渲染的字号**（从 DomRenderer 的 `.xterm-rows` 上读回），
其次尝试 `.xterm-char-measure-element` 的测量字号，读不到有效正数时退回 13，并只警告一次。
不读 `.xterm` / `.xterm-screen`，它们可能继承页面字号而不是终端字号。
这仍是内部 DOM 依赖：每次 DSH / xterm 升级后应检查选择器和回退基准。
终端挂载前写入的缩放比例不会自动重算；若默认基准变化，需打开终端后重新选择字号。

兼容性：`size-adjust` 需要 Chrome/Edge 92+、Firefox 92+、Safari **17.0+**
（Baseline 2023-09）。Safari 16 及更早会**忽略该描述符**——别名照常生效、只是字号
不缩放，属于干净的优雅降级。

### 已知限制

- `ui-monospace` / `Consolas` 等家族名被全局改写，因此选字面板里那几行「以自身字体
  预览」的示例文字也会跟着变；属于外观副作用，不影响功能。字号缩放同样经这条
  `@font-face` 生效，所以影响面与换字体一致。
- 已经打开的终端会立刻重绘成新字体/新字号（CSS 实时重解析），但 xterm 的单元格宽度
  是在挂载和容器尺寸变化时测量的，所以**可能要等一次尺寸变化（拖动/折叠侧边栏、开新
  终端）才会完全对齐**。这是终端自身不监听字体变化的限制，插件改不到。
- 缩放比例是浮点的，但字体在该字号下可能按整数像素渲染步进，所以实际字号与所选值
  可能有零点几 px 的量化误差（栅格仍然对齐，漂移为 0）。
- 字号缩放依附在 `@font-face` 别名上。如果所选字体**在当前浏览器里匹配不到**（列表里
  会标「浏览器不可见」——典型情况是宿主从 Windows 字体目录枚举到了，但 WSLg / Linux
  浏览器看不到它），那么整个 face 失效，**字体和字号都不会生效**，终端退回栈里的下一个
  家族。判断依据要以浏览器真正能渲染的字体为准，而不是宿主枚举到的列表。

## 平台支持（0.2.0+）

| 平台 | 扫描目录 | 布局 |
| --- | --- | --- |
| Windows | `%WINDIR%\Fonts`、`%LOCALAPPDATA%\Microsoft\Windows\Fonts` | 平铺 |
| WSL | 原生 Linux 目录（下两行）**加上**通过 drvfs 可见的 Windows 目录 | — |
| macOS | `/System/Library/Fonts`、`/System/Library/Fonts/Supplemental`、`/Library/Fonts`、`~/Library/Fonts` | 递归（限深 6） |
| Linux | `/usr/share/fonts`、`/usr/local/share/fonts`、`$XDG_DATA_HOME/fonts`、`~/.fonts` | 递归（限深 6） |

WSL 细节：

- 挂载根取自 `/etc/wsl.conf` 的 `[automount] root`，缺省 `/mnt/`；每个盘符下的
  `Windows\Fonts`（机器字体）和 `Users\*\AppData\Local\Microsoft\Windows\Fonts`
  （用户字体）都会扫描。Windows 用户名与 WSL 用户名无关，用户目录靠枚举 `Users\*`，
  不靠 `$USER` 推断。
- Windows 字体与原生 Linux 字体**都会列出**并按家族名去重：Windows 浏览器打开 GUI
  时选 Windows 家族，WSLg 里的 Linux 浏览器选原生家族；当前浏览器渲染不了的家族
  会在列表里标「浏览器不可见」。
- 跨 9p 读文件较慢：扫描按 8 路并行，缓存 10 分钟，过期后先返回旧列表并后台重扫，
  插件启动时也会预热一次，正常情况下打开选字面板无感。

## 上架声明：依赖、权限、外部服务与失败边界（0.5.2+）

本节是写给 DSH STORE 自动化与人工复核的显式声明，用于避免把「源码里没搜到」当成
「不会访问」。对应 DSH STORE 固定 Commit 检查中的依赖、权限与运行文件项。

### 依赖

- **无运行期 `dependencies` / `optionalDependencies` / `bundledDependencies`**：
  `package.json` 不声明这三个字段，因此没有需要单独供应链复核的必装第三方包。
- `peerDependencies` 只声明**宿主已经提供**的模块，不打进本包、也不由本包安装：
  - `react@^18.2.0`：浏览器客户端基座；
  - `@deepseek-ai/dsh-settings@^0.1.7-alpha.1`（optional peer）：宿主设置服务；
  - `@deepseek-ai/schemastery@^3.18.3`（optional peer）：构建 volatile `Config` 的 schema 库。
- **无生命周期脚本**：不声明 `preinstall`/`install`/`postinstall`/`prepare`。
  `scripts.test`、`scripts.verify:disposable-profile` 只在本地或 CI 手动运行，不参与安装。
- 宿主模块**不使用静态 import 引入任何插件依赖**（缺失依赖不能拖垮 DSH 启动）。

### 权限

| 能力 | 使用情况 | 范围 |
| --- | --- | --- |
| 文件 | **只读** | 系统字体目录（见「平台支持」）与 WSL 的 `/etc/wsl.conf`（仅取 `[automount] root`）；只解析字体文件的 sfnt name 表。偏好值的落盘由宿主的 settings 服务写入 profile 的 Cordis patch，插件自身不写任何文件。 |
| 网络 | **仅同源** | 客户端只 `fetch` 宿主自身的 `/font-settings`、`/font-settings/fonts` 两条同源路由；宿主侧不发起任何出站请求。 |
| 命令 | **无** | 不 import `child_process`，不 `exec`/`spawn`/`fork`。 |
| 凭据 | **无** | 不读 keychain、OAuth、token、密码，不访问会话或用户凭据。仅读取 `%WINDIR%`、`%LOCALAPPDATA%`、`$XDG_DATA_HOME` 三个**路径类**环境变量来定位字体目录，不读取、不缓存、不外发任何凭据。 |

> DSH STORE 的固定源码策略会把 `node:fs`、`fetch(`、`process.env` 一律计为
> files / network / credentials 信号。本插件这三项能力真实且必要（浏览器无法自行
> 枚举系统字体），因此按策略应归入 `user-reviewed`：安装时逐次展示风险并由使用者确认，
> 而不是 `source-verified`。本节的目的是把权限讲清楚，不是宣称低风险。

### 外部服务

- 不访问任何外部服务、CDN、字体 API、Webhook 或遥测端点。
- 不收集、不缓存、不外发任何用户数据；字体列表只缓存在宿主进程内存里（TTL 10 分钟）。

### 失败边界

- **缺 `@deepseek-ai/schemastery`**（或版本过旧无法建 volatile schema）：`Config` 导出为
  `undefined`，`/font-settings` 答 503，**DSH 启动不受影响**（0.4.3+ 的「启动不可失败」保证）。
- **缺 `@deepseek-ai/dsh-settings`**：同上，路由答 503。
- **字体目录不存在、不可读或无权限**：列表为空，客户端回退到自定义 `font-family` 输入框，
  不抛错、不中断启动。
- **单个字体文件损坏或不是 sfnt**：跳过该文件，其余字体照常返回。
- **非 web 平台**：客户端不注册，宿主侧不影响启动。

### 兼容范围

| 维度 | 声明 |
| --- | --- |
| DSH | `>=0.1.7-alpha.1 <0.2.0`（`engines.dsh` 与 `dsh.compatibility.dsh` 一致） |
| 逐版本兼容 | `dsh.compatibility.dshReleases`：`0.1.7-alpha.1` = `compatible`，`0.1.7-alpha.2` = `compatible` |
| Node.js | `>=18.17.0`（`engines.node`；使用 ESM、`node:fs/promises` 与 `node --test`） |
| Profile / 平台 | `dsh.client.platform = web`，`dsh.compatibility.profiles = ["web"]` |
| 许可证 | MIT（仓库 `LICENSE`，与 GitHub 仓库 license 元数据一致） |

范围声明不是真实 Profile 验收；逐版本的安装/启动/卸载证据见下一节。

## 一次性 Profile 验收（安装 / 启动 / 卸载）

`test/verify-disposable-profile.mjs` 在**一次性 `DSH_HOME`（`mkdtemp` 临时目录）**内跑完整生命周期，
绝不读写真实 `~/.dsh`：

```bash
npm run verify:disposable-profile
```

脚本依次执行并断言：

1. `DSH_HOME=<tmp> dsh plugin --profile font-settings-evidence add <repo>` —— 安装成功，
   profile 的 `dsh.profile.bundles` 出现 `dsh-font-settings`；
2. `DSH_HOME=<tmp> dsh --profile font-settings-evidence --dump-config` —— 配置合成与冷启动
   成功，组合树里出现**唯一**挂载条目 `- id: font-settings` / `name: dsh-font-settings`；
3. `import('<repo>/lib/index.js')` —— 宿主模块冷导入成功（模块求值不抛错）；
4. `DSH_HOME=<tmp> dsh plugin --profile font-settings-evidence remove dsh-font-settings` ——
   卸载成功，再次 `--dump-config` 时该条目消失；
5. 结束后删除临时 `DSH_HOME`。

本机实测（node v24.10.0 / dsh 0.1.7-alpha.2，`npm run verify:disposable-profile`）：

```
VERIFY_DISPOSABLE_PROFILE_OK
install   exit=0  bundles=["@deepseek-ai/dsh-base","dsh-font-settings"]
start     exit=0  entryId=font-settings  entryIdCount=1
hostImport exit=0 result=HOST_IMPORT_OK
uninstall exit=0  bundles=["@deepseek-ai/dsh-base"]  entryPresentAfterRemove=false
```

> 该证据只覆盖一次性 Profile 的安装、配置合成/冷启动与卸载，**不**覆盖浏览器渲染、
> 真实 Profile 安装或真实用户数据。

## 固定源码契约回归（`test/manifest-contract.test.mjs`）

`npm test` 会一并校验 DSH STORE 自动策略的作者侧契约，防止回归：

- manifest `repository` 归一化后等于 canonical GitHub 仓库；
- `files` 显式列出可分发文件；Bundle Patch 只挂载一个自有条目 `font-settings`；
- `engines.node`、`engines.dsh` 与 `dsh.compatibility.dsh` 显式声明且一致，
  `dshReleases` 至少有一条精确 `compatible`；
- 无生命周期脚本、无运行期/可选依赖、无 bundled 依赖；
- 客户端声明 `platform: web`。

## License

MIT
