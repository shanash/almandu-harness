# 04 리뷰 관찰 — 2026-09-13

대상: kod-remastered (MODULE.md 11장, 전부 `status: active`), module-harness v0.4.0.
방식: DESIGN-review.md 7절. 프로브 3종은 되돌리고 커밋하지 않았으며, 정상 커밋 3건은 실제로 커밋했다.
페르소나는 `/module-review` 경로 A 로 돌렸다 — 각 판정은 새 서브에이전트가 페르소나 파일과 패킷만 받고 냈고,
변경을 만든 세션의 대화 맥락은 넘기지 않았다.

설계와 다른 점 하나. 7절은 프로브 대상을 engine·actions 로 적었으나 **그 두 모듈에는 `[리뷰]` 태그 불변식이
하나도 없다**(전부 `[grep]`·`[테스트]`). 패킷의 `review_invariants` 는 `[리뷰]` 만 싣기 때문에 P2 가 성립하지
않는다. 태그가 실제로 `[리뷰]` 인 gameui 로 옮겼고, 프로브가 검증하려던 성질은 그대로다.
리포 전체에서 `[리뷰]` 는 7개뿐이다 (gameui 2, data 2, scripts 2, interpolator 1).

---

## 프로브

| 프로브 | 기대 | 실제 | 판정 |
|---|---|---|---|
| P1 거짓 서술 (gameui I7 문장을 뒤집고 `--contract` 는 "근거 경로 정정") | 계약 대조자 → 아니오 | 아니오 | 검출 |
| P2 조용한 위반 (`ShanObject.Release` 의 파괴 순서를 뒤집고 계약서는 형식만 손댐) | 불변식 판정자 → 거짓 | 거짓 | 검출 (게이트가 먼저 두 번 막았다, 아래) |
| P3 범위 이탈 (scope 는 engine, 고친 것은 Actions) | 범위 감시자 → 아니오 | 아니오 | 검출 |

세 프로브 모두 목표 페르소나가 잡았고, **목표가 아닌 페르소나는 전부 통과를 냈다** — 프로브마다
울어야 할 하나만 울었다.

### P1 verdict 전문 (패킷 62b13805)

```json
{ "persona": "계약 대조자", "answer": "아니오",
  "reason": "diff 는 근거 경로를 한 글자도 바꾸지 않고 I7 이 약속하던 파괴 순서와 이미 파괴된 경우의 동작(조용히 반환 → 예외)을 뒤집었는데, 문장은 이를 \"근거 경로 정정\" 이라 적어 변경의 급을 낮춰 말한다.",
  "evidence": ["restored-project/Assets/Scripts/GameUI/MODULE.md:30"] }
{ "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }
```

### P2 verdict 전문 (패킷 44beeae5)

```json
{ "persona": "불변식 판정자", "invariant": "gameui/I7", "answer": "거짓",
  "reason": "`Release` 는 자기 `gameObject` 를 먼저 `Destroy` 하고 자식 Transform 순회를 그 뒤에 돌리므로 문장이 말하는 파괴 순서가 뒤집혀 있다(앞 절의 조용한 되돌아옴만 성립한다).",
  "evidence": ["restored-project/Assets/Scripts/GameUI/ShanObjects/ShanObject.cs:70-73",
               "restored-project/Assets/Scripts/GameUI/ShanObjects/ShanObject.cs:74-82",
               "restored-project/Assets/Scripts/GameUI/ShanObjects/ShanObject.cs:66-69"] }
{ "persona": "계약 대조자", "answer": "예",
  "reason": "계약 diff 는 I7 의 근거 줄 범위를 63-82 에서 63-86 으로 옮긴 것 하나뿐이고 불변식 문구 자체는 그대로라, 문장의 \"I7 의 근거 줄을 옮긴다\" 가 그 변경을 빠뜨리지도 부풀리지도 않으며 나머지 주장은 계약 칸 밖인 이력만 가리킨다.",
  "evidence": ["restored-project/Assets/Scripts/GameUI/MODULE.md:30"] }
{ "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }
```

