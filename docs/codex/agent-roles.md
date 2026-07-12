# Codex agent roles

The role templates under `.codex/agents/` are version-controlled project
specifications. They are not proof that any installed Codex CLI automatically
loads project-local agents. Before relying on user-level role configuration,
run:

```bash
node scripts/codex/sync-agent-config.mjs --check
```

To explicitly copy the four canonical templates into `$CODEX_HOME/agents`
(`~/.codex/agents` by default), run:

```bash
node scripts/codex/sync-agent-config.mjs --apply
```

The script copies only `planner.toml`, `complex_implementer_high.toml`,
`complex_implementer_xhigh.toml`, and `test_rerunner.toml`. It never deletes
extra user agents. `--check` is read-only and exits non-zero when a canonical
file is missing or differs. Both modes reject symlinked canonical files and
paths outside the intended `CODEX_HOME/agents` directory.

`planner` uses `gpt-5.6-sol` / `medium` with a read-only sandbox and is the
sole producer of executable Goals for complex tasks. The parent may pass only
the user-requested output target to Planner. Complex implementation roles must
execute the persisted Goal and Gxx task they receive; they may not revise it.
The test rerunner is restricted to an exact preselected command.
