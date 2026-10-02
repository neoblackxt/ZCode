# 会话标题（session title）规则

## 行为

- 标题来源（`SessionTitleSource`）共四种，优先级从低到高：`default` → `first_input` → `generated` → `custom`。
- 首条用户消息（`turnNumber === 0`，含首条 query 落库后的并发窗口）触发标题生成 sidecar，
  写回时带 `expectedTitleSources: [default, first_input, generated]` 乐观锁；`turnNumber > 0`
  后不再有新的标题生成（resume 会从历史消息重建 `turnNumber`，不会归零）。
- 用户手动重命名（`setCustomSessionTitle`）无条件生效，置 `titleSource = custom`。
- `custom` 标题对 generated 写回免疫：sidecar 落库前与写回时都会检查并跳过。

## CronCreate 后的标题冻结（automation freeze）

- 所有者：`core/runtime/methods/session-title.ts#freezeSessionTitleForAutomation`。
  端口层（`bootstrap/zcode-protocol/automation-port.ts`）只调用，不自行判断标题来源。
- 目的：会话首轮回复中创建 automation 时，抢占可能迟到写回的标题生成 sidecar，
  避免标题被生成成“我无法...”之类的内容。
- 不变量：冻结仅当当前 `titleSource ∈ {default, first_input}`（sidecar 可能尚未写回）时生效；
  `custom`（用户已手动命名）与 `generated`（sidecar 已完成，且该会话不会再有标题生成）
  必须跳过，否则任务中途每次新增 automation 都会改写既有任务名。
- 失败语义：冻结读会话失败时静默跳过（无会话可保护）；写回失败由调用方记
  `automation.session_title_freeze.failed`，不影响 CronCreate 结果。

## 验收场景

1. 首轮消息中 CronCreate（标题仍为 `first_input`）→ 标题冻结为 automation 标题，
   迟到的 sidecar 被拒（custom 短路）。
2. 会话中途（标题为 `generated`）CronCreate → 任务名不变。
3. 用户手动命名（`custom`）后 CronCreate → 任务名不变。
4. 同一会话先后创建多个 automation → 任务名不随最新 automation 标题反复变化。