### P3 verdict 전문 (패킷 591b13a4)

```json
{ "persona": "범위 감시자", "answer": "아니오",
  "reason": "두 파일의 소유 모듈 `actions` 가 scope(`engine`, `restored-project`) 에 없다.",
  "evidence": ["restored-project/Assets/Scripts/Actions/FlowControl/LeActionExit.cs",
               "restored-project/Assets/Scripts/Actions/MODULE.md"] }
{ "persona": "계약 대조자", "answer": "예",
  "reason": "contract_diff 가 비어 계약 칸은 그대로인데 문장도 이력 칸에만 적는다고 말하므로 어긋나지 않는다",
  "evidence": [] }
```

### 리뷰까지 가지 못한 것 — 게이트가 먼저 막은 두 번

P2·P3 은 **첫 시도에서 패킷이 만들어지지 않았다.** 리뷰가 못 잡은 것이 아니라 리뷰 앞에서 기계가 막은 것이고,
둘은 다르다.

- P2 1차: `FAIL gameui R11 — I7 근거 …ShanObject.cs:63-82 의 인용 줄 위쪽이 바뀌었다`.
  불변식이 인용한 범위 **안에서** 코드를 뒤집으면 R11 이 먼저 운다. "조용한 위반" 은 인용 범위를 건드리지 않는
  자리에서만 조용하다
- P3 1차: `FAIL actions R1 — 소스 1개 변경, MODULE.md 미변경`

둘 다 설계 7절이 예고한 대로 "계약서를 형식적으로만 고쳐" 통과시켰다(P2 는 근거 줄번호를 밀린 값으로,
P3 은 이력 한 줄). 그 형식적 통과 뒤에는 두 프로브 모두 리뷰가 잡았다. 즉 **게이트를 형식으로 넘기는 것은
쉽고, 그 다음에 서 있는 것이 리뷰다** — 이번 관찰에서 리뷰가 값을 한 자리가 정확히 여기다.

---

## 정상 커밋

| 커밋 | 계약대조 | 불변식 | 범위 | 오탐 여부 |
|---|---|---|---|---|
| 8a1701a docs(gameui): I7 순서 이유 주석 + 밀린 근거 정정 | 예 | 참(gameui/I7) | 예 | 없음 |
| 1097430 docs(interpolator): 인자 없는 감속 갈래 표시 | 예 | 대상 없음 | 예 | 없음 |
| 57e043d docs(gameui): I3 의 해제 비대칭을 미결에 적는다 | 예 | 대상 없음 | 예 | 없음 |

**오탐 0 / 3.** 세 커밋 모두 `Review:` 트레일러가 붙었다.

### 8a1701a verdict 전문 (패킷 07d01d9d)

```json
{ "persona": "계약 대조자", "answer": "예",
  "reason": "contract_diff 는 I6·I7 의 근거 줄번호만 87-89·63-84 로 밀어 놓았고 두 불변식의 문장은 글자 그대로 같으므로, 문장이 말한 \"근거 줄 정정, 불변식 문장은 그대로\" 가 계약 칸에서 일어난 일과 정확히 일치한다.",
  "evidence": ["restored-project/Assets/Scripts/GameUI/MODULE.md:29",
               "restored-project/Assets/Scripts/GameUI/MODULE.md:30"] }
{ "persona": "불변식 판정자", "invariant": "gameui/I7", "answer": "참",
  "reason": "`Release` 는 null 가드로 조용히 되돌아온 뒤 자기 Transform 을 제외한 자식들을 먼저 `Object.Destroy` 하고 자기 `gameObject` 는 마지막에 파괴한다.",
  "evidence": ["…/ShanObject.cs:66-69", "…/ShanObject.cs:72-80", "…/ShanObject.cs:81-84"] }
{ "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }
```

### 1097430 verdict 전문 (패킷 3055f7ea)

