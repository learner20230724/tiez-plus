# Plus 协议 v1

## 发现、注册与身份

Broker 自动生成持久化 `instanceId`、`desktopId`；手机为该实例保存独立设备 ID/token 到 SecureStore。

- DNS-SD：`_tiezplus._tcp`，端口是 HTTP/WS 监听端口。TXT 仅含版本与实例/设备 ID。
- UDP 18084 请求：`{"type":"tiezplus.discover","v":1,"nonce":"<UUID>"}`；响应回显 nonce，含产品、名称、实例和连接参数，不含正文/token。
- `GET /api/v1/info` 获取实际端口；`POST /api/v1/enroll` 在可信 LAN 自动注册。desktop 角色仅 loopback 可注册；已有手机身份必须提供原 token，不能静默接管。
- MQTT TCP 18883 仅 loopback；手机走 LAN `ws://<host>:<httpPort>/mqtt`。clientId/username 均为设备 ID，password 是自动生成 32 字节随机 token。
- ACL 限制手机仅向该实例的指定电脑发请求、订阅自己的响应及电脑 presence。正文和请求一律 non-retained/QoS 1。

## 主题

```
tiezplus/v1/<instanceId>/request/<desktopId>
tiezplus/v1/<instanceId>/response/<mobileId>
tiezplus/v1/<instanceId>/presence/<desktopId>
```

请求公共字段：`v, id, requestId, from, to, type`。`id` 是稳定业务消息 ID，`requestId` 是每次请求的关联 ID；重试正文的 id 不变、requestId 必须新建。

| type | 请求附加字段 | 响应 |
| --- | --- | --- |
| ping | 无 | `ok: true`，应用层就绪而非 Broker 连通性 |
| send_text | `content` 完整原文 | `status` 与可选 `error` |
| delivery_status | 使用原消息 `id`，不含正文 | `delivered/stored/copy_failed/unknown/not_found` |
| get_current | 无 | `ok,content,timestamp` 或错误，实时读系统剪贴板 |
| get_history | `limit:50` | `ok,entries:[{id,preview,timestamp,content_type}]` |
| get_content | `entryId` | `ok,content` 或明确的已删除/受保护/超限错误 |

响应回显 `id/requestId`，`type:"response"`，交换 `from/to`。接收方必须验证版本、设备、ID 和关联；Broker 的 PUBACK **不**是应用回执。presence 可以 retained，正文不可 retained。

## 持久化与故障语义

手机 SQLite WAL/FULL 保存草稿和发件箱；发件事务提交后才 publish。成功回执按目标身份匹配，状态 delivered 单调不回退。草稿清除比较原草稿版本和全文；编辑中的新版本不被清空。编辑器与落盘清除版本碰撞时保留编辑器内容。

电脑 SQLite `plus_receipts` 主键是 `(sender,message_id)`，保存正文 SHA-256、DPAPI 加密全文、历史条目 ID、处理状态。首次 receipt 与完整历史插入在同一事务。

```
stored → applying → delivered
                  → copy_failed
崩溃重启：applying → unknown
```

`delivered`/`unknown` 的重复请求只返回已知结果，不再次写剪贴板。`stored/copy_failed` 允许用户手动同 ID 重试；内容哈希不同的同 ID 请求拒绝。电脑绝不根据超时推断自己未收到。

手机等待最多 10 秒，超时为 unconfirmed；晚到的有效回执仍更新历史。恢复连接只恢复订阅、探测、状态查询，不恢复正文发送队列。新的 MQTT 客户端使用 clean session、关闭 reconnectPeriod/resubscribe/offline queue。

单条文本 UTF-8 1 MiB；JSON 报文上限 7 MiB，允许控制字符 JSON 转义扩展。远程列表预览是 200 字符；不得用它代替 `get_content`。日志仅记录事件/错误码/长度，不记录正文/token。
