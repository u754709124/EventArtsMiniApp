# Codex 复杂任务规划与 Goal 生命周期

本项目把 Codex 编排分为 `SIMPLE` 与 `COMPLEX` 两类。此协议用于保留
Goal 的来源、验证过程和恢复边界；它不代表 Codex CLI 会自动发现
`.codex/agents/` 或自动创建 Planner/Goal。

## 门槛与角色

`SIMPLE` 仅指一个明确、局部、低风险且可直接套用现有模式的修改，例如
README 标题错别字。它由父代理直接处理，**绝不能**创建
`.codex/runtime/plans/` 目录。

跨模块、架构/数据流、公共契约、迁移、安全、并发、性能、兼容性、回滚或
有意义回归风险的请求是 `COMPLEX`。不确定时保守地归类为 `COMPLEX`。
它必须先交给只读 `planner`：`gpt-5.6-sol`、`medium` 推理强度。父代理
只能提交用户期望的输出目标；只有 Planner 可以产出可执行 Goal、范围、
验收标准、约束、非目标和 Gxx 顺序计划。

角色模板受版本控制于 `.codex/agents/`。安装的 CLI 是否自动加载项目模板
尚未被本项目验证；请明确同步并检查用户级副本：

```bash
node scripts/codex/sync-agent-config.mjs --check
node scripts/codex/sync-agent-config.mjs --apply
```

复杂实现只能执行已持久化的 Goal 和当前 Gxx，不能重新规划或修改 Goal。
同一时刻最多一个写入型 Agent；`test_rerunner` 只能执行父代理选定的原样
命令，不能选择策略或诊断失败。

## 初始化与 Planner 持久化

先把请求分类。分类器始终输出一行 JSON，未知情况会保守输出 `COMPLEX`：

```bash
pnpm codex:task:classify --request "修正 README 标题错别字" --affected-path README.md
pnpm codex:task:classify --request "修改 API 与小程序的数据流" --affected-path apps/api --affected-path apps/miniapp
```

仅当分类为 `COMPLEX` 时初始化任务。安全 task ID 只允许字母、数字和单个
连字符；重复 ID 被拒绝且不会覆盖已有目录。

```bash
pnpm codex:plan:init \
  --task-id 20260712T000000Z-example-plan \
  --classification COMPLEX \
  --title "示例复杂任务"
```

Planner 原文必须是普通文件而不是符号链接，并至少含有唯一的
`# EXECUTION GOAL` 和一个或多个唯一 `## Gxx` 标题。父代理先保存 Planner
返回的原文，再显式持久化：

```bash
pnpm codex:plan:persist \
  --task-id 20260712T000000Z-example-plan \
  --planner-output /absolute/path/planner-output.md
pnpm codex:plan:verify --task-id 20260712T000000Z-example-plan
```

持久化器逐字写入 `planner-output.md`，逐字提取 `goal.md` 和每个
`tasks/Gxx.md`，并在 `manifest.json` 记录 SHA-256。它不会覆盖已有的
不可变文件。根 revision 为 `0`；新 revision 位于 `revisions/rN/`，旧
revision 永不覆盖。

## 目录、manifest 与不可变性

运行期目录为 `.codex/runtime/plans/<task-id>/`，且被 Git 忽略。标准目录
包括：

```text
manifest.json                 # 可变运行状态真相
progress.md                   # 可变、简洁的恢复摘要
planner-output.md             # 不可变 Planner 原文
goal.md                       # 不可变 Planner Goal
tasks/Gxx.md                  # 不可变任务规格
handoffs/                     # 不可变 Planner handoff
results/Gxx-result.md         # 执行结果
revisions/rN/                 # 后续不可变 revision
```

`manifest.json` 包含任务 ID、分类、当前 revision/Goal、状态、Goal 前置关系、
hash、运行 Agent、结果、验证与完成记录。允许的文件引用固定为
`planner-output.md`、`goal.md`、`plan-index.md`、`decisions.md` 和
`progress.md`；路径逃逸、符号链接、缺文件、hash 不符、重复 Goal、任务集合
不符、非法 revision 或未满足前置关系都使校验以非零状态失败：

```bash
pnpm codex:plan:verify --task-id 20260712T000000Z-example-plan
```

