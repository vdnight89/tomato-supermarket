番茄超市 v1.0.0 —— 番茄小说的 Windows 桌面客户端（首次发布）

单个 exe，11.4 MB，下载后双击即用。没有安装步骤，没有服务，没有依赖目录。

## 下载

| 文件 | 说明 |
| --- | --- |
| `番茄超市.exe` | 11.4 MB，Windows 10 / 11 x64 |
| `SHA256SUMS` | 校验和 |

```
04db77955038bd214ae5a367dc84514d44dc91b6387ecf13b8b44fd78d80bdcd  番茄超市.exe
```

校验：

```powershell
Get-FileHash .\番茄超市.exe -Algorithm SHA256
```

## 这个版本有什么

- **五类内容**：小说、听书、短剧、漫剧、漫画
- **九个入口**：发现、搜索、详情、阅读、听书、短剧/漫剧播放、漫画、书架、设置
- **桌面端重做的界面**，不是手机页面放大：常驻侧栏、固定顶栏、沉浸阅读、宽屏网格自适应列数
- **快捷键**：`Ctrl+K` 搜索、`Ctrl+L` 书架、`Ctrl+,` 设置、`Ctrl+D` 主题、`S` 沉浸页设置、`F11` 全屏
- 业务核心与 Android 版**同源**：同一个 `fqapi_core`，同一条签名 / 设备池 / CENC 解密 / 选流链路

## 系统要求

- Windows 10 21H2 / Windows 11（x64）
- WebView2 运行时（Win11 与较新的 Win10 已预装；缺失时安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)）
- 需要访问番茄公开接口

## 数据与卸载

第一次启动会在 `%LOCALAPPDATA%\fqapp-pc` 建立数据目录，书架、收藏、阅读进度都在那里。
**删掉那个目录就是完全卸载。**

想做成 U 盘绿色版，先设 `FQPC_HOME` 再运行：

```powershell
$env:FQPC_HOME = "E:\fqapp-data"
.\番茄超市.exe
```

## 已知限制

- 仅 Windows x64
- 设备池在本机明文存储（未接入 DPAPI），日志里会有 `saving device pool unencrypted` 提示
- 听书走系统语音合成（上游音频接口返回 `invalid aid`），音色取决于系统里安装的中文语音包
- 仅内容消费，不提供登录与社交写入

完整说明、实机截图与源码：https://github.com/vdnight89/tomato-supermarket
