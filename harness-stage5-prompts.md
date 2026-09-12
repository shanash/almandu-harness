# 5단계 세션 프롬프트 — 5a ~ 5e

MODULE.md 계약 하네스의 5단계(멀티 페르소나 리뷰)를 새 세션에서 하나씩 돌리기 위한 프롬프트 모음.
각 프롬프트는 자기완결이다 — 이전 세션 맥락 없이 그대로 붙여 넣는다.

**순서를 지킬 것.** 5a 가 패킷을 만들고, 5b 가 그 패킷에 답을 붙이고, 5c 가 그 둘을 실제 프로젝트에서
시험하고, 5d 가 시험 결과로 페르소나를 고치고, 5e 가 실전에 태운다. 건너뛰면 다음 세션의 입력이 없다.

설계 전문은 `DESIGN-review.md`. 프롬프트가 설계와 어긋나면 설계가 이긴다 — 단 설계가 틀렸다고 판단되면
고치지 말고 세션을 멈추고 보고한다.

---

## 5a — 리뷰 패킷 (module-harness)

```
module-harness 의 5단계 리뷰 작업이다. 이 저장소는 디렉토리별 MODULE.md 계약서와 그것을 판정하는
module-gate.mjs, 그리고 scope → change → reconcile → commit 루프(loop/)를 갖고 있다. 지금 할 일은
루프에 review 단계의 **입력**을 만드는 것이다. 판단은 하지 않는다 — 패킷만 만든다.

먼저 읽을 것 (이 순서로):
1. DESIGN-review.md — 특히 1절(위치), 2절(패킷 스키마), 5절(실행 메커니즘)
2. DESIGN.md 4b 절 — 루프의 세션 봉인(HEAD sha + 게이트 해시) 방식. 패킷은 이것을 상속한다
3. loop/ 의 scope·reconcile 구현 — 패킷이 재사용할 함수를 찾는다. 새로 짜지 않는다
4. module-gate.mjs 의 --review — [리뷰] 태그 불변식을 뽑는 기존 로직. 패킷의 review_invariants 원천

할 일:

[1] `loop review --packet` 을 구현한다. 출력은 `.git/module-loop/review-packet.json`.
    스키마는 DESIGN-review 2절 그대로. 필드를 늘리거나 줄이지 않는다.
    - session: 현재 세션 봉인을 그대로 복사. 봉인이 깨져 있으면 패킷을 만들지 않고 거부한다
    - scope: 세션의 scope 결과
    - diff.code / diff.contract: reconcile 이 이미 계산한 변경 파일. owners 는 게이트의 ownerOf 그대로
    - contract_statement: 세션의 --contract 문장
    - contract_diff: MODULE.md 의 unified diff 에서 **계약 섹션만**(책임·진입점·의존·불변식).
      미결·이력 hunk 는 뺀다. 게이트의 CONTRACT_SECTIONS 상수를 재사용한다
    - review_invariants: --review 가 뽑은 [리뷰] 불변식 중 diff.code 가 근거 파일을 건드린 것만.
      touched: false 는 배열에 넣지 않는다

[2] 패킷 해시를 만든다. session + scope + diff + contract_statement + contract_diff + review_invariants 를
    정렬된 JSON 으로 직렬화해 sha256. 5b 의 review-result 가 이 해시로 패킷에 묶인다.

[3] 테스트를 먼저 쓰고 구현한다 (기존 module-gate.test.mjs 와 같은 방식):
    - 같은 트리에서 두 번 만들면 같은 해시가 나온다 (결정론)
    - 봉인이 깨진 세션에서는 거부한다
    - 미결·이력만 바뀐 MODULE.md 는 contract_diff 가 빈 문자열이다
    - [리뷰] 불변식의 근거 파일이 diff 에 없으면 review_invariants 에 들어가지 않는다
    - reconcile 이 FAIL 인 세션에서는 패킷을 만들지 않는다 (DESIGN-review 1절)

[4] 이 저장소 자신의 루프로 커밋한다 — scope → change → reconcile → commit.
    커밋 메시지에 `--contract` 를 정직하게 적어라. 5c 에서 이 커밋이 정상 커밋 표본이 된다.

지킬 것:
- 판단 로직을 넣지 않는다. "이 diff 가 좋은가"를 계산하는 코드가 생기면 잘못 간 것이다
- 패킷은 커밋되지 않는다. .git/ 안에만 산다
- DESIGN-review 를 고치지 않는다. 스키마가 부족하면 세션을 멈추고 보고한다

끝나는 조건: `loop review --packet` 이 동작하고, 테스트 5개가 통과하고, 패킷 해시가 결정론적이고,
이 세션의 커밋이 루프를 통과했다.
```