```json
{ "persona": "계약 대조자", "answer": "예",
  "reason": "contract_diff 는 I4 의 근거 줄번호 92→94 정정 하나뿐이고 불변식 문장 자체는 그대로여서 문장이 서술한 계약 칸 변경과 정확히 일치하며, 문장이 계약 변경을 부풀리거나 급을 낮춰 말한 곳도 없다",
  "evidence": ["restored-project/Assets/Scripts/Interpolator/MODULE.md:22"] }
{ "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }
```

### 57e043d verdict 전문 (패킷 751c5bed)

```json
{ "persona": "계약 대조자", "answer": "예",
  "reason": "`contract_diff` 가 비어 계약 칸 변경이 없는데 문장도 미결에만 적었다고 말하고 계약 변경을 주장하지 않는다.",
  "evidence": [] }
{ "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }
```

---

## 규칙 후보 (같은 이유 묶음)

없다. 검출 3건은 셋 다 서로 다른 이유였고(거짓 서술 1, 불변식 위반 1, 범위 이탈 1), 3회 규칙은 한 묶음도
채우지 못했다. 프로브는 애초에 서로 다른 질문을 하나씩 겨냥해 만든 것이라 이 결과는 예상된 것이다 —
규칙 후보는 실전(5e)에서만 나온다.

관찰만 적어 둔다. 아래 둘은 아직 후보가 아니다.

- **범위 감시자의 질문은 루프가 이미 기계로 답한다.** P3 에서 `reconcile` 이 리뷰보다 먼저
  "scope 를 지나지 않은 경로 1개 — commit 이 거부한다" 를 냈고, loop I2 가 그 커밋을 실제로 막는다.
  이 페르소나가 잡는 것은 **커밋 전 단계에서 미리 알려 주는 것**뿐이다. 10회 연속 통과가 쌓이면
  DESIGN-review 6절의 역방향(질문을 리뷰에서 내림) 후보가 된다 — 지금은 4회다(P1·P2·정상 3건 중 예 4, 아니오 1)
- **`판단불가` 가 한 번도 나오지 않았다** (0/11). 13절 미결의 "계약 대조자의 판단불가 비율이 높으면
  `contract_statement` 를 구조화" 는 아직 근거가 없다

---

## 페르소나 결함

