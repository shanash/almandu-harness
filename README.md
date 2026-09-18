# almandu-harness
(0.6.0 까지 이름은 `module-harness` 였다 — 이름 변경 절)

디렉토리별 MODULE.md 계약을 커밋 시점에 판정하는 게이트. 프로젝트 무관한 도구이고,
프로젝트 고유 내용은 담지 않는다 — MODULE.md·CLAUDE.md 는 각 모듈 디렉토리에 남는다.

- MODULE.md·CLAUDE.md — 이 리포 자신의 계약 (슬러그 `harness`)
- MODULE-schema-v1.md — 계약 스키마. 계약을 쓸 때 읽는 규칙서
- module-gate.mjs — 게이트 (R0~R14)
- module-gate.test.mjs — 게이트 자신의 회귀 테스트. 어느 리포의 계약서도 입력으로 쓰지 않는다
- module-harness-init.mjs — 소비 리포에 훅·계약 문단·어댑터를 놓는 설치 도구
- loop/ — 변경을 계약 앞에 세우는 루프 (0.6.0 부터 `loop.mjs` 가 bin `almandu-module-loop` 으로 패키지에 실린다)
- review/personas/ — 리뷰 패킷 하나에 답 하나를 내는 질문 프롬프트 (패키지에 실린다)
- observations/ — 게이트를 실제로 돌려 보고 남긴 관찰. 규칙이 왜 생겼는지의 출처다

## 설치

```
npm i -D almandu-harness           # 레지스트리에 올린 뒤
npm i -D github:shanash/almandu-harness#<tag>   # 비공개 리포 — 설치하는 머신에 GitHub SSH 키가 있어야 한다
npm i -D file:../module-harness    # 로컬 개발
```

npm 12 부터 git 의존은 기본으로 막힌다 — 태그로 설치하는 소비 리포는 `.npmrc` 에 `allow-git=root` 를 둔다.

설치한 리포는 계약서에서 이 패키지를 `in [[harness]] … (외부: almandu-harness)` 로 인용한다 (R14).
게이트는 `node_modules/` 를 걷지 않으므로 이 패키지의 계약서는 소비 리포의 판정 대상이 아니다 —
그쪽 계약은 이 리포에서 판정된다.

리포는 비공개다 — 설치하는 머신마다 GitHub SSH 키(또는 토큰)가 있어야 한다.

설치한 뒤 한 번 돌린다:

```
npx --no-install almandu-harness-init --dry-run   # 무엇을 놓을지 먼저 본다
npx --no-install almandu-harness-init
```

셋을 놓는다 — `.githooks/pre-commit`(+ `core.hooksPath`), 루트 CLAUDE.md 의 계약 문단,
MODULE.md 가 있는데 CLAUDE.md 가 없는 디렉토리의 어댑터. 이미 있는 파일은 덮어쓰지 않고,
이미 있는 CLAUDE.md 에는 어댑터를 맨 앞에 얹는다. 두 번 돌려도 같은 상태다.

어댑터 문구는 `MODULE-schema-v1.md` 에서 읽어 쓴다 — 설치 도구 안에 사본을 두지 않는다.
"로드되는 자리마다 같은 문장이 와야 한다" 가 약속이 아니라 구조인 자리다.

## 실행

```
npx --no-install almandu-module-gate                     # 작업 트리 vs HEAD
npx --no-install almandu-module-gate --staged            # 인덱스만 (pre-commit)
npx --no-install almandu-module-gate --base origin/main
npx --no-install almandu-module-gate --fix               # R12 근거 경로 자동 정정
npx --no-install almandu-module-gate --audit             # diff 무관: 인용 줄이 실물을 가리키는지 전수 대조
npx --no-install almandu-module-gate --json              # 같은 판정을 기계 판독 형태로 (stdout 전용)
npx --no-install almandu-module-gate --scope <경로>...   # 판정 안 함: 그 경로를 고치려면 읽어야 할 계약
npx --no-install almandu-module-gate --review            # 판정 안 함: 이 diff 를 리뷰할 때 봐야 할 불변식과 그 태그
npm test                                                 # 회귀 테스트 85개, ~75초
```