---

## 5b — 페르소나와 결과 (module-harness)

```
module-harness 의 5단계 리뷰 작업이다. 직전 세션(5a)이 `loop review --packet` 으로
`.git/module-loop/review-packet.json` 을 만들게 했다. 지금 할 일은 그 패킷에 **답을 붙이는 자리**를
만드는 것이다. 답 자체는 호출자(Claude Code 서브에이전트 또는 사람)가 한다. 이 세션도 답을 만들지 않는다.

먼저 읽을 것:
1. DESIGN-review.md — 3절(페르소나), 4절(verdict 스키마), 5절(실행 경로 A·B), 11절(하지 말 것)
2. loop/review 구현 (5a 결과) — 패킷 해시가 어떻게 계산되는지
3. .claude/commands/module-draft.md — 기존 커맨드가 절차·규칙·"하지 말 것"을 어떻게 적는지.
   페르소나 파일도 같은 밀도로 쓴다

할 일:

[1] `review/personas/` 에 파일 셋을 쓴다: `contract-checker.md`(계약 대조자),
    `invariant-judge.md`(불변식 판정자), `scope-watcher.md`(범위 감시자).
    각 파일은 네 절로 고정한다 — 질문 / 입력 필드(패킷의 어느 키를 읽는가) / 출력 형식(4절 verdict 한 항목) /
    **답하지 말 것**. 넷째 절이 가장 길어야 한다. 예:
    - 계약 대조자: 코드 품질, 불변식의 타당성, diff 의 크기를 말하지 않는다. 문장과 diff 의 일치만 본다
    - 불변식 판정자: 불변식이 좋은 규칙인지 말하지 않는다. 지금 참인지만 본다. 패킷에 없는 불변식을 꺼내지 않는다
    - 범위 감시자: 왜 범위를 벗어났는지 추측하지 않는다. 벗어났는지만 본다
    성격·말투 수식을 넣지 않는다 (11절).

[2] `loop review --answer <persona> <answer> --reason "…" [--evidence file:line]*` 를 구현한다.
    경로 B(사람)용. `.git/module-loop/review-result.json` 에 4절 스키마로 쓴다.
    - answer 는 예/아니오/판단불가 (불변식 판정자는 참/거짓/판단불가 + --invariant <module/id>) 만 받는다
    - "아니오"/"거짓" 에 --evidence 가 없으면 거부한다 (4절 규칙)
    - packet_hash 는 현재 패킷에서 읽어 박는다. 패킷이 없으면 거부한다

[3] `loop commit` 을 고친다. review-result.json 이 있고 packet_hash 가 현재 패킷과 같으면 trailer 를 붙인다:
      Review: 계약대조=<answer> 불변식=<answer>(<n>) 범위=<answer>
      Review-Result: <packet_hash 앞 8자리>
    없거나 해시가 다르면 `Review: none`. **어느 경우에도 커밋을 막지 않는다.**

[4] `.claude/commands/module-review.md` 초안을 쓴다 (경로 A). 내용:
    - 패킷을 읽는다
    - 페르소나 파일 셋을 각각 서브에이전트로 띄운다. 서브에이전트에는 페르소나 파일 + 패킷만 준다.
      **이 세션의 대화 맥락을 넘기지 않는다** (5절 — change 한 세션이 리뷰하면 변명이 된다)
    - 셋의 답을 `loop review --answer` 로 각각 기록한다
    - 페르소나끼리 결과를 보여주지 않는다. 병렬, 독립
    커맨드는 초안이다. 5c·5d 에서 고친다.

[5] 테스트를 먼저 쓴다:
    - "아니오"에 evidence 없으면 거부
    - packet_hash 불일치 result 는 commit 이 무시하고 `Review: none`
    - 세 페르소나 답이 다 있으면 trailer 형식이 정확히 위와 같다
    - answer 에 자유 문장을 넣으면 거부

[6] 경로 B 로 직접 한 번 돌린다: 이 세션의 변경에 대해 패킷을 만들고, 사람(너)이
    `--answer` 셋을 손으로 쓰고, 커밋 trailer 에 남는 것을 확인한다. 루프로 커밋한다.

지킬 것:
- 페르소나가 넷이 되지 않는다. 질문이 셋이다
- 서브에이전트 실행 코드를 loop/ 에 넣지 않는다. 그건 커맨드(호출자)의 일이다
- DESIGN-review 를 고치지 않는다

끝나는 조건: 페르소나 파일 셋, --answer, trailer, 커맨드 초안이 있고, 테스트가 통과하고,
이 세션의 커밋에 `Review:` trailer 가 실제로 붙어 있다.
```

