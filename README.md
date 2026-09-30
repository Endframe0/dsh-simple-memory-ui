# dsh-simple-memory-ui

**DSWM** —— DeepSeek Harness 的持久记忆插件：让 AI 跨会话记住你的偏好、约定、决策和踩过的坑。

做法是维护一份**索引 + 主题文件**的记忆库，并把索引注入 `~/.dsh/AGENTS.md`，
于是**每个新会话开始时，AI 自动带上你已确认的记忆**。

本包 = 上游 [dsh-simple-wiki-memory](https://github.com/rainow/dsh-simple-wiki-memory) 的完整实现，
外加一个可选的 Web GUI 面板（见文末）。


## 核心机制

```
对话里出现值得记住的信息
      ↓ 实时落盘（不用等会话结束）
  pending/  待确认草稿 ── 你说「存档」──→ reference/ 正式记忆 + 更新索引
      ↓                                        ↓
  不进索引、不参与检索                   进索引 → 新会话自动注入
```

**六条维护规则**（首次运行写进 `AGENTS.md`，AI 每个会话都遵守）：

| # | 规则 | 要点 |
|---|---|---|
| 1 | 实时捕捉 | 产生即落盘，不静默丢弃；`/new` 或关页面都不丢 |
| 2 | pending → reference | 未确认的进 `pending/`；你说「存档」才晋升并进索引 |
| 3 | 无人值守会话 | 定时任务 / 后台 subagent 只写 `pending/`，不自动晋升 |
| 4 | 定期整理 | 说「整理记忆」→ AI 出重组方案，**你确认后**才执行 |
| 5 | git 备份 | `workspace/` 是 git 仓库，每次晋升 / 归档 / 整理自动 commit |
| 6 | 检索 | 先查索引，未命中**兜底扫目录**，绝不直接说"没有记忆" |

触发词中英文等价：`存档 / 确认 / save / confirm / promote`、`整理记忆 / organize memory / cleanup`。

## 记忆库结构

```
~/.dsh/AGENTS.md                     规则骨架 + 记忆索引（每会话自动注入）
~/.dsh/workspace/
├── reference/<主题>.md               正式记忆（进索引，参与检索）
├── pending/<日期>-<来源>.md          待确认草稿（不进索引）
├── archive/<时间戳>-<原名>.md        过时 / 被合并的（保留可查，不进索引）
├── memory-log.md                    追加式操作日志（审计 + 新鲜度判断）
└── .git/                            版本历史，可回滚
```

索引条目格式（AI 靠它定位正文）：

```markdown
- [主题](~/.dsh/workspace/reference/主题.md) — 一句话摘要（YYYY-MM-DD）
```

## 提供的技能

`skills/memory-query/` —— 教 AI 按「索引 → 单文件 → 兜底扫目录」的顺序检索记忆，
并在信息可能过时时用 `memory-log.md` 核对新鲜度。

## Web GUI 面板（可选）

想手动翻看 / 编辑记忆库时用。装好后侧边栏「新会话」和「工作区」之间会多一行 **「记忆」**，
点开是一个整屏面板（左列表 / 右编辑器）：

- 顶部搜索框（标题 / 摘要 / 文件名），分组列出 `待确认` 与 `正式记忆`（标题 + 摘要 + 日期 + 字数）
- 点开编辑**正文**与**索引行**（标题 / 摘要 / 日期），`Ctrl/Cmd+S` 保存
- 新建条目、把草稿「确认加入记忆」晋升为正式记忆、删除草稿 / 归档旧记忆
- 每次写入自动同步索引、记 `memory-log.md` 并 `git commit`
- 面板紧随 GUI 主题：用官方设计 token（`--dsw-*`）取色，窄栏自动上下分栏

> 1.3.0 起面板从「设置 → 记忆管理」搬到侧边栏；旧版装在设置里，功能相同但空间局促。
> 1.3.1 起确认 / 归档 / 删除改用**面板内确认框**，不再调用 `window.confirm()`：桌面版中原生模态关闭后
> 会让窗口失去输入焦点（光标消失、输入框点不进，须最小化再还原）——Electron/Windows 的坑。
> 1.4.0 起包名由 `dsh-dswm-webui` 改为 **`dsh-simple-memory-ui`**（cordis 装载 id 同步改为
> `simple-memory-ui`，消息 source kind 改为 `dsh-simple-memory-ui`）。内部 HTTP 路由仍是
> `/dswm/api`、CSS 前缀仍是 `.dswm-*`——它们指 DSWM 记忆体系本身，不是包名。

不装也不影响上面的全部功能 —— 它只是多一个可视化入口。
（接口在 `/dswm/api/*`：`ping` `list` `get` `save` `create` `promote` `archive` `delete`。）

## 安装

前置：已有可用的 DSH（`dsh` 命令）与 Node ≥ 20。以下命令都在 **DSH 安装目录**下执行。

### 网络安装（推荐）

`dsh plugin add` 内部就是 `pnpm add`，pnpm 支持的写法都能直接用：

```sh
# 从 GitHub 安装（pnpm 的 github: 协议）
dsh plugin --profile web add github:Endframe0/dsh-simple-memory-ui

# 固定版本（按 tag）——推荐生产环境这么装
dsh plugin --profile web add github:Endframe0/dsh-simple-memory-ui#v1.4.0

# 也可以直接装 Release 附件或本地 tgz
dsh plugin --profile web add https://github.com/Endframe0/dsh-simple-memory-ui/releases/download/v1.4.0/dsh-simple-memory-ui-1.4.0.tgz
dsh plugin --profile web add D:\path\to\dsh-simple-memory-ui-1.4.0.tgz
```

> ⚠️ **别写成 `@Endframe0/dsh-simple-memory-ui`**：那是 *npm scope* 写法，本包没有发布到 npm，
> 那样会 404。GitHub 源必须用 `github:<owner>/<repo>` 或仓库/Release 的 URL。
>
> 若报 `ERR_PNPM_GIT_RESOLVE_FAILED`：`github:` 写法需要 `git ls-remote github.com`，网络不通时
> 先解决可达性（例如给 git 单独配代理，不影响 npm registry：
> `git config --global http.https://github.com.proxy http://127.0.0.1:7890`）。

### 本地开发安装（改源码即时生效）

```sh
# 链接（junction/符号链接，改源码刷新页面即生效；Windows 建议用 link:）
dsh plugin --profile web add link:D:\deepseekwork\dsh-simple-memory-ui
# 或实拷贝
dsh plugin --profile web add file:D:\deepseekwork\dsh-simple-memory-ui
```

### 装完自检并重启

```sh
# 自检（必须，见下方警告）
node ~/.dsh/profiles/web/node_modules/dsh-simple-memory-ui/scripts/verify-install.mjs --fix
```

```powershell
# 重启 dsh web，然后刷新浏览器页面
Get-NetTCPConnection -LocalPort 3080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
node node_modules\@deepseek-ai\dsh\lib\bin.js web
```


验证：`curl http://127.0.0.1:3080/dswm/api/ping` → `{"ok":true,...}`。

### 官方桌面版（Electron App）

桌面版**不读 web profile**：它有自己的 profile 目录 `~/.dsh/profiles/desktop`，
插件库、`package.json`、`cordis.patch.yml` 与 web 端完全独立。
把本包装进 web profile **不会**让桌面版出现「记忆」面板 ——
`AGENTS.md`、`skills/` 之所以看起来还在，是因为它们由 DSH 内建机制读取，
和插件装在哪一侧无关。

两条安装途径（选一）：

**A. 应用内（推荐）** —— 侧边栏「插件」页 → **添加插件** → 在输入框里填下面任一种
（对话框本身就支持"包名 / GitHub 仓库地址 / 本地目录路径"三类输入）：

| 填什么 | 例子 | 说明 |
|---|---|---|
| GitHub 仓库地址 | `https://github.com/Endframe0/dsh-simple-memory-ui` | 网络安装，推荐 |
| pnpm 的 git 写法 | `github:Endframe0/dsh-simple-memory-ui`（可加 `#v1.4.0` 固定版本） | 等价，写起来更短 |
| 本地目录路径 | `D:\deepseekwork\dsh-simple-memory-ui` | 本地开发，改源码刷新即生效 |
| npm 包名 | —— | 本包**未发布到 npm**，暂不适用 |

> ⚠️ 对话框里的**「安装源」（默认 / 中国大陆镜像源）只作用于 npm registry**。
> **GitHub 地址和 `.tgz` 直链不经过安装源** —— 需要本机能直接访问 GitHub 或已配好代理。
> 若提示「无法访问 GitHub」，先确认代理可用，或改用 Release 附件 / 本地目录安装。

桌面版的包管理由 Electron shell 代理，装完会立即重新组合，通常无需重启。

**B. 命令行** —— 必须用桌面版自带的 CLI；普通 `dsh plugin --profile desktop` 会被
拒绝（`profile "desktop" is managed exclusively by the Electron application`）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$exe = 'D:\DSH\DeepSeek Harness.exe'                 # 桌面版安装位置
& $exe --expose-internals "$env:APPDATA\..\..\..\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add github:Endframe0/dsh-simple-memory-ui
```

装好后确认 `~/.dsh/profiles/desktop/package.json` 同时出现依赖与
`dsh.profile.bundles` 条目（CLI 有时只装包、不登记，见下方警告），
再验证 `<桌面版端口>/dswm/api/ping`。

> 版本：本包同时适配 **0.1.5**（web profile）与 **0.2.x**（桌面版）。
> 0.2 的 session format v4 只接受 *producer-owned* 的消息 source
> （`{kind:'plugin', plugin}` 是被拒的 v3 旧写法），1.2.0 起已改用
> `{kind:'dsh-simple-memory-ui', form:'notice', summary}`。
> 面板本身注册在 `sidebar.panellist`（侧边栏入口）+ 布局的 `main` keyed slot
> （整屏面板）——这两个 slot 在 0.1.5 与 0.2 上同名同形状，所以一份客户端代码两边通用。

> **⚠️ 第 2 步别跳过。** `dsh plugin add` 首次安装时**有时只装包、不把插件登记进
> `dsh.profile.bundles`**。后果是包躺在 `node_modules` 里、**没有任何报错**、服务照常启动，
> 但插件根本没被装配 —— 功能全部不存在。自检脚本会直接指出并修好。
> 临时替代：**再执行一次同一条 `add`**（提示 `Already up to date` 时会补登记）。

> 另一个坑：profile 的 `package.json` **不能带 UTF-8 BOM**，dsh 用 `JSON.parse` 读它，
> 带 BOM 会 `SyntaxError` 导致 `dsh web` 起不来。（PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM。）

本包已含官方 `dsh-simple-wiki-memory` 的全部功能，**两者不要同时装**；
从官方插件迁移无需转换（记忆库格式完全一致）。

### 升级

`add` 新版本后重启即可。插件只补建**缺失的**目录 / 文件，已存在的一律不动 ——
实测把一份含 3 条记忆、54 次 git 提交的库放到干净环境升级后，
`AGENTS.md` 的 SHA-256 装前装后**完全一致**，git 历史保留，条目全部可读。

## 开发

```sh
node scripts/test-core.mjs        # host 逻辑单元测试（临时目录，不碰真实记忆库）
```

## License

MIT。核心逻辑派生自 [dsh-simple-wiki-memory](https://github.com/rainow/dsh-simple-wiki-memory)（MIT, by rainow）。