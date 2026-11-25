# 每日一读 · Daily English Reader

每天自动从外刊 RSS 抓 4 篇 500–1500 词的英文原文（科技 / 法律 / 游戏 / 趣文各一篇），生成极简阅读页，部署到 GitHub Pages。

网站：<https://lolooo00.github.io/daily-english-reader/>

## 功能

- **阅读页**：四篇用标签切换，← → 键也能切；深色模式跟随系统。
- **已读 / 跳过记忆**：读到文末（停留 8 秒以上）自动记为已读，也可以手动标记；下次打开直接跳到没读的那篇。记录存在本机浏览器里。
- **归档**：按标题、来源搜索，按分类筛选，可以只看未读。
- **存成图片**：把当前文章排成手机竖屏的分页图片（1080 × 1920，一页一张），可选浅色 / 米黄 / 深色和三档字号。手机上点「Save all」会调出系统分享面板，可以直接存到相册。

## 工作方式

```
GitHub Actions（北京时间 03:23 / 06:41 / 09:13，后两次只在前面失败时才干活）
  └─ src/run.js --fetch-only
       ├─ 并行拉取 config/feeds.json 里的所有 RSS（每个请求 15 秒超时）
       ├─ 过滤：已推过的、导购 / 攻略类标题、21 天前的旧文
       ├─ 每类按来源轮换抽取，下载正文（每篇 20 秒超时），清洗成白名单 HTML
       ├─ 字数不合适的跳过；实在没有就取最接近的（400–2000 词）；
       │   某类全军覆没时依次用缓冲池、其他类的文章补位
       └─ 写入 data 分支：state.json + issues/<日期>.json
  └─ src/run.js --no-fetch → dist/ → 部署到 GitHub Pages
```

- **`main` 分支**只放源码，不再提交任何生成文件。
- **`data` 分支**存每天的文章和状态（已推送链接、缓冲池、各源健康度）。它永远只有一个提交：每次运行都会把它覆盖成新快照，所以不会越积越多。
- 某个源连续失败 3 次，或者某类当天没抽到文章，阅读页顶部会出现提示；整次运行抓不到任何文章时 workflow 会失败，GitHub 会发邮件通知。
- 首页在没有当天文章时会提示「No new issue since …」，不会再悄悄停更。

## 本地运行

需要 Node 20.11 以上。

```bash
npm install
npm run daily        # 抓今天的文章（已存在就跳过）并生成 dist/
npm run serve        # 本地预览 http://localhost:4173/
npm test             # 单元测试
npm run check-feeds  # 检查每个源能不能拉到、正文能不能抽取、字数是否合适；可加分类名，如 npm run check-feeds fun
```

本地数据写在 `data/`，与线上的 `data` 分支无关。想在本地用线上数据：`git worktree add data origin/data`。

## 常见维护

| 想做的事 | 改哪里 |
|---|---|
| 增删 RSS 源 | `config/feeds.json`；源可以写多个 `urls`，也可以用 `exclude` 正则屏蔽某类标题 |
| 屏蔽一类标题 | 全局：`src/config.js` 的 `TITLE_BLOCKLIST`；只对某个分类：`CATEGORY_EXCLUDES` |
| 字数范围、超时、每类最多尝试次数 | `src/config.js` 的 `WORDS`、`WORDS_RELAXED`、`LIMITS` |
| 手动重抓今天的文章 | Actions → Daily English Reader → Run workflow，勾选 *force* |

推送到 `main` 会自动重新构建、部署（只改 `.md` 文件不会触发）。