Planner 原文、Goal、Gxx、Planner 决策、计划索引和 handoff 不可由父代理或
执行 Agent 改写。需要修改计划时，必须回到 Planner，创建新的 revision，
而非覆盖 revision 0。

## 委派与结果模板

父代理只传递文件引用和受限范围；执行 Agent 开始前必须读取 manifest、Goal、
计划索引、决策、progress、当前 Gxx 和 handoff。推荐的 handoff 内容如下：

```text
Task ID: <task-id>
Goal: <Gxx>
Role: <implementation|test>
Read first: manifest.json, goal.md, plan-index.md, decisions.md, progress.md,
            tasks/<Gxx>.md, handoffs/<Gxx>-<role>.md
Allowed write scope: <only the Gxx approved paths and results/Gxx-result.md>
Forbidden: immutable plan files, unrelated dirty files, new agents, commits
Return: concise status; write complete evidence to results/<Gxx>-result.md
```

状态和证据登记使用同一个脚本。以下命令均会原子更新 manifest 与简洁的
`progress.md`：

```bash
node scripts/codex/update-plan-state.mjs --action goal \
  --task-id 20260712T000000Z-example-plan --goal G01 --status in_progress
node scripts/codex/update-plan-state.mjs --action agent-start \
  --task-id 20260712T000000Z-example-plan --goal G01 \
  --agent-id implementation-001 --role complex_implementer_high
node scripts/codex/update-plan-state.mjs --action agent-finish \
  --task-id 20260712T000000Z-example-plan --agent-id implementation-001 --outcome passed
node scripts/codex/update-plan-state.mjs --action goal \
  --task-id 20260712T000000Z-example-plan --goal G01 --status passed
node scripts/codex/update-plan-state.mjs --action result \
  --task-id 20260712T000000Z-example-plan --goal G01 \
  --result results/G01-result.md --test-result "targeted tests passed"
node scripts/codex/update-plan-state.mjs --action verification \
  --task-id 20260712T000000Z-example-plan --name final --status passed \
  --command "pnpm test"
```

Goal 只能沿合法转换流转：`pending → in_progress → passed`，或进入
`blocked`/`failed`。开始或通过一个 Goal 前，它的所有前置 Goal 必须通过。
只能登记一个运行中的写入型 Agent；第二个 Agent 会被拒绝。结果必须在
Goal 通过后登记为已有的 `results/Gxx-result.md`，并附实际测试结果。

## Revision、恢复与清理

新 revision 必须遵循 Planner 决定。脚本要求显式确认，但该确认是流程门禁，
不是对 Planner 身份的密码学证明：

```bash
node scripts/codex/update-plan-state.mjs --action create-revision \
  --task-id 20260712T000000Z-example-plan --revision 1 --planner-approved
```

恢复不会猜测要继续哪个任务。一个候选可被查看；多个候选会停止并要求显式
选择 task ID：

```bash
node scripts/codex/update-plan-state.mjs --action recover
node scripts/codex/update-plan-state.mjs --action recover \
  --task-id 20260712T000000Z-example-plan
```

任务完成前需要所有 Goal 通过且有结果、没有运行 Agent、所有验证（含
`final`）通过，并登记一个仍存在的正式文档：

```bash
node scripts/codex/update-plan-state.mjs --action complete \
  --task-id 20260712T000000Z-example-plan \
  --documentation docs/codex/planning-and-goals.md
```

清理默认只演练。真实清理使用 `realpath`、任务 ID、直接子目录检查和
`fs.rm`，只能删除该任务自己的目录，绝不会删除 plans 根目录或其他任务：

```bash
node scripts/codex/cleanup-plan-run.mjs --task-id 20260712T000000Z-example-plan --dry-run
node scripts/codex/cleanup-plan-run.mjs --task-id 20260712T000000Z-example-plan --execute
```

未完成、失败、存在运行 Agent、缺少结果、验证失败/缺失、文档缺失、符号链接
或路径越界的任务都不能被清理，必须保留以便恢复或人工审查。

## CLI 限制

项目只验证了 `codex --strict-config --version` 可运行；未验证 CLI 自动发现
项目 Agent、列出项目 Agent 或自动生成/持久化 Goal。上述步骤因此全部由
项目规则和显式脚本完成。任何无法由脚本验证的 Codex 能力都不得在交接或
完成报告中宣称已经自动执行。
