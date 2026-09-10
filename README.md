# .harness

프로젝트 무관한 계약 관리 도구. 나중에 별도 저장소로 분리 예정.
프로젝트 고유 내용을 넣지 말 것 — MODULE.md·CLAUDE.md는 각 모듈 디렉토리에 남는다.

- MODULE-schema-v1.md — 계약 스키마 (v0는 히스토리용 보관)
- module-gate.mjs — 계약 게이트

`/module-draft` 커맨드는 Claude Code가 정한 경로라 `.claude/commands/` 에 둔다.
분리 시 플러그인이 커맨드를 제공하게 되면 그때 흡수한다.