---

## 5c — 설치와 프로브 (kod-remastered)

```
kod-remastered 에서 module-harness 의 5단계 리뷰를 시험하는 작업이다. 이 저장소는 MODULE.md 12장이
전부 status: active 이고, module-harness 를 npm/git URL 로 받아 게이트가 커밋 경로에 물려 있다.
지금 할 일은 새 버전을 설치하고, **일부러 나쁜 커밋**으로 리뷰가 잡는지 보고, 정상 커밋으로 오탐을 보는 것이다.
기능 구현이 아니다. 관찰이다.

먼저 읽을 것:
1. module-harness 의 DESIGN-review.md — 7절(프로브), 8절(관찰 기록 형식)
2. .harness 관련 설정 — package.json 의 module-harness 의존 줄, tools/git-hooks/pre-commit, am-gate.json
3. restored-project/Assets/Scripts/Engine/MODULE.md 와 Actions/MODULE.md — [리뷰] 태그 불변식이
   어디 있는지. 프로브 P2 의 대상이 된다

할 일:

[0] module-harness 를 v0.4.0 태그로 갱신한다 (5a·5b 가 들어간 버전). 설치 후 깨끗한 트리에서
    `module-gate` 가 12 modules OK 인지, `--audit` 이 OK 인지 확인한다. 하나라도 깨지면 프로브로 가지 말고
    보고한다 — 버전 갱신이 깨뜨린 것과 리뷰가 잡은 것이 섞이면 안 된다.

[1] 프로브 세 개를 **하나씩** 돌린다. 각각 루프(scope → change → reconcile → /module-review) 를 태우고,
    verdict 를 기록한 뒤 `git checkout --` 과 `loop abort` 로 완전히 되돌린다. 커밋하지 않는다.
    - P1 거짓 서술: engine 의 [리뷰] 불변식 하나를 골라 문장 자체를 바꾸면서 --contract 에는
      "근거 경로 정정" 이라고 적는다 → 계약 대조자가 "아니오" 를 내야 한다
    - P2 조용한 위반: 그 불변식이 금지하는 코드를 실제로 넣고, MODULE.md 는 이력에 무관한 한 줄만
      추가해 R1·R2 를 형식적으로 통과시킨다 → 불변식 판정자가 "거짓" 을 내야 한다
    - P3 범위 이탈: scope 에 engine 만 넣고 Actions/ 의 .cs 를 고친다 → 범위 감시자가 "아니오" 를 내야 한다
    각 프로브에서 verdict 전문(reason·evidence 포함)을 그대로 복사해 둔다.

[2] 정상 커밋 세 건을 돌린다. 진짜 작업이어야 한다 — 미결 정리, 근거 줄 밀림 정정, 주석 보강 같은
    작은 실제 변경. 이번엔 커밋까지 간다. 세 건 모두 verdict 를 복사해 둔다.
    "아니오/거짓" 이 나오면 그것이 오탐인지 실제 검출인지 판단해 적는다. 오탐이면 왜 그렇게 답했는지
    reason 을 읽고 어느 페르소나의 "답하지 말 것" 이 부족한지 짚는다.

[3] `<module-harness>/observations/04-review-observation.md` 를 DESIGN-review 8절 형식으로 쓴다.
    프로브 표 / 정상 커밋 표 / 규칙 후보 / 페르소나 결함 / 결론. 관찰 문서는 module-harness 저장소에 간다 —
    kod-remastered 에 두지 않는다 (하네스 지식이지 프로젝트 지식이 아니다).
    verdict 는 요약하지 말고 전문을 붙인다. 8절이 정한 세 갈래(검출 / 오탐 / 페르소나 결함)를 섞지 않는다.

지킬 것:
- 프로브는 반드시 되돌린다. 프로브 흔적이 커밋되면 12장 계약이 오염된다
- 프로브 중 게이트가 FAIL 로 막으면 그것도 기록한다 — 리뷰까지 못 간 것이 "리뷰가 못 잡은 것" 과 다르다
- 페르소나 파일을 이 세션에서 고치지 않는다. 결함은 04 에 적고 5d 가 고친다
- 서브에이전트가 이 세션의 맥락을 받지 않는지 한 번 확인한다 (커맨드 초안이 그렇게 돼 있는가)

끝나는 조건: v0.4.0 이 설치돼 12장 OK 이고, 04 에 프로브 3건 + 정상 3건의 verdict 전문이 있고,
검출 / 오탐 / 페르소나 결함이 갈라져 적혀 있다.
```

