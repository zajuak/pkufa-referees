# 北大足协裁判员管理

[在线使用](https://zajuak.github.io/pkufa-referees/) · [管理员入口](https://zajuak.github.io/pkufa-referees/#/admin)

首页保留每周裁判选派表。GitHub Pages 提供网站，用户自己的 Cloudflare Workers + D1 保存业务数据。

- **公开访问**：每周赛程、裁判选派、赛事/周次/场地/姓名筛选、选派表和个人日历导出、管理办法。
- **裁判员查询**：无需密码，直接按姓名查询积分、工资、执裁与奖惩明细。
- **管理后台**：维护裁判档案、选派、工资标准和奖惩；Excel 导入导出；冲突检查、整日请假、工作总览、自动版本备份及恢复。

积分工资查询目前公开只读，管理员登录后才能修改数据、导入、恢复备份或管理账号。管理密码使用 PBKDF2 哈希，登录令牌有签名与过期时间。个人登录、查询密码重置与改密接口继续保留，前台暂不展示密码查询和账号开通入口；将 `PUBLIC_QUERIES` 改为 `false` 可在后端恢复原来的个人资料读取限制。

真实姓名积分工资数据、原始工资表、备份、账号密码和运行时 Secret **不在本仓库或 Git 历史内**。`data/example-store.json` 是没有业务记录的空示例。前端构建不包含初始业务数据。

## 开发与构建

Node.js >= 22.13，建议 Node 24：

```sh
npm ci
npm test
VITE_GITHUB_PAGES=true VITE_BASE_PATH=/pkufa-referees/ VITE_API_BASE=https://pkufa-referees-api.junkaizhao404.workers.dev npm run build:pages
npm run build:api
```

Pages 使用 HashRouter，刷新个人查询和后台链接仍然可用。静态文件全部保留项目路径前缀。

推送 `main` 后 GitHub Actions 自动测试、构建和发布 Pages。前端不需要数据库或登录 Secret。

后端代码在 `worker/github.mjs`，配置在 `cloudflare/wrangler.jsonc`，SQL 迁移在 `drizzle/`。使用自己的 Cloudflare 账号发布：

```sh
npm run build:api
npx wrangler d1 migrations apply pkufa-referees --remote --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

生产 Worker 需配置 Secret：`ADMIN_PASSWORD_HASH`（格式见 `worker/auth.mjs` 的 `passwordHash`）与 `SESSION_SECRET`。不要将 Secret 写入仓库、前端环境变量或 URL。首次管理员密码由部署者保管。管理员密码作为生产 Secret 配置，不写入本仓库。个人查询账号接口保留供后续需要时恢复。

上线数据库已导入原站数据。后续部署不清空或覆盖云端记录；空库首次读取才使用示例种子。每次业务保存原子新增快照，旧版本提交返回 409。恢复前后完整版本均保留，账号凭据独立保存，恢复业务备份不会还原旧密码。

`tests/` 使用合成数据验证积分、Excel 导出、公开查询与原有个人权限、密码签名、过期、重置撤销和登录限流；真实原始表格的核对测试保留在部署者本机，不上传本仓库。
