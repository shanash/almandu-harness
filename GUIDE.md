# 소비 리포 작업 가이드

almandu-harness 를 설치한 리포에서 변경 하나를 계약 앞에 세워 커밋까지 가져가는 절차다.
규칙의 정의는 `MODULE-schema-v1.md`, 도구의 표면은 `README.md` 가 갖는다 — 이 문서는 그 둘을 **작업 순서**로 다시 놓은 것이고, 둘과 어긋나면 그쪽이 맞다.
이 문서는 패키지에 실리지 않는다 — 하네스 리포에서 읽는다.

명령은 전부 소비 리포 루트에서 부른다 — 그래서 아래 예시는 **상대 경로**다. cwd 를 보장할 수 없는 자리(에이전트가 부르는 `.claude/commands/` 커맨드 등)는 절대 경로를 쓴다 (README 설치 절의 경로 형태 표). 0.9.0 기준이다.

---

## 0. 설치가 제대로 됐는지

한 번만 확인한다. 일곱 줄 다 맞아야 아래 절차가 선다.

| 확인 | 명령 | 기대 |
|---|---|---|
| 패키지 | `ls node_modules/almandu-harness/` | `module-gate.mjs`·`loop/`·`review/`·`commands/` 가 있다 |
| 훅 | `git config --local core.hooksPath` | `.githooks` (또는 설치 때 준 경로). **비어 있는 것도 정상이다** — 전역 `core.hooksPath` 나 `.git/hooks` 의 다른 훅을 가리지 않으려고 init 이 켜지 않은 리포다. 그때는 아래 "배선" 줄을 본다 |
| 훅 내용 | `cat .githooks/pre-commit` | `exec node "$(git rev-parse --show-toplevel)/node_modules/almandu-harness/module-gate.mjs" --staged` |
| 배선 | 위 값이 비었으면 `cat "$(git rev-parse --git-common-dir)/hooks/pre-commit"` (전역 훅이 `.husky/pre-commit` 을 체인하면 그 파일) | `module-gate.mjs` 를 부르는 줄이 있다. 재클론·훅 매니저 재생성 뒤에는 사라진다 — init 을 다시 돌리면 같은 줄이 다시 간다 |
| 루트 문단 | `grep "가장 깊은 MODULE.md" CLAUDE.md` | 한 줄 나온다 |
| R14 표지 | 루트 계약의 `in` | `[[harness]] … (외부: almandu-harness …)` |
| 커맨드 | `ls .claude/commands/` | `module-work.md`·`module-review.md`·`module-draft.md` 가 있다 |

하나라도 빠졌으면 `node node_modules/almandu-harness/module-harness-init.mjs --dry-run` 으로 무엇이 놓일지 보고 `--dry-run` 을 빼고 다시 돌린다. 이미 있는 파일은 덮어쓰지 않으므로 몇 번 돌려도 된다.

이 문서와 아래 커맨드 어디에도 bin 이름 해석에 기대는 실행기를 쓰지 않는다 — 워크스페이스 멤버에서 npm 이 멤버의 `node_modules/.bin` 을 보지 않아 풀리지 않고, 조회조차 안 막아 이름이 안 풀리면 레지스트리로 나가 매달린다 (README 설치 절 실측). 남은 것은 사람이 습관으로 그 실행기를 치는 경우뿐이다.

---

## 1. 변경 하나의 기본 흐름

```
① 계약 찾기   node node_modules/almandu-harness/module-gate.mjs --scope <고칠 경로>...
② 계약 읽기   나온 MODULE.md 를 전부 Read 로 연다 (깊은 것부터)
③ 고치기
④ 계약 갱신   불변식·진입점·의존·책임이 바뀌었으면 MODULE.md 를 고치고 이력 한 줄
⑤ 판정       node node_modules/almandu-harness/module-gate.mjs
⑥ 커밋       git commit  (pre-commit 이 --staged 로 다시 판정한다)
```

### ① 계약 찾기

```
$ node node_modules/almandu-harness/module-gate.mjs --scope src/engine/Runtime/Foo.cs
scope src/engine/Runtime/Foo.cs → [[engine]]
  src/engine/MODULE.md
  MODULE.md
```

판정하지 않고 종료 코드는 0 이다. 파일을 소유하는 것은 **가장 깊은** 계약(첫 줄)이고, 아래는 조상이다.
아직 없는 파일을 만들 때도 그 경로로 묻는다 — 부모 디렉토리 기준으로 답한다.

### ② 계약 읽기 — Read 로 연다

MODULE.md 는 스스로 실리지 않는다. 같은 디렉토리 CLAUDE.md 의 `@MODULE.md` 로 끌려올 때만 실리고, 그 CLAUDE.md 는 파일에 닿는 방법에 따라 실리기도 안 실리기도 한다.

