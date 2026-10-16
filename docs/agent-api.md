# Agent HTTP API

面向 Skills / 其他 Agent 的**免鉴权** HTTP 接口（假定内网使用）。与 AI 对话页工具同能力，但作用域由「大模型配置」里的 **Agent 白名单** 控制（须为同步白名单子集）。

- 网关路径：`/api/agent/*`（nginx 将 `/api/` 反代到后端根路径）
- 后端挂载：`/agent/*`
- 无 Authentication / API Key
- 当「启用对外接口」关闭时，工具类接口返回 **403**，body 含 `AGENT_API_DISABLED`

## 设置 JSON 形状

存在各账号 `accounts.settings`（JSONB）中：

```json
{
  "agentApi": {
    "enabled": false,
    "chatIds": ["1951594315"]
  }
}
```

- `enabled`：UI 会同步写到所有账号；任意账号为 `true` 即视为全局开启
- `chatIds`：该账号允许被 Agent 查询的 chatId 列表；保存时会裁剪到同步白名单 `messageProcessing.whitelistChatIds` 内
- 开启但 `chatIds` 为空 → 工具返回空结果（与同步白名单严格空语义一致）

配置也可通过 HTTP：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/agent/config` | 读取全局开关 + 各账号白名单与可选会话列表 |
| PUT | `/api/agent/config` | 写入；body: `{ "enabled": true, "accounts": [{ "accountId": "...", "chatIds": ["..."] }] }` |

## 工具端点

均为 `POST`，`Content-Type: application/json`。可选公共字段：

- `accountIds?: string[]` — 只查这些账号；省略则查所有已开启接口且有白名单的账号
- 工具自身的 `chatIds`（若有）会与 Agent 白名单取交集

### POST `/api/agent/searchMessages`

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/searchMessages' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "艺术展览",
    "useVector": true,
    "limit": 10,
    "accountIds": [],
    "chatIds": []
  }'
```

Body: `query`, `useVector?` (default true), `limit?` (1–50), `fromUserId?`, `timeRange?: { start?, end? }`, `chatIds?`, `accountIds?`

### POST `/api/agent/retrieveContext`

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/retrieveContext' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "1951594315",
    "targetTimestamp": 1729000000,
    "limit": 5
  }'
```

Body: `chatId`, `targetTimestamp` (unix 秒), `limit?`, `accountId?`, `accountIds?`

### POST `/api/agent/getDialogs`

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/getDialogs' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Body: `accountIds?`  
返回仅 Agent 白名单内会话（跨账号）。

### POST `/api/agent/searchPhotos`

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/searchPhotos' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "海报",
    "useVector": true,
    "limit": 10
  }'
```

Body: `query`, `useVector?`, `limit?`, `chatIds?`, `accountIds?`

### POST `/api/agent/chatNote`

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/chatNote' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "1951594315",
    "note": "",
    "modify": false
  }'
```

Body: `chatId`, `note?`, `modify?` (true=写入), `accountId?`, `accountIds?`

## UI

AI 对话页顶部 Tab：**对话** | **大模型配置**  
在「大模型配置」中开关对外接口，并按账号勾选同步白名单中的群/频道。