---

## 5d — 페르소나 고정 (module-harness)

```
module-harness 의 5단계 리뷰 작업이다. 직전 세션(5c)이 kod-remastered 에서 프로브 3건과 정상 커밋 3건을
돌려 `observations/04-review-observation.md` 를 남겼다. 지금 할 일은 04 의 "페르소나 결함" 으로
페르소나 프롬프트를 고치고, 같은 프로브에서 결함이 사라지는지 보는 것이다.

먼저 읽을 것:
1. observations/04-review-observation.md — 특히 "페르소나 결함" 과 "오탐" 절
2. review/personas/*.md 셋
3. DESIGN-review.md 3절·11절

할 일:

[1] 04 의 결함 항목마다 어느 페르소나의 어느 절이 부족했는지 짚는다. 대부분 "답하지 말 것" 절일 것이다.
    결함 하나에 프롬프트 수정 하나. 묶어서 고치지 않는다 — 어느 수정이 어느 결함을 없앴는지 남아야 한다.

[2] 오탐 항목은 두 갈래로 가른다:
    - 페르소나가 질문 밖의 것을 답해서 생긴 오탐 → [1] 과 같이 프롬프트 수정
    - 패킷 정보가 부족해서 생긴 오탐 (예: 근거 파일 현재 내용이 없어 추측함) → 페르소나를 고치지 말고
      DESIGN-review 13절 미결에 적는다. 패킷 스키마 변경은 이 세션 범위 밖이다

[3] 고친 페르소나로 5c 의 프로브 3건을 **kod-remastered 에서 다시** 돌린다. 04 에 "## 재실행 (날짜)" 절을
    덧붙여 결과를 나란히 적는다. 원본 결과를 지우지 않는다 — 무엇이 고쳐졌는지가 기록이다.

[4] 결함이 사라졌으면 v0.4.1 태그. 남았으면 태그하지 말고 남은 것을 04 에 적고 보고한다.
    두 번째 수정 회차는 이 세션에서 하지 않는다 — 프롬프트를 계속 만지면 어느 버전이 관찰된 것인지 흐려진다.

지킬 것:
- 페르소나에 성격·말투를 넣지 않는다. 결함 대응은 언제나 "무엇을 답하지 말 것" 의 추가다
- 질문을 늘리지 않는다. 결함이 "넷째 질문이 필요하다" 로 보이면 DESIGN-review 미결에 적는다
- 04 의 원본 관찰을 수정하지 않는다

끝나는 조건: 결함 항목마다 대응하는 프롬프트 수정 커밋이 있고, 재실행 표가 04 에 있고,
v0.4.1 이 찍혔거나 남은 결함이 명시돼 있다.
```