| 파일에 닿는 방법 | 계약이 실리나 |
|---|---|
| Read | 조상 체인까지 전부 실린다 |
| Bash (`cat`·`grep`·`sed`) | 안 실린다 |
| Write (새 파일) | 안 실린다 |

그래서 에이전트에게 일을 시킬 때는 "고치기 전에 `--scope` 가 낸 MODULE.md 를 Read 로 열어라" 를 지시에 넣는다. 게이트는 커밋 시점에만 서 있어서, 계약을 모르고 고친 것은 커밋 때에야 드러난다.

### ④ 계약서를 고쳐야 하는 때

| 이번 변경이… | MODULE.md 에서 할 일 | 안 하면 |
|---|---|---|
| 모듈이 소유한 소스(`watch` 확장자)를 바꿨다 | 계약서를 열어 이 변경이 약속을 바꿨는지 보고, 바뀐 것을 같은 커밋에 넣는다. R1 은 MODULE.md 파일이 바뀌었는지만 보므로 약속이 그대로인 변경도 계약서의 변경을 요구한다 — 가장 작은 변경은 이력 한 줄이다 | R1 |
| 불변식 근거로 인용된 파일을 바꿨다 (소유 무관) | 그 계약서를 연다. 문장이 여전히 참인지 보고 필요하면 고친다 | R11(a) |
| 인용 줄 **위쪽**에 줄을 넣거나 뺐다 | 근거의 줄번호를 옮긴다 — 게이트가 새 번호를 계산해 알려준다 | R11(b) |
| 책임·진입점·의존·불변식 칸을 고쳤다 | `## 이력` 에 날짜와 한 줄 (무엇을 **왜**) | R2 |
| 다른 모듈의 파일을 근거로 인용했다 | 그 모듈을 `in`/`out` 에 적는다 | R6 |
| 의존을 한쪽에 적었다 | 상대 계약서에도 반대 방향을 적는다 | R3 |
| 미결 하나를 구현했다 | 미결 줄 삭제 + 불변식 신설 + 이력 한 줄을 **한 커밋**에 | R10 |

`status: active` 모듈에서는 **코드와 계약서를 같은 커밋**에 넣는다. "계약 갱신은 다음 커밋에서" 는 성립하지 않는다 — 코드만 담은 첫 커밋이 R1 FAIL 이다. 둘을 나누고 싶으면 커밋 메시지 본문에 `계약: <무엇이 왜 바뀌었나>` 한 줄로 나눈다.

### ⑤ 판정

```
node node_modules/almandu-harness/module-gate.mjs            # 작업 트리 vs HEAD
node node_modules/almandu-harness/module-gate.mjs --staged   # 인덱스만 — pre-commit 과 같은 눈
```

`FAIL` 이 하나라도 있으면 종료 코드 1, `WARN` 만이면 0 이다. `FAIL`/`WARN` 을 가르는 것은 그 모듈의 `status` 하나다 (`active` 만 FAIL).

두 모드는 판정이 다를 수 있다. 스테이지하지 않은 active 모듈 소스 수정이 있으면 작업 트리 모드는 울고 `--staged` 는 조용하다 — 커밋 직전에는 `--staged` 로 본다.

---

## 2. 루프로 하는 흐름 (에이전트 작업에 권장)

루프는 1절의 ①·②·⑤·⑥ 을 기계로 묶는다. 판정은 하지 않고 게이트의 종료 코드를 그대로 넘긴다. 루프 자신이 거부할 때만 2 로 끝난다.

```
node node_modules/almandu-harness/loop/loop.mjs scope <경로>...    # 계약 목록 + 기준선 (→ 목록을 Read 로 연다)
   … 고친다 …
node node_modules/almandu-harness/loop/loop.mjs reconcile          # 재판정. 기준선에 없던 경고만 "신규"
node node_modules/almandu-harness/loop/loop.mjs review             # [테스트]·[grep] 불변식의 기계 리뷰 (선택)
node node_modules/almandu-harness/loop/loop.mjs commit -m "<제목>" [--contract "<계약 갱신 한 줄>"] [--dry-run]
node node_modules/almandu-harness/loop/loop.mjs status | abort
```

기억할 것:

- **`commit` 은 `git add -A` 로 작업 트리 전체를 싣는다.** 한 트리에서 두 갈래를 동시에 고치면 이 루프로는 쪼갤 수 없다. 관계없는 변경은 먼저 치우거나 stash 한다
- 고치다가 경로가 늘면 그 경로로 `scope` 를 다시 부른다. 기준선은 첫 `scope` 것 그대로이고, 계약 목록만 늘어난다
- `commit` 이 거부하는 경우는 둘이다 — `scope` 를 지나지 않은 경로가 묶음에 있을 때, active 계약이 묶음에 있는데 `--contract` 가 없을 때. 메시지가 무엇을 하라는지 적어 준다
- 세션은 `.git/module-loop/` 에만 살고 HEAD 로 봉인된다. 도중에 다른 커밋을 만들거나 브랜치를 바꾸면 세션이 거부된다 — `abort` 후 `scope` 부터 다시
- 커밋 메시지 끝에 트레일러가 붙는다: `계약:`(적었으면), `게이트: N FAIL N WARN (신규 N)`, `Review:` 와 필요하면 `Review-Verdict:`. 이 형식은 공개 표면이라 손으로 고치지 않는다

---

## 3. 계약 리뷰 (선택)

`[리뷰]` 태그 불변식은 계약서가 스스로 "테스트로도 grep 으로도 판정할 수 없다" 고 적은 자리다. 그 자리만 판단이 필요하고, 판단은 변경을 만든 세션이 아닌 쪽이 한다.

```
node node_modules/almandu-harness/module-gate.mjs --review      # 이 diff 가 건드린 파일을 근거로 인용하는 불변식과 태그
```

리뷰를 기록하려면 루프 세션 안에서:

1. `node node_modules/almandu-harness/loop/loop.mjs review --packet [--contract "<한 줄>"]` — 게이트가 FAIL 이면 패킷을 만들지 않는다
2. `.git/module-loop/review-packet.json` 의 `review_invariants` 가 비었으면 끝이다 (트레일러가 `불변식=없음(0)` 으로 남는다)
3. 서브에이전트 **하나**에 `node_modules/almandu-harness/review/personas/invariant-judge.md` 전문과 패킷 전문만 준다 — 이 세션의 대화 맥락은 넘기지 않는다
4. 항목마다 기록한다:
   `node node_modules/almandu-harness/loop/loop.mjs review --answer invariant-judge <참|거짓|판단불가> --invariant <module/id> --reason "…" [--evidence 파일:라인]...`
   (`거짓` 은 `--evidence` 필수, 통과가 아닌 답은 `--reason` 필수)
5. `거짓` 이 나오면 전문을 사람에게 보여주고 사고인지 오탐인지 사람이 정한다

리뷰 결과는 **커밋을 막지 않는다.** 막는 것은 게이트의 종료 코드뿐이다. 답을 받은 뒤 코드를 더 고치면 패킷이 달라져 `Review: none` 이 된다 — `commit --dry-run` 이 그렇게 말하면 1번부터 다시 돈다.

이 절차는 소비 리포의 `.claude/commands/module-review.md` 로 둔다. 0.8.0 부터 패키지의 `commands/` 에 실려 오고 설치 도구가 그대로 `.claude/commands/` 에 놓는다 — 손으로 복사하고 문구를 바꿀 필요가 없다. 이미 있는 파일은 덮지 않으므로 이 리포에서 고쳐 둔 사본은 안전하다. `contract-checker`·`scope-watcher` 는 리뷰에서 내려졌다 — 띄우면 `--answer` 가 거절한다.

---

## 4. 새 모듈을 세울 때

1. 디렉토리에 `MODULE.md` 를 `MODULE-schema-v1.md` 의 템플릿으로 쓴다. `module` 은 트리 전체에서 유일, `path` 는 리포 루트 기준 실제 위치
2. **`status: draft` 로 시작한다.** draft 의 위반은 전부 WARN 이라 커밋을 막지 않는다
3. `node node_modules/almandu-harness/module-harness-init.mjs` 을 다시 돌려 어댑터 CLAUDE.md 를 놓는다 (이미 CLAUDE.md 가 있으면 맨 앞에 얹는다). 빠지면 R9
4. 상위 모듈의 `책임` 칸에서 그 범위를 빼고 `[[새모듈]] 이 소유한다` 로 바꾼다. 같은 규칙이 두 곳에 있으면 깊은 쪽이 갖고 얕은 쪽에 묘비를 남긴다
5. 불변식마다 `(근거: 경로:줄) [테스트|grep|리뷰]`. 근거를 적을 수 없거나 판정 수단이 없으면 아직 불변식이 아니라 미결이다
6. 사람이 근거를 한 줄씩 열어 확인한 뒤 `status: active` 로 올리고 이력에 남긴다. 그때부터 그 모듈의 소스를 고치는 커밋은 계약서를 함께 요구한다

계약 칸(책임·진입점·의존·불변식)이 80줄을 넘으면 R4 가 분할 후보라고 말한다. 미결·이력은 세지 않는다.

---

## 5. 게이트가 울 때

