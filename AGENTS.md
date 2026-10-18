# AGENTS.md — 番茄超市 协作指南

本文件是代理在本仓库的执行入口。用户当前的明确要求优先于本文件和本地说明；已经给出的授权
与限制在任务续接时仍有效。版本与命令以受 Git 跟踪的构建脚本为准。

## 1. 这是什么

番茄小说聚合客户端的 Windows 桌面版，单文件免安装。**业务核心与 Android 版同源**：同一个
`fqapi_core`，同一套签名、设备池轮换、CENC 解密与选流链路。本仓库只负责桌面外壳与 PC 端界面。

主分支为 `master`，桌面版工作在 `pc` 分支。

| 路径 | 职责 |
| --- | --- |
| `desktop/` | Tauri v2 外壳：窗口、单实例、资源内嵌、loopback 启动 |
| `core/` | `fqapi_core`，来自 Android 版的 Rust 核心（协议回归与离线夹具在 `core/tests`、`core/testdata`） |
| `ui/` | Web UI：发现、搜索、详情、阅读、听书、短剧、漫画、书架、设置 |
| `runtime/` | 默认配置与响应过滤器，编译进 exe，首次启动释放到数据目录 |
| `tools/` | 构建与校验脚本，以及 `icon-args.json`（应用图标的生图参数） |

### 应用图标

图标主体是戴墨镜的大番茄，源图由 `tools/icon-args.json` 里的参数生成，
`desktop/icons/icon-master.png` 是裁切并做了圆角遮罩的母版。换图时改参数重新生成，
再从母版导出 `32x32.png` / `128x128.png` / `128x128@2x.png` / `icon.ico`
（ico 内含 16/24/32/48/64/128/256 七档），并同步替换 `ui/favicon.png`
与 `ui/assets/favicon.png`——侧栏品牌区和浏览器页签图标用的是后者。
`tauri.conf.json` 的 `bundle.icon` 决定窗口与任务栏图标。

## 2. 开工与范围控制

1. `git status --short --branch` 核对分支与既有改动；保留用户未提交的修改。
2. 定位调用入口与现有实现，再做最小必要改动。无关问题记入本仓库文档，不顺手重构、
   升级依赖或恢复 Android 版已裁撤的功能（追剧、点赞、分享等写操作）。
3. 搜索优先 `rg`；独立只读检查可并行。构建、测试与 Git 提交串行，避免 Cargo target 锁与
   loopback 端口冲突。

## 3. 验证：用测试确认改动

```powershell
cargo test --offline -p fqapi_core     # 核心协议回归
.\tools\check-format.ps1               # rustfmt 覆盖检查
.\tools\build.ps1 -Offline             # 构建并产出 dist/番茄超市.exe + SHA256SUMS
```

| 改动面 | 验证方式 |
| --- | --- |
| 纯文档、排版 | 检查差异与命令准确性；无需构建，不递增版本 |
| `ui/` 页面或样式 | `node --check` 校验内联脚本；`cargo build` 后启动并在浏览器中实测 |
| `desktop/` 外壳 | `cargo build`，启动 exe，确认窗口与 loopback 可用 |
| `core/` | `cargo test -p fqapi_core`；协议变更必须覆盖受影响的黄金夹具 |
| 端到端 | 启动 exe，访问 loopback 验证页面与 `/api/*` 通路 |

- 改过 `ui/` 后必须重新 `cargo build`：UI 是**编译期内嵌**进 exe 的，不是运行时读盘。
- rustfmt 检查必须枚举 Git 跟踪的全部手写 `.rs` 并排除 `frb_generated.rs`，禁止用
  `cargo fmt --all -- --check` 冒充覆盖检查。
- **Windows 符号链接权限导致的 6 项失败属于已知环境限制**，不是回归：它们验证静态文件服务
  的越权防护，创建符号链接需要开发者模式（OS 1314）。单列说明，不得记为通过，也不得
  因为它断言「全量通过」。

## 4. 代码边界与不变量

- **loopback 端口必须稳定。** Web UI 的 origin 是 `http://127.0.0.1:<端口>`，端口变化会让浏览器
  丢弃 localStorage 里的书架、收藏与阅读进度。外壳优先使用 `config.json` 的 `port`，顺延
  8 个后才退让随机端口并写告警。不要为了「避免冲突」直接用随机端口。
- **保留 Host / Origin 校验与会话校验。** 会话能力只经 `/_session/<token>` 入口传递并换成
  HttpOnly Cookie，任何页面都不得读到能力串；窗口必须直接指向 loopback origin，不要改成
  `tauri://` 再加 CORS 例外。
- **UI 资源必须放在 `web/assets/` 下。** 调度器只放行 `/`、`*.html`、`*.ico` 与 `/assets/*`；
  放在根目录的 `.css`/`.js` 会 404。
- **资源内嵌策略分两类**：`web/` 与 `filters/` 每次启动按内容差异覆盖（升级要生效、损坏要自愈）；
  `config/` 只在缺失时创建，用户改过的配置不得被静默还原。
- **选流层必须过滤 `bytevc2`，同画质优先 `h264`**；不能解码时返回无可用流，不把不支持的流
  交给播放器。
- **不要在 `core/` 里引入平台耦合。** 它必须继续能在 Android 与 Windows 上编译；平台差异
  属于 `desktop/`。
- 前端沿用原生 DOM 写法，不引入构建工具链；所有存储读写都要有 try/catch 兜底。

## 5. 本地资料与续接

| 本地路径 | 用途 |
| --- | --- |
| `README.md` | 产品说明、架构、构建与已知限制 |
| `tools/` | 构建与校验脚本 |

新问题按「现象 / 证据 → 影响 → 建议修法 → 发现处」记录。机制性问题补充「症状 → 真因 →
判据 → 固化去处」。提交前复查工作树，确认只包含本轮预期改动；未执行的检查明确写「未执行」。