1. **출력이 코드펜스에 싸여 온다** — 계약 대조자 2회(P1, 정상C), 불변식 판정자 2회(P2, 정상A)가
   ` ```json ` 펜스로 감쌌다. 페르소나 파일은 "JSON 객체 하나만 낸다. 앞뒤에 설명을 붙이지 않는다" 라고만 적는다.
   펜스는 설명이 아니라 표기라 규칙을 어긴 것인지 애매하고, 사람이 읽어 옮기면 문제가 없지만
   **경로 A 를 자동화하면 파싱이 갈린다.** → 출력 형식 절에 "코드펜스로 감싸지 않는다" 를 명시할 자리
2. **근거의 좌표계가 정해져 있지 않다** — 계약 대조자가 낸 `MODULE.md:30` 은 실제 파일에서 I7 이 있는
   38 번 줄이 아니라 `contract_diff` 안에서 센 줄이었다(정상B 의 `MODULE.md:22` 도 같다).
   페르소나 파일은 "계약 diff 의 줄을 가리킬 때는 그 계약서 경로와 줄번호를 적는다" 고만 적어 둘 중 어느
   좌표인지 말하지 않는다. → 출력 형식 절에 "파일의 실제 줄번호" 임을 못 박을 자리
3. **범위 감시자의 `reason` 이 통과 시 언제나 빈 문자열** (5/5). 파일이 "`예` 면 비워도 된다" 고 허용한 결과라
   결함은 아니지만, 관찰 대조에서 이 페르소나의 통과는 정보가 0 이다. 위 "10회 연속 통과" 판단의 근거로만 쓰인다

세 항목 모두 **답을 틀린 것이 아니라 형식·좌표의 문제**다. 질문 밖의 것을 말한 사례(코드 품질, 다른 페르소나의
질문 침범, 고치라는 제안)는 11회 판정에서 **한 건도 없었다** — "답하지 말 것" 절은 이번 회차에서 값을 했다.

---

## 하네스 쪽 관찰 (페르소나와 무관)

- **줄바꿈 전면 변경이 R11 을 가린다.** 정상 B 를 처음 넣을 때 편집 스크립트가 CRLF 파일을 LF 로 바꿔
  192줄짜리 diff 가 됐는데, 그때 R11 은 **아무 말도 하지 않았다**. CRLF 를 보존해 두 줄만 바꾸자
  같은 편집에서 `I4 근거 …:92 → 94` 가 정확히 울었다. 파일 전체가 바뀌면 hunk 가 파일 전체를 덮어
  "인용 줄 위쪽의 변화량" 이 상쇄되는 것으로 보인다 — 확인되지 않은 추정이고, 재현은 남아 있다
- **R11 의 정정 제안이 과교정일 수 있다.** P2 에서 줄 수가 그대로인 재배치(삽입 4줄 + 삭제 4줄)에
  `82→86` 을 제안했으나 실제 끝줄은 그대로 83 이었다. 제안은 확인용 문구("인지 확인")라 틀려도 해롭지는 않다
- **패킷은 코드 diff 의 모양을 담지 않는다.** 위 CRLF 사고는 세 페르소나 누구의 질문에도 걸리지 않는다 —
  `diff.code` 는 파일 목록이고 내용은 불변식 판정자가 직접 읽는 현재 내용뿐이다.
  loop/MODULE.md 미결에 적은 "패킷 해시가 코드 내용을 담지 않는다" 와 같은 뿌리다
- **kod-remastered 는 11장이다** (7절이 적은 12장이 아니다). 12번째는 분리되어 이 리포가 된 `.harness` 였다

---

## 결론

구조는 섰다. 프로브 3종을 겨냥한 페르소나가 각각 잡았고, 정상 커밋 3건에서 오탐이 0 이었으며,
`Review:` 트레일러가 실제 커밋 메시지에 남았다.

값은 아직 반만 증명됐다. **리뷰가 잡은 셋 중 둘(P2·P3)은 게이트가 형식적으로 통과된 뒤에 잡은 것**이고,
그 형식적 통과가 실전에서 얼마나 자주 일어나는지는 이번 회차로 알 수 없다. P1(거짓 서술)만이
게이트가 애초에 볼 수 없는 자리였고, 그 자리에서 리뷰는 프로브와 실전(5b 의 module-harness 커밋)에서
각각 한 번씩 잡았다.

다음은 5d — 위 "페르소나 결함" 세 항목 중 1·2 를 프롬프트로 고친다. 3 은 고칠 것이 아니라 세는 것이다.
그 다음이 5e 이고, 종료 조건(10절) 셋 중 지금 채워진 것은 "실전 검출 1건"(5b) 하나다.

---

## 재실행 (2026-09-13, 5d)

위 "페르소나 결함" 1·2 를 프롬프트로 고친 뒤(`ac203a9` 펜스 금지, `fd307b8` 근거 좌표계) 같은 프로브 3종을
kod-remastered 에서 다시 돌렸다. 원본 관찰은 위에 그대로 두었다 — 무엇이 고쳐졌는지가 기록이다.

| 프로브 | 1차 answer | 재실행 answer | 결함 1 (펜스) | 결함 2 (좌표) |
|---|---|---|---|---|
| P1 계약 대조자 | 아니오 | 아니오 | 있었음 → 없음 | `MODULE.md:30` → `MODULE.md:38` (실제 줄) |
| P2 불변식 판정자 | 거짓 | 거짓 | 있었음 → 없음 | 해당 없음 (원본 파일을 직접 읽는다) |
| P2 계약 대조자 | 예 | 예 | 없었음 | `MODULE.md:30` → `MODULE.md:38` |
| P3 범위 감시자 | 아니오 | 아니오 | 없었음 | 해당 없음 (줄번호를 적지 않는다) |
| P3 계약 대조자 | 예 | 예 | 있었음 → 없음 | 근거 없음(빈 배열) |

**결함 1·2 모두 재실행에서 사라졌다.** 7회 판정 중 코드펜스 0회, 계약 대조자가 낸 줄번호는 두 번 다
파일의 실제 줄이었다(gameui/MODULE.md 의 I7 은 38행에 있다). 검출·통과 패턴은 1차와 완전히 같다 —
프롬프트 수정이 판정을 바꾸지 않고 표기만 고쳤다는 뜻이고, 그것이 의도한 것이다.

결함 3(범위 감시자의 빈 `reason`)은 고치지 않았다. 파일이 허용한 것이고, 고칠 것이 아니라 세는 것이다 —
통과 연속 횟수는 이제 7회다(1차 4 + 재실행 3). 10회가 되면 DESIGN-review 6절 역방향 후보로 보고한다.

### 재실행 verdict 전문

```
P1  { "persona": "계약 대조자", "answer": "아니오",
      "reason": "근거 경로는 `ShanObject.cs:63-84` 로 그대로인데 바뀐 것은 파괴 순서와 이미 파괴된 경우의 동작(조용히 되돌아온다 → 예외를 던진다)이라, 약속 자체를 뒤집은 변경을 \"근거 경로 정정\" 이라 급을 낮춰 적었다",
      "evidence": ["restored-project/Assets/Scripts/GameUI/MODULE.md:38"] }
    { "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }

P2  { "persona": "불변식 판정자", "invariant": "gameui/I7", "answer": "거짓",
      "reason": "Release 가 `Object.Destroy(base.gameObject)` 를 먼저 부르고 그 뒤에 자식 Transform 순회·파괴를 하므로 \"자식을 먼저, 자기 gameObject 를 마지막에\" 라는 순서가 지금 코드에서는 뒤집혀 있다 (앞의 null 가드로 이미 파괴된 오브젝트에서 조용히 되돌아오는 부분만 여전히 성립한다).",
      "evidence": ["…/ShanObject.cs:72-75", "…/ShanObject.cs:76-84", "…/ShanObject.cs:66-69"] }
    { "persona": "계약 대조자", "answer": "예",
      "reason": "contract_diff 의 유일한 변경은 I7 의 근거 줄 범위를 63-84 에서 63-88 로 옮긴 것이고 불변식 문언·다른 계약 칸은 그대로여서 문장이 말한 것과 diff 가 한 것이 일치한다",
      "evidence": ["restored-project/Assets/Scripts/GameUI/MODULE.md:38"] }
    { "persona": "범위 감시자", "answer": "예", "reason": "", "evidence": [] }

P3  { "persona": "범위 감시자", "answer": "아니오",
      "reason": "두 파일의 소유 모듈 `actions` 가 scope(`engine`, `restored-project`)에 없다.",
      "evidence": ["restored-project/Assets/Scripts/Actions/FlowControl/LeActionExit.cs",
                   "restored-project/Assets/Scripts/Actions/MODULE.md"] }
    { "persona": "계약 대조자", "answer": "예",
      "reason": "contract_diff 가 비어 계약 칸이 바뀌지 않았고, 문장도 계약 변경이 아니라 이력에 적는다고만 말한다",
      "evidence": [] }
```

### 재실행에서 새로 보인 것

- P2 를 다시 넣을 때 R11 은 **1차와 같은 자리에서 같은 값을 제안했다**(`63-84` 기준으로 재계산된 것).
  위 "R11 의 정정 제안이 과교정일 수 있다" 는 재현됐고, 여전히 확인용 문구라 해롭지 않다
- P3 을 CRLF 보존해 넣자 R1 만 울었다 — 1차와 같다. 줄바꿈 전면 변경이 R11 을 가린 현상은
  이번 회차에서 재현하지 않았다(편집을 모두 줄바꿈 보존으로 했다). 그 추정은 확인되지 않은 채 남는다
