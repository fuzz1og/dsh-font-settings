# dsh-font-settings

DeepSeek Harness Web UI 插件：**字体偏好设置**——在「设置 → 通用」中提供 UI 字体与代码/等宽字体选择（系统字体枚举 + 自定义 CSS font-family），通过主题覆盖层实时生效。

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
| 系统字体枚举 | 浏览器无法列出已安装字体，且系统显示名与 CSS 家族名常不一致——宿主扫描各平台字体目录，解析每个字体文件的 sfnt name 表（nameID 16/1，UTF-16BE）取真实家族名；TTC 集合读取第一个 face；并行扫描 + 10 分钟缓存（过期条目先返回、后台重扫，启动时预热）。平台目录见下节 |
| 客户端半区 | 通过主题服务的 `overrideTokens()` 叠加两个根 CSS 变量（`--dsw-font-family` / `--ds-font-family-code`），所有 `--dsw-font-*` 排版 token 都引用它们 |
| 依赖 | `webServer` + `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery` |

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
