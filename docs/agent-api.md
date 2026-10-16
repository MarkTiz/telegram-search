# Agent HTTP API

面向 Skills / 其他 Agent 的**免鉴权** HTTP 接口（假定内网使用）。与 AI 对话页工具同能力。

作用域由 **全局** Agent 白名单控制（`app_settings` 表，`key = agentApi`），不是各账号 `accounts.settings` 分叉存储。UI 仍按账号列出同步白名单会话供勾选，保存时写入一份全局配置。

- 网关路径：`/api/agent/*`（nginx 将 `/api/` 反代到后端根路径）
- 后端挂载：`/agent/*`
- 无 Authentication / API Key
- 「启用对外接口」关闭时，工具类接口返回 **403**，body 含 `AGENT_API_DISABLED`

## 全局设置 JSON（`app_settings.value`）

```json
{
  "enabled": false,
  "entries": [
    { "accountId": "f175b442-…", "chatId": "1162433032" }
  ]
}
```

- `enabled`：全局开关
- `entries`：可跨多个 Telegram 账号；每项必须属于该账号的同步白名单，否则保存时会裁剪掉
- 开启但 `entries` 为空 → 工具返回空结果

配置 HTTP：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/agent/config` | 读取全局开关 + entries + 各账号可选会话（供 UI） |
| PUT | `/api/agent/config` | 写入全局配置。body: `{ "enabled": true, "accounts": [{ "accountId", "chatIds": [] }] }` 或 `{ "enabled", "entries": [{ "accountId", "chatId" }] }`。勾选变更会自动保存。 |

## 工具端点

均为 `POST`，`Content-Type: application/json`。可选：`accountIds?: string[]` 进一步过滤。

### POST `/api/agent/searchMessages`
### POST `/api/agent/retrieveContext`
### POST `/api/agent/getDialogs`
### POST `/api/agent/searchPhotos`
### POST `/api/agent/chatNote`

示例：

```bash
curl -sS -X POST 'http://<host>:3333/api/agent/getDialogs' \
  -H 'Content-Type: application/json' -d '{}'
```

## UI

AI 对话 → **大模型配置**：全局开关 + 按账号勾选同步白名单会话；**切换即自动保存**。
