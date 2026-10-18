# 验证报告 — fqapp PC 1.0.0

本轮实际执行的检查与其证据。未执行的项在最后一节单列。

## 1. 交付形态

| 项 | 结果 |
| --- | --- |
| 产物 | `dist/fqpc.exe`（单文件） |
| 大小 | 见 `dist/SHA256SUMS` 同目录清单 |
| 安装依赖 | 无。仅需系统自带 WebView2 运行时 |
| 数据目录 | `%LOCALAPPDATA%\fqapp-pc`，可用 `FQPC_HOME` 改写 |

## 2. 构建

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 离线依赖解析与编译 | `cargo build --offline --release -p fqpc` | 通过（3m20s，全离线） |
| Debug 编译 | `cargo build --offline -p fqpc` | 通过 |

Tauri v2 全套依赖（tauri 2.12.1 / tauri-build 2.7.1 / tao 0.37.1 / wry 0.57 /
webview2-com 0.39.1 / tauri-plugin-single-instance 2.5.2）均命中本地 registry 缓存，
构建过程不需要联网下载。

## 3. 静态检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| rustfmt 覆盖 | `tools/check-format.ps1` | 62 个受跟踪 `.rs` 全部干净（排除 `frb_generated.rs`） |
| 前端脚本语法 | `node --check`（pc.js 与 5 个页面内联脚本） | 全部通过 |

## 4. 核心回归测试

`cargo test --offline -p fqapi_core`

**177 项通过，6 项失败。**

失败项全部集中在 `core/tests/static_and_loopback.rs:365` 的同一处符号链接创建辅助函数：

```
this test needs symlink support (Windows: enable Developer Mode):
客户端没有所需的特权 (os error 1314)
```

失败用例：`a_symlink_that_stays_inside_the_root_is_still_served`、
`an_index_symlinked_out_of_the_root_is_refused`、`declared_length_always_matches_the_body`、
`directory_index_inside_the_root_is_served`、
`empty_file_ranges_are_ignored_with_consistent_headers`、
`loopback_adapter_refuses_a_symlinked_index_and_serves_empty_files`。

**判定：环境限制，非代码回归。** 这 6 项验证静态文件服务的符号链接越权防护，
在 Windows 上创建符号链接需要 `SeCreateSymbolicLinkPrivilege`（开发者模式或管理员）。
测试代码自身已就此显式 `panic!` 说明。未开启开发者模式时无法判定其通过。

## 5. 实机启动验证

启动 `fqpc.exe` 后实测：

| 检查 | 结果 |
| --- | --- |
| 进程存活、窗口创建 | 通过 |
| 数据目录物化 | `web/` 9 个页面 + `assets/`（pc.css/pc.js/storage.js/favicon/css/webfonts）、`config/` 3 个文件、`filters/` 15 个脚本 |
| 日志写入 | `%LOCALAPPDATA%\fqapp-pc\rust.log` 记录 runtime dir 与 loopback 入口 |
| 会话入口 `/_session/<token>` | 303 重定向到 `/` 并下发会话 Cookie |
| 无会话访问 `/` | 401（会话校验生效） |
| `GET /health` | 200 `{"devices":5,"status":"ok"}`，设备池自动注册成功 |

### 页面可达性（携带会话 Cookie 实测 HTTP 状态）

| 路径 | 状态 |
| --- | --- |
| `/`、`/index.html`（发现） | 200 |
| `/search.html`（搜索） | 200 |
| `/library.html`（书架） | 200 |
| `/settings.html`（设置） | 200 |
| `/detail.html?…` | 200 |
| `/assets/pc.css`、`/assets/pc.js`、`/assets/storage.js`、`/assets/favicon.png` | 200 |

### 业务链路（真实上游请求）

| 检查 | 结果 |
| --- | --- |
| `/api/search?query=闪电` | 200，返回小说 / 漫画 / 听书 / 短剧四个分类共 40 条 |
| `/api/v1/recommend/homepage?tab_type=2` | 200，约 620 KB，11 个频道、12 个推荐区块、真实封面 |
| 详情页 | 加载《她上岸提分手，我转身成领导秘书》详情与章节目录（1550 章） |
| 章节正文 | 点击第 1 章进入阅读页，正文解密并正常渲染 |

## 6. 界面验证（浏览器实测渲染）

- **发现页**：侧边栏（发现/搜索/书架/设置，当前页高亮）、固定顶栏（返回 + 全局搜索 +
  Ctrl K 提示 + 主题切换）、频道切换（书城/小说/漫画/听书/短剧/漫剧）、「排行榜 16 部」与
  「猜你喜欢 11 部」两个区块均渲染真实封面。
- **详情页**：封面、书名、作者/来源/模式、简介、标签、四个操作按钮（前端极速下载 / 后端打包
  下载 / 清理缓存 / 加入收藏）、目录四列网格。
- **阅读页**：沉浸模式生效——侧栏与顶栏自动隐藏，正文占满窗口；真实正文已解密渲染。
- **书架页**：历史条目含封面、书名、作者、时间戳与收藏/删除按钮。

## 7. 本轮修复的问题

| 现象 | 真因 | 修法 |
| --- | --- | --- |
| 发现页永久停在骨架屏 | `collectBooks` 首次调用未传 `depth`，比较 `undefined > 3` 恒为假使递归上限失效，且 `push(...大数组)` 溢出参数栈 | 传入初始深度并做 `typeof` 兜底，限制递归层数与条目上限，改为逐项 push |
| `/pc.css`、`/pc.js` 返回 404 | 调度器只放行 `/`、`*.html`、`*.ico` 与 `/assets/*`，根目录的 css/js 落在路由表之外 | 共享资源移入 `ui/assets/`，路径改为 `/assets/...` |
| 书架与阅读进度每次启动丢失 | loopback 随机端口导致 Web UI 的 origin 变化，浏览器视作新站点而丢弃 localStorage | 端口优先取 `config.json`，顺延 8 个后才退让随机端口并写告警 |
| 漫剧点目录跳到小说阅读页 | 详情页路由只判断了「短剧」，未覆盖「漫剧」 | 补上 `tab === "漫剧"` 走 video.html |

## 8. 未执行 / 未验证项

- **未在非 Windows 平台验证。** 外壳依赖 Tauri v2 + WebView2，仅在 Windows x64 上构建与运行。
- **未做多显示器 / 高 DPI / 超宽屏布局实测。** 仅在 1280×720 与 1684×1374 两种视口验证。
- **未实测听书、短剧、漫剧、漫画四条播放链路。** 本轮只端到端验证了搜索、推荐、详情、
  目录与小说正文；这四页沿用原有实现与同一套 `/api/*` 通路（短剧与漫剧已实测经
  `/api/search` 返回数据），但未逐页播放确认。
- **未做设备池加密。** PC 版未接入 DPAPI，核心日志提示
  `saving device pool unencrypted: no pool key provisioned`。
- **未验证多开与单实例插件的实际行为。** 插件已注册，启动时未见异常，但未做双击竞态实测。
- **未执行真实移动鼠标唤出沉浸页控件的交互测试。** 该行为由 `mousemove` 监听实现，
  截图证据是控件已处于隐藏态（阅读页截图中侧栏与顶栏均不可见）。
