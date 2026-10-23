<!--
Title: Conventional Commits, e.g. "fix(helper): keep clicks in order after a cancelled wheel". It becomes the squashed commit.
标题请用 Conventional Commits 格式，例如 "fix(helper): keep clicks in order after a cancelled wheel"，它会成为合并后的提交信息。
Read AGENTS.md first, and give it to your AI agent if you use one. 请先阅读 AGENTS.md；如果使用 AI 工具，请让它也读取。
-->

Fixes #

## What and why

<!-- What changes for the user, and why. A few sentences. -->

## How I tested it

<!-- Commands you ran, and what you did by hand in the real app. -->

Ran by hand on:
- [ ] Windows 11
- [ ] macOS (Apple Silicon)

## Checklist

- [ ] `npm run typecheck`, `npm run test:helper` and `npm test` pass
- [ ] New logic has tests; a bug fix has a test that fails without it, or I explained why it can't
- [ ] User-facing text is in both English and Chinese (`src/shared/i18n.ts`, both READMEs)
- [ ] `docs/design.md` is updated if the behaviour it describes changed
- [ ] Screenshot attached if something visible changed
- [ ] If I used an AI tool, it had `AGENTS.md` in context and I read the whole diff. Tool: <!-- e.g. Claude Code, Codex, Cursor -->
