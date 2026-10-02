import assert from "node:assert/strict";
import test from "node:test";
import { freezeSessionTitleForAutomation } from "../src/runtime/methods/session-title.js";

interface SessionSnapshot {
  title: string;
  titleSource: "default" | "first_input" | "generated" | "custom";
}

interface RuntimeHarness {
  appendedEvents: Array<{ payload: unknown; type: unknown }>;
  debugLogs: Array<{ event?: string; reason?: string }>;
  runtime: unknown;
  updateSessionCalls: Array<Record<string, unknown>>;
}

// freezeSessionTitleForAutomation 只依赖 AgentRuntimeInternal 的少数字段；
// 用最小 mock 隔离验证「是否冻结」的判定，不拉起真实 session store。
function createRuntimeHarness(session: SessionSnapshot | undefined): RuntimeHarness {
  const updateSessionCalls: Array<Record<string, unknown>> = [];
  const appendedEvents: Array<{ payload: unknown; type: unknown }> = [];
  const debugLogs: Array<{ event?: string; reason?: string }> = [];
  const runtime = {
    sessionId: "sess_title_freeze_test",
    logger: {
      debug: (_message: string, context: { event?: string; reason?: string }) => {
        debugLogs.push(context);
      },
    },
    sessionStore: {
      getSession: async () => session,
      updateSession: async (patch: Record<string, unknown>) => {
        updateSessionCalls.push(patch);
        return { ...session, ...patch };
      },
    },
    createEvent: (type: unknown, payload: unknown) => ({ payload, type }),
    appendEvent: async (event: { payload: unknown; type: unknown }) => {
      appendedEvents.push(event);
    },
  };
  return { appendedEvents, debugLogs, runtime, updateSessionCalls };
}

const traceContext = {} as never;

async function freeze(runtime: unknown, title: string): Promise<void> {
  await (
    freezeSessionTitleForAutomation as unknown as (
      this: unknown,
      input: { title: string; traceContext: unknown },
    ) => Promise<void>
  ).call(runtime, { title, traceContext });
}

test("titleSource=first_input 时冻结为 automation 标题（抢占首轮迟到的 sidecar）", async () => {
  const harness = createRuntimeHarness({ title: "加载技能更新数据", titleSource: "first_input" });
  await freeze(harness.runtime, "每15分钟巡检数据更新任务");
  assert.equal(harness.updateSessionCalls.length, 1);
  assert.equal(harness.updateSessionCalls[0]?.title, "每15分钟巡检数据更新任务");
  assert.equal(harness.updateSessionCalls[0]?.titleSource, "custom");
  assert.equal(harness.appendedEvents.length, 1);
});

test("titleSource=default 时冻结为 automation 标题", async () => {
  const harness = createRuntimeHarness({ title: "", titleSource: "default" });
  await freeze(harness.runtime, "巡检任务");
  assert.equal(harness.updateSessionCalls.length, 1);
  assert.equal(harness.updateSessionCalls[0]?.titleSource, "custom");
});

test("titleSource=custom（用户手动命名）时跳过冻结，不改写任务名", async () => {
  const harness = createRuntimeHarness({ title: "非流动性", titleSource: "custom" });
  await freeze(harness.runtime, "illiquidity watchdog");
  assert.equal(harness.updateSessionCalls.length, 0);
  assert.equal(harness.appendedEvents.length, 0);
  assert.equal(harness.debugLogs[0]?.event, "automation.session_title_freeze.skipped");
});

test("titleSource=generated（sidecar 已完成）时跳过冻结，任务中途 CronCreate 不再反复改名", async () => {
  const harness = createRuntimeHarness({ title: "聪明钱", titleSource: "generated" });
  await freeze(harness.runtime, "聪明钱 stage2 watchdog");
  assert.equal(harness.updateSessionCalls.length, 0);
  assert.equal(harness.debugLogs[0]?.reason, "title_source_generated");
});

test("会话不存在时静默跳过，不抛错", async () => {
  const harness = createRuntimeHarness(undefined);
  await freeze(harness.runtime, "任意标题");
  assert.equal(harness.updateSessionCalls.length, 0);
  assert.equal(harness.appendedEvents.length, 0);
});
