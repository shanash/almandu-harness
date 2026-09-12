# .harness

프로젝트 무관한 계약 관리 도구. 나중에 별도 저장소로 분리 예정.
프로젝트 고유 내용을 넣지 말 것 — MODULE.md·CLAUDE.md는 각 모듈 디렉토리에 남는다.

- MODULE-schema-v1.md — 계약 스키마 (v0는 히스토리용 보관)
- module-gate.mjs — 계약 게이트
- module-gate.test.mjs — 게이트 자신의 회귀 테스트 (이 리포의 계약서를 입력으로 쓰지 않는다)
- observations/ — 게이트를 실제로 돌려 보고 남긴 관찰. 규칙이 왜 생겼는지의 출처다.
  작업 로그가 아니므로 여기 있다 — 그쪽은 `.am/` 이고 gitignored 다

`/module-draft` 커맨드는 Claude Code가 정한 경로라 `.claude/commands/` 에 둔다.
분리 시 플러그인이 커맨드를 제공하게 되면 그때 흡수한다.

## 실행

```
node .harness/module-gate.mjs               # 작업 트리 vs HEAD
node .harness/module-gate.mjs --staged      # 인덱스만
node .harness/module-gate.mjs --base origin/main
node .harness/module-gate.mjs --fix         # R12 근거 경로 자동 정정
node .harness/module-gate.mjs --audit       # diff 무관: 인용 줄이 실물을 가리키는지 전수 대조
node --test .harness/module-gate.test.mjs   # 회귀 테스트 12개, ~9초
```

커밋 경로는 둘이고 모드가 다르다. 터미널 커밋은 `tools/git-hooks/pre-commit` 이 `--staged` 로
부르고(`git config core.hooksPath tools/git-hooks`), Claude Code 의 커밋은 AlMandu PreToolUse 훅이
`am-gate.json` 의 module-gate 커맨드로 부르는데 그쪽은 작업 트리 모드다. 그래서 스테이지하지 않은
`status: active` 모듈의 소스 수정이, 그 수정을 담지 않은 커밋을 후자에서 FAIL 시킨다.

## 어댑터가 실제로 로드되는 경로 (2026-09-11 확인)

MODULE.md 는 스스로 실리지 않는다. 같은 디렉토리의 CLAUDE.md 가 `@MODULE.md` 로 끌어올 때만 실리고,
그 CLAUDE.md 가 언제 실리는지는 파일에 닿는 방법에 달렸다.

| 파일에 닿는 방법 | 어댑터 |
|---|---|
| Read | 조상 체인 전부 실린다 — Engine 파일 하나를 열면 restored-project 와 engine 계약이 둘 다 온다 |
| Bash (`cat`·`head`·`sed`·`grep`) | 안 실린다 |
| Write (신규 파일) | 안 실린다 |

계약을 모르는 채로 코드를 고칠 구멍이 둘 있다는 뜻이다. 게이트는 커밋 시점에만 서 있으므로
그 사이를 막는 것은 루트 CLAUDE.md 의 "파일을 고치기 전에 그 파일을 소유한 가장 깊은 MODULE.md 를
읽는다" 한 줄뿐이다 — 자동 로드가 아니라 사람과 에이전트의 습관에 기대고 있다. 어댑터 5개의
문구를 바이트 단위로 같게 유지하는 이유도 이것이다. 로드되는 자리마다 같은 문장이 와야 한다.
