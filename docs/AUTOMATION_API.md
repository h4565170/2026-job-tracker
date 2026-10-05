# 自动化 API 接入文档

基础地址：部署后的固定网址，例如 `https://2026-job-tracker.vercel.app`。

## 鉴权

### 普通页面 API

如果部署时设置了 `APP_PASSWORD`，普通 `/api/*` 请求需要 HTTP Basic Auth。用户名可任意填写，密码使用 `APP_PASSWORD`。

```bash
curl -u user:你的访问密码 https://你的域名/api/applications
```

`/api/health` 不要求密码，供部署平台健康检查使用。

### 自动化写入 API

`/api/automation/*` 使用单独的 API Key。生产环境未配置 `AUTOMATION_API_KEY` 时会拒绝写入。

```text
X-API-Key: 你的 AUTOMATION_API_KEY
```

如果同时设置 `APP_PASSWORD` 和 `AUTOMATION_API_KEY`，自动化请求优先使用 `X-API-Key`，不要求 Basic Auth。

## 岗位记录结构

```json
{
  "applicationDate": "2026-10-05",
  "companyName": "远航科技",
  "jobTitle": "海外销售管培生",
  "jobType": "海外销售",
  "companyType": "民企",
  "channel": "企业官网",
  "location": "深圳",
  "salaryRange": "15-20K",
  "jobUrl": "https://example.com/job/1",
  "status": "已投",
  "rejectionReason": "",
  "notes": "自动投递完成"
}
```

固定枚举：

- `jobType`：`销售`、`海外销售`、`国际贸易`、`销售运营`、`运营`、`管培生`、`其他`
- `companyType`：`外企`、`国企/央企`、`民企`、`上市公司`、`其他`
- `status`：`待投`、`已投`、`笔试`、`一面`、`二面`、`Offer`、`拒绝`、`无回应`

## 写入或更新一条投递记录

`POST /api/automation/applications/upsert`

`externalId` 是自动化任务的稳定唯一标识。相同 `externalId` 重复提交时更新原记录，不会产生重复数据。

```bash
curl -X POST "https://你的域名/api/automation/applications/upsert" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{
    "externalId": "task-20261005-0001",
    "applicationDate": "2026-10-05",
    "companyName": "远航科技",
    "jobTitle": "海外销售管培生",
    "jobType": "海外销售",
    "companyType": "民企",
    "channel": "AI 助手",
    "location": "深圳",
    "status": "已投",
    "notes": "自动投递完成"
  }'
```

首次写入返回 `201` 和 `meta.operation = "created"`；相同 `externalId` 再次写入返回 `200` 和 `meta.operation = "updated"`。

响应体中的 `data.id` 是系统内数据库 ID，后续快速更新状态时使用。

## 按数据库 ID 更新状态

`PATCH /api/automation/applications/{id}/status`

```bash
curl -X PATCH "https://你的域名/api/automation/applications/12/status" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{"status":"笔试"}'
```

## 查询接口

### 查询岗位列表

`GET /api/applications`

可选查询参数：

- `q`：关键词，搜索公司、岗位、地点、渠道、薪资、备注、拒绝原因。
- `status`：投递状态。
- `jobType`：岗位类型。
- `companyType`：公司类型。
- `city`：城市，支持部分匹配。
- `sortBy`：`applicationDate`、`companyName`、`jobTitle`、`status`、`updatedAt`、`createdAt`。
- `sortDir`：`asc` 或 `desc`。
- `limit`：默认 `500`，最大 `1000`。
- `offset`：分页偏移量。

### 查询单条记录

`GET /api/applications/{id}`

### 查询统计

`GET /api/dashboard?today=2026-10-05&weekStart=2026-10-05`

`today` 和 `weekStart` 都由客户端传入，避免服务器时区不同导致本周统计偏差。

### 查询枚举、城市和渠道候选值

`GET /api/meta`

## 普通页面写入接口

这些接口供本项目管理页面使用，若设置 `APP_PASSWORD` 则需要 Basic Auth：

- `POST /api/applications`：新增岗位。
- `PATCH /api/applications/{id}`：更新字段。
- `PATCH /api/applications/{id}/status`：快速更新状态。
- `DELETE /api/applications/{id}`：删除记录。

## 错误格式

```json
{
  "error": "请填写：公司名称、岗位名称"
}
```

建议自动化助手只对 `2xx` 判定成功，并将网络错误或非 `2xx` 响应写入自己的重试队列。