---

## 5e — 실전 관찰 (kod-remastered, 기간 작업)

```
kod-remastered 에서 module-harness 의 리뷰를 **실제 작업**에 태우는 관찰 기간이다. 이 세션은 한 번에 끝나지
않는다 — 작업 커밋마다 리뷰를 돌리고 verdict 를 모은다. 한 세션에서 할 일은 "이번 작업 커밋에 리뷰를
태우고 결과를 관찰 문서에 한 줄 보태는 것" 이다.

전제: module-harness v0.4.1 이 설치돼 있고, `/module-review` 가 동작한다.

먼저 읽을 것:
1. module-harness/DESIGN-review.md — 6절(승격 경로), 10절(종료 조건)
2. module-harness/observations/05-review-field.md — 없으면 이 세션이 만든다. 있으면 지금까지의 표

이번 세션의 실제 작업: <여기에 그날의 작업을 적는다 — 리뷰 관찰과 무관한 진짜 작업>

할 일:

[1] 작업을 루프로 한다. scope → change → reconcile → /module-review → commit.
    리뷰 verdict 가 무엇이든 커밋은 진행한다 (비차단). 단 "아니오/거짓" 이 나오면 커밋 전에
    그것이 사고인지 오탐인지 판단하고, 사고면 고치고 다시 루프를 돈다.

[2] observations/05-review-field.md 의 표에 한 줄 보탠다:
    | 날짜 | 커밋 | 계약대조 | 불변식 | 범위 | 검출/오탐/통과 | 이유 요약 |
    "아니오/거짓" 은 reason 전문을 표 아래 절에 붙인다.

[3] 같은 이유의 검출이 3건이 되면 DESIGN-review 미결에 `- 규칙 후보: <이유> (관찰 3건: …)` 를 적고
    보고한다. 규칙을 만들지는 않는다 — 그건 별도 세션(게이트 수정)이다.
    같은 페르소나가 10회 연속 "예/참" 이면 그것도 보고한다 — 그 질문을 리뷰에서 내릴 후보다.

[4] 종료 조건(10절) 셋을 매 세션 끝에 확인한다:
    - 실전 검출 1건 이상 (프로브 아님)
    - 승격 경로가 한 번 돌았다 (규칙 후보 생성 또는 질문 내림)
    - 오탐이 정상 커밋 10건 중 1건 이하
    셋 다 채워지면 05 에 "## 결론" 을 쓰고 5단계 종료를 보고한다.
    커밋 20건이 넘어도 하나도 안 채워지면 그것도 결론이다 — "구조는 섰지만 값은 못 했다" 로 적고
    리뷰를 비활성으로 내리는 것을 제안한다.

지킬 것:
- 관찰 때문에 작업을 고르지 않는다. 그날 할 일을 하고 리뷰는 따라간다
- verdict 에 맞추려고 --contract 문장을 다듬지 않는다. 계약 대조자가 잡는 것이 바로 그 다듬기다
- 페르소나·패킷·게이트를 이 세션에서 고치지 않는다. 결함은 05 에 적는다

끝나는 조건 (세션 단위): 이번 작업이 루프로 커밋됐고, 05 표에 한 줄이 늘었고, 종료 조건 3개의 현재 상태가
세션 끝에 보고돼 있다.
```

---

## 5단계가 끝난 뒤

`DESIGN-review.md` 10절의 결론이 어느 쪽이든 그것을 DESIGN.md 2절 상태표에 적는다.
값을 했으면 리뷰는 루프의 정식 단계로 남고, 규칙 후보가 게이트로 내려가는 세션이 이어진다.
값을 못 했으면 리뷰를 내리고 그 판단을 남긴다. 어느 쪽이든 5단계는 끝이고, 하네스는 완성이다.

그 다음은 두 번째 프로젝트(TapStrike 또는 Unreal)에 설치하는 것이다. "범용" 목표가 시험되는 첫 자리다.
