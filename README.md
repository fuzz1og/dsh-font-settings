# dsh-font-settings

DeepSeek Harness Web UI 插件：**字体偏好设置**——在「设置 → 通用」中提供 UI 字体、代码/等宽字体（系统字体枚举 + 自定义 CSS font-family）与**侧边栏终端字号**，通过主题覆盖层与 `@font-face` 别名实时生效。

## 安装

```bash
dsh plugin --profile web add github:fuzz1og/dsh-font-settings
```

该包声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把它加入 profile 的
`dsh.profile.bundles`，无需手改任何 patch 文件。

**重启 DSH 后生效。**

> 兼容性：适配 dsh ≥ 0.1.2-alpha.2（客户端 store 从 `@deepseek-ai/dsh-client-store`
> 取——`@deepseek-ai/dsh-client-runtime` 已移除；宿主侧 `settings.register`
> 直接传命名空间字符串——`settingsNamespace()` 已移除）。

> 旧版（无 `dsh.bundle.patch`）需要手动在 `cordis.patch.yml` 插入挂载行：
> ```yaml
> - insert:
>     - id: font-settings
>       name: 'dsh-font-settings'
> ```
> 新安装无需此步骤。

## 工作原理

| 环节 | 说明 |
| --- | --- |
| 宿主半区 | 拥有 `ui-font` 设置命名空间（持久化进 `$DSH_HOME/settings.yaml`），提供三条同源路由：`GET/POST /font-settings` 读写设置、`GET /font-settings/fonts` 枚举已安装系统字体 |
| 系统字体枚举 | 浏览器无法列出已安装字体，且系统显示名与 CSS 家族名常不一致——宿主扫描各平台字体目录，解析每个字体文件的 sfnt name 表（nameID 16/1 取家族名，nameID 4/6 取 `local()` 可用的 FullName/PostScript 名，并从 `OS/2`/`head` 取字重与斜体），按家族聚合出 face 列表；TTC 集合读取第一个 face；并行扫描 + 10 分钟缓存（过期条目先返回、后台重扫，启动时预热）。平台目录见下节 |
| 客户端半区 | 通过主题服务的 `overrideTokens()` 叠加两个根 CSS 变量（`--dsw-font-family` / `--ds-font-family-code`），所有 `--dsw-font-*` 排版 token 都引用它们；此外另注入一张 `@font-face` 别名表覆盖侧边栏终端的字体与字号（见下节） |
| 依赖 | `webServer` + `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery` |

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
读不到时退回 13 —— 将来 dsh 若把这个字面量改掉，插件不需要跟着改。

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

## License

MIT
