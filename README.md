# module-harness

디렉토리별 MODULE.md 계약을 커밋 시점에 판정하는 게이트. 프로젝트 무관한 도구이고,
프로젝트 고유 내용은 담지 않는다 — MODULE.md·CLAUDE.md 는 각 모듈 디렉토리에 남는다.

- MODULE.md·CLAUDE.md — 이 리포 자신의 계약 (슬러그 `harness`)
- MODULE-schema-v1.md — 계약 스키마. 계약을 쓸 때 읽는 규칙서
- module-gate.mjs — 게이트 (R0~R14)
- module-gate.test.mjs — 게이트 자신의 회귀 테스트. 어느 리포의 계약서도 입력으로 쓰지 않는다
- observations/ — 게이트를 실제로 돌려 보고 남긴 관찰. 규칙이 왜 생겼는지의 출처다

## 설치

```
npm i -D module-harness            # 레지스트리에 올린 뒤
npm i -D github:shanash/module-harness#<tag>
npm i -D file:../module-harness    # 로컬 개발
```

설치한 리포는 계약서에서 이 패키지를 `in [[harness]] … (외부: module-harness)` 로 인용한다 (R14).
게이트는 `node_modules/` 를 걷지 않으므로 이 패키지의 계약서는 소비 리포의 판정 대상이 아니다 —
그쪽 계약은 이 리포에서 판정된다.

## 실행

```
npx module-gate                  # 작업 트리 vs HEAD
npx module-gate --staged         # 인덱스만 (pre-commit)
npx module-gate --base origin/main
npx module-gate --fix            # R12 근거 경로 자동 정정
npx module-gate --audit          # diff 무관: 인용 줄이 실물을 가리키는지 전수 대조
npx module-gate --json           # 같은 판정을 기계 판독 형태로 (stdout 전용)
npx module-gate --scope <경로>... # 판정 안 함: 그 경로를 고치려면 읽어야 할 계약
npm test                         # 회귀 테스트 52개, ~37초
```

의존은 node 표준 라이브러리와 `git` CLI 뿐이다. 종료 코드로만 말한다 — FAIL 이 하나라도 있으면 1.
`--json` 도 마찬가지다. 봉투의 `fail` 은 종료 코드와 같은 말이고, 그것이 부르는 쪽이 판정을 다시
내리지 못하게 막는 유일한 장치다.

커밋 경로가 둘이면 모드가 다르다는 것을 기억할 것. pre-commit 훅은 `--staged` 로 인덱스만 보고,
러너(AlMandu PreToolUse 등)에서 부르면 대개 작업 트리 모드다 — 스테이지하지 않은 `status: active`
모듈의 소스 수정이, 그 수정을 담지 않은 커밋을 후자에서 FAIL 시킨다.

## 어댑터가 실제로 로드되는 경로 (2026-09-11 확인, Claude Code 기준)

MODULE.md 는 스스로 실리지 않는다. 같은 디렉토리의 CLAUDE.md 가 `@MODULE.md` 로 끌어올 때만 실리고,
그 CLAUDE.md 가 언제 실리는지는 파일에 닿는 방법에 달렸다.

| 파일에 닿는 방법 | 어댑터 |
|---|---|
| Read | 조상 체인 전부 실린다 — 깊은 파일 하나를 열면 부모 계약까지 함께 온다 |
| Bash (`cat`·`head`·`sed`·`grep`) | 안 실린다 |
| Write (신규 파일) | 안 실린다 |

계약을 모르는 채로 코드를 고칠 구멍이 둘 있다는 뜻이다. 게이트는 커밋 시점에만 서 있으므로
그 사이를 막는 것은 루트 CLAUDE.md 의 "파일을 고치기 전에 그 파일을 소유한 가장 깊은 MODULE.md 를
읽는다" 한 줄뿐이다 — 자동 로드가 아니라 사람과 에이전트의 습관에 기대고 있다. 어댑터 문구를
바이트 단위로 같게 유지하는 이유도 이것이다. 로드되는 자리마다 같은 문장이 와야 한다.

`--scope` 는 그 습관을 기계로 옮기기 위한 표면이다 — 어느 계약을 열어야 하는지를 게이트가 답한다.
부르는 쪽이 `loop/` 다.

## 루프 — 변경을 계약 앞에 세운다

```
node loop/loop.mjs scope <경로>...     # 소유 계약을 깊은 것부터 내고 기준선을 잡는다
                                       # → 그 목록을 Read 로 연다 (cat 으로 열면 어댑터가 안 실린다)
node loop/loop.mjs reconcile           # 재판정. 기준선에 없던 것만 "신규" 로 센다
node loop/loop.mjs commit -m "<제목>" --contract "<계약 갱신 한 줄>"
node loop/loop.mjs status | abort
```

`commit` 은 두 가지를 거부한다 — **scope 를 지나지 않은 경로가 묶음에 있을 때**(그 계약이 한 번도
적재되지 않았다는 뜻이다), 그리고 **active 계약이 묶음에 있는데 `계약:` 줄이 없을 때**. 후자는
R1 이 코드와 계약을 한 커밋에 묶기 때문이다: 쪼갤 수 없으니 메시지가 대신 나눠 적는다.

판정은 하지 않는다. 게이트를 부르는 명령은 게이트의 종료 코드를 그대로 낸다 — 루프가 JSON 을 읽고
스스로 통과를 선언할 자리는 없다. 기준선은 `.git/module-loop/` 안에서만 살고 HEAD 와 게이트 소스
해시로 봉인되어, 둘 중 하나라도 움직이면 세션을 거부한다.

루프는 아직 패키지에 실리지 않는다 (`files` 화이트리스트 밖). 첫 소비자가 이 리포 자신이다.
