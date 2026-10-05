# 2026 秋招岗位投递管理表

手机优先、电脑端同样好用的秋招投递管理应用。本地开发使用 SQLite；Vercel 生产环境使用 Neon PostgreSQL，避免 Serverless 部署或重启导致数据丢失。

## 已实现

- 岗位字段：投递日期、公司、岗位、岗位类型、公司类型、渠道、地点、薪资、链接、状态、拒绝原因、备注。
- 首页统计：总投递数、本周投递、面试数、Offer 数、拒绝数、无回应数、面试率、Offer 率。
- 最近投递、手机卡片列表、电脑表格视图。
- 关键词搜索，以及状态、岗位类型、公司类型、城市筛选。
- 手机端卡片内下拉快速修改状态；新增/编辑使用底部抽屉表单。
- Vercel + Neon PostgreSQL 生产持久化。
- 自动化写入 API，支持 API Key 和 `externalId` 幂等去重。
- `APP_PASSWORD` 访问保护。

## 本地运行

要求 Node.js 22.13 或更高版本。

```powershell
node server.js
```

打开 `http://localhost:3000`。本地默认使用 `data/job-tracker.sqlite`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 本地 HTTP 端口，默认 `3000` |
| `HOST` | 本地监听地址，默认 `0.0.0.0` |
| `DATA_DIR` | 本地 SQLite 数据目录 |
| `DATABASE_PATH` | 本地 SQLite 文件路径 |
| `DATABASE_URL` | Vercel / Neon PostgreSQL 连接串 |
| `APP_PASSWORD` | 页面和普通 API 的 HTTP Basic Auth 密码 |
| `AUTOMATION_API_KEY` | AI 助手写入接口的 API Key |

本地开发只需设置 `APP_PASSWORD` 和 `AUTOMATION_API_KEY`：

```powershell
$env:APP_PASSWORD='你的访问密码'
$env:AUTOMATION_API_KEY='一段足够长的随机字符串'
node server.js
```

Vercel 生产环境只需要配置 `DATABASE_URL`、`APP_PASSWORD` 和 `AUTOMATION_API_KEY`，不要提交真实值。

## 部署到 Vercel + Neon

项目包含：

- `vercel.json`：静态页面发布到 `public`，API 使用 Serverless Function。
- `api/[...route].js`：Vercel API 统一入口。
- `src/postgres.js`：Neon PostgreSQL 数据访问层。
- `pnpm-lock.yaml`：锁定依赖版本。

部署流程：

1. 将代码推送到 GitHub。
2. 在 Vercel 导入 GitHub 仓库。
3. 在 Vercel Marketplace 添加 Neon，选择 Free 方案。
4. 将数据库连接到 Production 和 Preview 环境，Vercel 会自动注入 `DATABASE_URL`。
5. 设置 `APP_PASSWORD` 和 `AUTOMATION_API_KEY` 环境变量。
6. 重新部署后，Vercel 会分配固定网址，例如 `https://2026-job-tracker.vercel.app`。

Neon 免费方案的数据独立于 Vercel 实例存在。重新部署 Vercel、Serverless 冷启动或实例重启不会清空投递数据。

## 自动化 API

接口文档见 [docs/AUTOMATION_API.md](docs/AUTOMATION_API.md)。

关键原则：

- `externalId` 标识一条自动投递任务；重复提交会刷新同一条记录。
- 自动化接口使用 `X-API-Key`。
- 页面接口如果设置了 `APP_PASSWORD`，需要 HTTP Basic Auth。

## 测试

```bash
node --test test/api.test.js
```

测试覆盖：静态页面、元数据、新增/查询/修改/删除、状态更新、统计、筛选、本地 SQLite 持久化、API Key、访问密码。