| 규칙 | 뜻 | 대개의 처리 |
|---|---|---|
| R0 | frontmatter `module`/`path` 누락·불일치 | 디렉토리를 옮겼으면 `path` 를 고친다 |
| R1 | 소유 소스가 바뀌었는데 MODULE.md 가 안 바뀜 | 계약을 다시 보고 같은 커밋에 넣는다 (1절 ④) |
| R2 | 계약 칸이 바뀌었는데 이력 없음 | 이력 한 줄 |
| R3 | in/out 비대칭, 또는 같은 파일 인용의 줄 표기가 다름 | 상대 계약서에 반대 방향을 적는다. 상대가 아직 모듈이 아니면 미결에 모듈 후보로 적는다 (언제나 WARN) |
| R4 | 계약 칸 80줄 초과 | 모듈을 쪼갤지 본다 |
| R5 | 불변식에 근거나 태그 없음 | 근거·태그를 적거나 미결로 내린다 |
| R6 | 다른 모듈 파일을 근거로 인용하는데 의존에 없음 | in/out 에 추가 |
| R7 | "분할 후보: X" 인데 X 에 이미 MODULE.md | 그 줄을 지운다 |
| R8 | 두 모듈이 같은 파일:줄을 근거로 인용 | 깊은 쪽이 갖고 얕은 쪽은 묘비 |
| R9 | MODULE.md 옆 CLAUDE.md 에 `@MODULE.md` 없음 | `almandu-harness-init` 재실행 |
| R10 | 미결에 "완료" 가 남음 | 줄 삭제 + 불변식 신설 + 이력 |
| R11 | 인용된 근거 파일이 바뀜 / 인용 줄이 밀림 | 문장을 다시 확인하고, 밀렸으면 게이트가 알려준 줄로 옮긴다 |
| R12 | 근거 경로가 리포 루트 기준이 아니거나 해석 안 됨 | `node node_modules/almandu-harness/module-gate.mjs --fix` (근거 줄만 고친다) |
| R13 | `재현:` 건수 주장이 실제와 다름 | 다시 세어 고치거나, 코드가 틀렸으면 코드를 고친다 |
| R14 | 외부 표지가 설치 목록과 안 맞거나 근거가 `node_modules/` 안 | 표지와 `package.json` 을 맞추고, 외부 약속은 "harness I2" 처럼 불변식 ID 로 말한다 |

게이트를 피하려고 `--no-verify` 를 쓰거나 `status` 를 draft 로 내리지 않는다. FAIL 이 부당해 보이면 규칙이 틀렸다는 관찰이고, 그 관찰은 이 리포의 `observations/` 로 올 일이다.

`--audit` 은 diff 와 무관하게 모든 인용 줄이 실물을 가리키는지 전수로 본다. 여러 커밋에 걸쳐 조금씩 밀린 인용은 R11 이 못 잡으므로 가끔(또는 nightly CI 에서) 돌린다. 커밋 경로에는 걸지 않는다.

---

## 6. CI

이 리포의 `.github/workflows/ci.yml` 과 같은 모양을 권한다. 소비 리포에서는 게이트를 설치 자리로 부른다:

```
node node_modules/almandu-harness/module-gate.mjs --base "origin/<base>"   # PR (checkout 은 fetch-depth: 0)
node node_modules/almandu-harness/module-gate.mjs --base HEAD~1            # push
node node_modules/almandu-harness/module-gate.mjs --audit                  # nightly·수동만 — PR 을 막지 않는다
```

---

## 7. 버전을 올릴 때

```
npm i -D github:shanash/almandu-harness#v<버전>
```

npm 12 부터 git 의존은 기본으로 막힌다 — `.npmrc` 에 `allow-git=root` 를 둔다. 밀어 올린 태그는 옮겨지지 않으므로 같은 태그는 언제나 같은 게이트다.

0.x 동안 **minor 는 호환성 파괴일 수 있다** — 이미 통과하던 계약서가 FAIL 이 되거나, 루프의 명령·종료 코드·트레일러 형식이 바뀌는 변경이 minor 로 나온다 (DESIGN.md 7절). 올리기 전에 그 버전의 `MODULE.md` 이력을 읽고, 올린 뒤에는:

1. `node node_modules/almandu-harness/module-gate.mjs --audit` 으로 전수 확인
2. 커맨드 문구가 바뀐 버전이면 `.claude/commands/` 의 사본을 지우고 설치 도구를 다시 돌린다 — 있는 파일은 덮지 않으므로 지워야 새 문구가 들어온다. 내려진 페르소나가 있으면 사본에서도 뺀다
3. 설치 자리나 bin 이름이 바뀌었으면 그 버전의 README 절차대로 **한 커밋**에 옮긴다 (예: 0.7.0 의 이름 변경 — R14 표지와 설치 목록이 따로 움직이면 FAIL)

`.git/module-loop/` 경로는 옮기지 않는다. 그 자리를 읽는 스크립트가 결과 파일을 못 찾으면 조용히 통과한다.
