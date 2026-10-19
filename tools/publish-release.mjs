// 上传 Release 资产，并保证资产名与本地文件名完全一致。
//
// 为什么不用 `gh release upload`：Windows 上 PowerShell 把中文路径传给原生程序时
// 可能按本地 ANSI 代码页编码，gh 拿到的文件名不对，GitHub 侧就会退回成
// "default.exe"（扩展名由 Content-Type 推断）。这条路径用 Node 自己拼 URL，
// 用 encodeURIComponent 保证 query 里的文件名是标准 UTF-8 百分号编码。
//
// 用法：
//   node tools/publish-release.mjs <owner/repo> <releaseId> <本地文件> [资产名]
//
// 资产名默认取本地文件名。releaseId 用：
//   gh api repos/<owner>/<repo>/releases/tags/<tag> --jq .id

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , repo, releaseId, file, explicitName] = process.argv;
if (!repo || !releaseId || !file) {
  console.error('usage: node tools/publish-release.mjs <owner/repo> <releaseId> <file> [name]');
  process.exit(2);
}

const name = explicitName || basename(file);
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const url = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;

const body = readFileSync(file);
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/x-msdownload',
    'Content-Length': String(body.length),
  },
  body,
});

const text = await res.text();
if (!res.ok) {
  console.error(`upload failed: HTTP ${res.status}\n${text}`);
  process.exit(1);
}
const json = JSON.parse(text);
console.log(`uploaded: name=${json.name}  size=${json.size}  digest=${json.digest}`);
console.log(`download: ${json.browser_download_url}`);
if (json.name !== name) {
  console.error(`!! 资产名被改写：期望 "${name}"，实际 "${json.name}"`);
  process.exit(1);
}
