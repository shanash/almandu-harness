---
module: harness
path: .harness
schema: 1
status: draft
watch: .mjs,MODULE-schema-v1.md
---

## 책임
MODULE.md 계약 체계 자체를 소유한다 — 스키마(`MODULE-schema-v1.md`), 커밋 때 계약을 판정하는 게이트(`module-gate.mjs`), 게이트 자신의 회귀 테스트(`module-gate.test.mjs`), 그리고 게이트를 실제로 돌려 보고 남긴 관찰(`observations/`).
`observations/` 의 자리가 이 계약의 경계선이다 — 일회성 작업 로그는 `.am/`(gitignored)에 있고, 여기 있는 것은 규칙이 왜 생겼는지의 유일한 출처라 재생성되지 않는다. 그래서 계약서와 같은 급이고 이 디렉토리가 분리될 때 하네스를 따라간다.
프로젝트 고유 규칙은 담지 않는다 — 각 디렉토리의 MODULE.md·CLAUDE.md 는 그 디렉토리에 남고, 커밋을 실제로 막는 훅은 [[tools]] 에 있다. 이 디렉토리는 판정만 하고 차단은 종료 코드로 넘긴다.

## 진입점
- `node .harness/module-gate.mjs [--staged|--base <ref>|--fix|--audit]` — .harness/module-gate.mjs:495,499 (판정 결과를 종료 코드로 낸다)
- `node --test .harness/module-gate.test.mjs` — .harness/module-gate.test.mjs:16 (게이트의 회귀 테스트 39개)
- `.harness/MODULE-schema-v1.md` — 사람과 에이전트가 계약을 쓸 때 읽는 규칙서

## 의존
### in (이 모듈이 쓰는 것)
- 없음. node 표준 라이브러리 세 모듈과 `git` CLI 만 쓴다 — 설치할 의존이 없어 어느 클론에서나 그대로 돈다 (.harness/module-gate.mjs:9-11)
### out (이 모듈을 쓰는 것)
- [[tools]] — pre-commit 이 `node .harness/module-gate.mjs --staged` 를 돌리고 그 종료 코드로 커밋을 막는다 (tools/git-hooks/pre-commit:95-106)

## 불변식
- I1. 판정 수준은 `status` 로만 갈린다 — `active` 는 FAIL, 그 외는 WARN 으로 강등된다. 예외는 R3 의 모듈 후보 경고 하나로 언제나 WARN 이다 (근거: .harness/module-gate.mjs:220-221,310-312, .harness/module-gate.test.mjs:126,551) [테스트]
- I2. 차단 수단은 종료 코드뿐이다 — FAIL 이 하나라도 있으면 1, 없으면 0 이고 WARN 은 0 이다 (근거: .harness/module-gate.mjs:495,499, tools/git-hooks/pre-commit:95-106) [grep]
- I3. 회귀 테스트는 이 리포의 계약서를 입력으로 쓰지 않는다 — 임시 git 저장소에 fixture 를 세워 돌리므로 계약서가 바뀌어도 테스트는 그대로다 (근거: .harness/module-gate.test.mjs:5-7,16) [테스트]
- I4. 게이트는 외부 의존 없이 돈다 — import 는 node 표준 세 줄이고 나머지는 `git` 서브프로세스다 (근거: .harness/module-gate.mjs:9-11, 재현: .harness/module-gate.mjs 에서 `from 'node:` 3건) [grep]
- I5. 게이트는 자기 판단을 파일에 쓰지 않는다 — 유일한 쓰기는 `--fix` 의 근거 경로 정정이고 그것도 `근거:` 가 있는 줄만 건드린다 (근거: .harness/module-gate.mjs:477-481,488) [리뷰]