`--no-install` 은 뺄 수 없다 — `almandu-*` 이름은 npm 에 올라가 있지 않아서, 로컬 설치가 없는 머신에서 맨 `npx` 는
레지스트리로 넘어가 같은 이름으로 선점된 남의 패키지를 받아 실행할 수 있다.

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
node loop/loop.mjs review              # 태그가 정한 리뷰어를 돌린다 ([테스트]→테스트, [grep]→R13)
node loop/loop.mjs commit -m "<제목>" --contract "<계약 갱신 한 줄>"
node loop/loop.mjs status | abort
```

`commit` 은 두 가지를 거부한다 — **scope 를 지나지 않은 경로가 묶음에 있을 때**(그 계약이 한 번도
적재되지 않았다는 뜻이다), 그리고 **active 계약이 묶음에 있는데 `계약:` 줄이 없을 때**. 후자는
R1 이 코드와 계약을 한 커밋에 묶기 때문이다: 쪼갤 수 없으니 메시지가 대신 나눠 적는다.

판정은 하지 않는다. 게이트를 부르는 명령은 게이트의 종료 코드를 그대로 낸다 — 루프가 JSON 을 읽고
스스로 통과를 선언할 자리는 없다. 기준선은 `.git/module-loop/` 안에서만 살고 HEAD 와 게이트 소스
해시로 봉인되어, 둘 중 하나라도 움직이면 세션을 거부한다.

소비 리포에서는 `npx --no-install almandu-module-loop <명령>` 으로 같은 CLI 를 부른다 (0.6.0 부터, 0.7.0 부터 이 이름). 명령·플래그·종료 코드·트레일러 형식은 공개 표면이라 DESIGN.md 7절 버전 표를 따른다. 페르소나는 `node_modules/almandu-harness/review/personas/` 에 실린다. 리뷰 커맨드(`.claude/commands/module-review.md`)는 경로가 리포마다 달라 싣지 않는다 — 소비 리포가 사본을 두고 그 출처 줄이 이 리포와 태그를 가리킨다.

## 이름 변경 (0.7.0)

0.7.0 에서 패키지 이름이 `module-harness` 에서 `almandu-harness` 로 바뀌었다. `almandu-*` 가 정식 이름이고
옛 bin 이름 셋은 같은 파일을 가리키는 별칭으로 남았다 — 이미 놓인 훅이 옛 이름을 부르기 때문이다.

| 표면 | 0.6.0 까지 | 0.7.0 부터 |
|---|---|---|
| 패키지 / 설치 자리 | `module-harness` / `node_modules/module-harness/` | `almandu-harness` / `node_modules/almandu-harness/` (별칭 없음) |
| 게이트 bin | `module-gate` | `almandu-module-gate` (+ 별칭 `module-gate`) |
| 설치 도구 bin | `module-harness-init` | `almandu-harness-init` (+ 별칭 `module-harness-init`) |
| 루프 bin | `module-loop` | `almandu-module-loop` (+ 별칭 `module-loop`) |
| R14 표지 | `(외부: module-harness)` | `(외부: almandu-harness)` |

바뀌지 않은 것: 파일 이름(`module-gate.mjs`·`module-harness-init.mjs`·`loop/loop.mjs`), 게이트 출력 접두사
(`module-gate:`), 루프 상태 디렉토리(`.git/module-loop/`), `MODULE_GATE`, 플래그·종료 코드·트레일러 형식.
옛 이력과 `observations/` 의 `module-harness` 는 당시의 이름이라 고치지 않는다.
GitHub 리포 이름도 `shanash/almandu-harness` 로 바뀌었다 — 옛 이름은 넘겨 받지 못하므로 설치 문자열은 새 이름으로 쓴다.

소비 리포에서 옮길 것 — 패키지 이름에는 별칭이 없으므로 아래는 **한 커밋**이어야 한다
(R14 는 표지를 설치 목록과 대조하므로 표지와 설치가 따로 움직이면 FAIL 이다):

1. `package.json` 의 의존 키를 `almandu-harness` 로 바꾸고 다시 설치한다 — `node_modules/almandu-harness` 가 생기고 `.bin` 에 bin 여섯이 놓인다
2. `node_modules/module-harness/…` 를 가리키는 경로(pre-commit 훅, `am-gate.json`, 커맨드, CLAUDE.md)를 `node_modules/almandu-harness/…` 로 옮긴다 — 파일 이름은 그대로라 디렉토리 부분만 바뀐다
3. `observations/` 를 읽는 스크립트의 경로도 옮긴다. `.git/module-loop/` 는 그대로 둔다 — 옮기면 결과 파일이 없다고 읽혀 조용히 통과한다
4. 계약서의 R14 표지를 `(외부: almandu-harness)` 로 바꾸고 그 계약서 이력에 한 줄을 남긴다
5. `node node_modules/almandu-harness/module-gate.mjs --staged` 가 OK 이고 `git grep "node_modules/module-harness"` 가 비었는지 확인한다
