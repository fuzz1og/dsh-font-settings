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
| 系统字体枚举 | 浏览器无法列出已安装字体，且注册表显示名与 CSS 家族名常不一致——宿主扫描机器 + 用户字体目录，解析每个字体文件的 sfnt name 表（nameID 1, UTF-16BE）取真实家族名；TTC 集合读取第一个 face；Windows 扫描 `%WINDIR%\Fonts` 与用户字体目录，macOS 扫描 `/System/Library/Fonts`（含 `Supplemental`）、`/Library/Fonts` 与 `~/Library/Fonts`（以点号开头的系统私有家族如 `.LastResort` 会被跳过）；其余平台返回空列表，客户端回退到自定义输入 |
| 客户端半区 | 通过主题服务的 `overrideTokens()` 叠加两个根 CSS 变量（`--dsw-font-family` / `--ds-font-family-code`），所有 `--dsw-font-*` 排版 token 都引用它们 |
| 依赖 | `webServer` + `@deepseek-ai/dsh-settings` + `@deepseek-ai/schemastery` |

## License

MIT