## 미결
- 분리하면 `[[harness]]` 슬러그가 리포 밖을 가리킨다. tools/MODULE.md 가 이미 `in [[harness]]` 를 선언하는데 이 디렉토리가 별도 저장소로 나가면 그 대상이 이 리포에 없고, R12 는 근거 경로를 리포 루트 기준으로 강제한다 — 스키마는 리포 밖 모듈을 계약서가 어떻게 인용하는지 아무 말도 하지 않는다. 필드를 더하지 않고 푸는 방법이 정해져야 분리가 된다 (3개월 동결)
- R13 의 비용은 건수가 아니라 범위 폭이다 (2026-09-12 실측: 모듈 디렉토리 범위 25회 0.19s, `restored-project/Assets` 트리 범위 25회 3.2s). 예산을 64 로 올렸지만 통제는 "범위는 경로 하나" 규칙이 맡는다 — 트리 범위 주장이 여럿 생기면 그 규칙을 좁힐지 미결이고, 지금 그런 주장은 gameplay I2 하나다
- R2(계약이 바뀌면 이력 항목 추가)와 R4(80줄)가 서로를 민다 — 이력은 줄 수 없고 파일은 늘 수 없으므로 오래된 계약서는 변경할 때마다 다른 칸을 줄여야 한다. engine 이 2026-09-12 에 그 상태에 처음 닿았다. 이력을 줄 수에서 빼는 것은 필드 추가가 아니므로 동결에 걸리지 않는다
- `watch` 에 `.md` 는 `MODULE-schema-v1.md` 하나만 들어 있다 — README.md 와 `observations/` 는 R1 밖이다. 의도한 것이지만(관찰은 규칙이 아니라 증거다) 스키마가 바뀌는 커밋만 이 계약서를 함께 요구한다는 뜻이라 관찰 기록의 유실은 아무도 잡지 않는다
- 게이트가 자기 계약을 판정한다 — 이 계약서를 어기는 게이트 변경을 그 게이트가 잡을 수 있는지는 순환이고, fixture 테스트가 그 순환을 끊는 유일한 수단이다. 자기 판정의 사각지대 목록은 없다
- `MODULE-schema-v0.md` 는 히스토리용 보관이고 어느 규칙도 이 파일을 읽지 않는다 — 분리할 때 함께 옮길지 버릴지 미결

## 이력
- 2026-09-12 R13 의 grep 예산을 24 → 64 로 올린다. 오늘 editor 계약서를 세우다 24 에 닿아 주장이 조용히 안 세어졌는데, 실측해 보니 비용은 건수가 아니라 범위 폭이었다 — 모듈 범위 25회가 0.19s, Assets 트리 범위 25회가 3.2s 다. 예산으로 막을 것이 아니라 범위를 좁히는 규칙이 비용을 통제한다. 예산 초과 경고 자체는 테스트로 고정했다 (70개 주장 픽스처)
- 2026-09-12 `--audit` 를 만든다 — diff 를 보지 않고 인용 줄이 지금 무엇을 담고 있는지만 전수로 묻는다 (파일 끝을 넘었는지, 범위가 통째로 빈 줄·중괄호뿐인지). R11(b) 가 한 diff 의 hunk 만 보는 한계를 덮는 별도 수단이고, 평소 판정에는 섞이지 않는다. 처음 돌리자 이 리포에서 3건이 나왔다 — 이 계약서 자신의 둘과 engine I2 의 `LeScript.cs:252`(내 작업과 무관하게 전부터 밀려 있던 것)
- 2026-09-12 확장자 없는 근거 인용을 R6·R8·R11·R12 의 눈에 들인다. 경로 조각이 둘 이상이고 리포 루트 기준으로 실재하는 **파일**인 토큰만 줍는다 — 디렉토리와 메뉴 경로(`KoD/Addressables/Setup Infra`)는 떨어지고, 확장자 없는 토큰의 해석 실패는 조용하다(파일 인용이라는 표시가 없으므로 R12 로 고발하지 않는다). tools I8 의 `tools/git-hooks/pre-commit` 과 이 계약서 I2 의 같은 인용이 처음으로 추적된다. 규칙을 켜자 R11(b) 가 이 커밋의 게이트 수정으로 밀린 자기 인용 4건을 잡았고 그 줄번호를 같은 커밋에서 고쳤다
- 2026-09-12 최초 작성 (Claude Code 초안, 검토 전). 스키마 미결의 결정 줄("`책임` 칸에 `observations/` 의 위치를 적는다")을 이 파일이 이행했으므로 그쪽 줄은 삭제됐다
