# 1번(미설정 변수 전용 문법) 예측 — 2026-09-11

## 이 문서가 재는 것

작업 1번을 하는 동안 MODULE.md 게이트가 **무엇을 잡고 무엇을 놓치는지**를 사전에 적어 둔다.
작업 후 대조해서 놓친 것을 두 종류로 갈라낸다 — 게이트가 못 잡은 것(규칙 부족)과 내가 예측도
못 한 것(계약 부족). 대응이 다르므로 섞이면 둘 다 안 고쳐진다.

- 기준선: `.harness/baseline-module-gate.txt` — 깨끗한 트리에서 `0 FAIL, 8 WARN` (전부 R3 모듈 후보). gitignored
- 게이트 등록: `am-gate.json` commands[4] `module-gate`, **non-blocking**, 작업 트리 모드(`--staged` 아님)
- **모든 모듈이 `status: draft`** → `module-gate.mjs:117-118` 의 `strict()` 가 거짓이므로 R1·R2·R11 은 전부 **WARN**. R0 만 무조건 FAIL. 작업 1번 중 게이트가 커밋을 막는 일은 없다
- 작업 1번의 근거: `restored-project/Assets/Scripts/Engine/MODULE.md:44` — "결정: 미설정 변수를 확인하는 전용 문법을 언어에 추가하고 대본 관용구를 옮긴다. I6·I7 은 그때까지 현행 동작 계약이고 마이그레이션이 끝나면 재작성한다 (예정)"

## 건드릴 곳

| 위치 | 소유 모듈 | 걸릴 계약 | 예상 게이트 반응 |
|---|---|---|---|
| `Engine/Conditions/LeComparisonOperator.cs` | engine | I6·I7 (근거 파일 본체) | R1 WARN + I6·I7 재작성 시 R2 WARN |
| `Engine/Parser/`, `LeScriptCompiler` | engine | I6·I7 간접 · 진입점 칸 아님 | R1 WARN (같은 모듈이라 위와 합산 1줄) |
| `Assets/Tests/Editor/UnsetVariableSemanticsTests.cs` | **restored-project**(루트) | engine I6·I7 의 검증 수단 | **R11 WARN on engine** (소유자가 조상이라 R6 은 면제) |
| `Actions/FlowControl/LeActionIf.cs` | actions | actions I1(LeParseError 단일 경로) | R1 WARN on actions |
| `Actions/FlowControl/LeActionAlter.cs` | actions | actions I1 근거 파일 본체(:55) | R1 WARN on actions |
| `tools/kod_converter/commands.py` | tools | tools I4(사본 1벌) · 루트 I9(미러) | R1 WARN on tools |
| `tools/tests/test_command_tables.py` | tools | 루트 I9 의 근거 | R1 WARN on tools + **R11 WARN on restored-project** |
| `ScriptBinary/ActionNameMap.cs`·`LeActionKeys.cs`·`KodAdapter.cs` | scriptbinary | I5·I6·I7 · 루트 I9 | R1 WARN on scriptbinary |
| `Assets/Tests/Editor/ActionNameMapTests.cs`·`KodAdapterTests.cs` | restored-project(루트) | scriptbinary I5·I6·I7 의 검증 수단 | **R11 WARN on scriptbinary** |
| 챕터 `.kod` 코퍼스 967개 (`Resources/scripts-v2/`) | restored-project(루트) | 없음 — 계약이 코퍼스를 인용하지 않는다 | **침묵** (아래 참조) |
| 챕터 `.bytes` 재빌드 | — (gitignored) | engine I2·I4·I5 | **침묵** (아래 참조) |
| `engine/MODULE.md` I6·I7 재작성 + 미결:44 삭제 | engine | 계약 섹션 본체 | 이력 줄 없으면 R2 WARN · 있으면 침묵 |

## 침묵 예상 — 기제까지 확인된 것

게이트가 못 잡을 것을 기제와 함께 미리 못 박아 둔다. 여기 적힌 대로 침묵하면 예측 성공이지
게이트 성공이 아니다.

1. **`.kod` 코퍼스 967개를 전부 고쳐도 R1 은 울지 않는다.**
   `module-gate.mjs:20` 의 `DEFAULT_WATCH` = `.cs .asmdef .py .sh .mjs .js .ts`. `.kod` 가 없고,
   코퍼스를 소유한 루트 `restored-project/MODULE.md` 는 frontmatter 에 `watch:` 오버라이드가 없다.
   1번이 관용구를 전부 옮기는 작업이라 이게 실제로 걸린다.
   → **루트에 `watch: .cs,.asmdef,.kod` 를 넣는 판단은 지금 하지 않는다.** 실제로 침묵하는 것을
   보고 나서, 침묵이 아픈지(코퍼스 변경이 계약을 흔드는지) 아니면 정당한 무시인지를 근거로 정한다.
   미리 고치면 "게이트가 원래 못 봤다" 는 사실이 기록에서 사라진다.

2. **`.bytes` 재빌드는 어느 모드에서도 보이지 않는다.**
   챕터 바이너리는 `restored-project/.gitignore:11`(`Assets/Resources/objects/`)로 무시된다.
   `module-gate.mjs:74` 의 untracked 수집은 `--exclude-standard` 라 ignored 를 제외하고,
   `git diff` 에도 안 잡힌다. engine I2(actionCode 불일치)·I4(헤더 버전)·I5(재직렬화 동일성)가
   걸리는 변경인데 게이트는 구조적으로 눈이 없다. 유일한 검증은 `Assets/Tests/Editor/` 의
   round-trip 테스트이고 그건 `converter-tests` 가 아니라 Unity Test Runner 소관이다.
   `LeActionIf.cs:97` 이 `GetCalculatorIndex(calc)` 를 `_Save` 에 쓰므로 연산자 추가는 곧
   `.bytes` 인덱스 공간 변경이다 — 이 경로를 사람이 직접 봐야 한다.

3. **미결:44 의 "(예정)" 결정 줄은 구현이 끝나도 R10 이 안 잡는다.**
   `module-gate.mjs:184-186` 은 `결정:` 줄에 `(예정)` 이 **있으면** 정상으로 넘긴다. 마이그레이션이
   끝나 그 줄을 지워야 하는 시점을 게이트는 알 수 없다. R10 은 "(예정) 없는 결정 줄" 만 잡으므로
   방향이 반대다. 줄 삭제 + I6·I7 재작성은 순수하게 사람 책임.

4. **engine MODULE.md 는 59줄, `MAX_LINES` 는 80.** I6·I7 재작성 + 이력 2~3줄이면 65줄 안쪽이라
   R4(분할 후보)는 안 울 전망. 새 불변식을 3개 이상 세우면 넘길 수 있다.

## `--staged` 에서만 다르게 도는 것 (B-2 실측, 2026-09-11)

작업 중 처음 만나면 헷갈릴 차이를 미리 실측해 둔다. 등록은 작업 트리 모드이지만 CLAUDE.md 는
`--staged` 를 커밋 전 모드로 안내하므로 손으로 돌릴 일이 있다.

- **tracked `.cs` 를 `git add` 하면 R1 은 양쪽 모드에서 똑같이 운다.** (확인)
- ~~**새 MODULE.md 를 `git add` 하지 않으면 `--staged` 가 R1 을 *거짓으로* 울린다.**~~
  **게이트 버그였고 고쳤다** (`module-gate.mjs:74-79`). `findModules()`(`:28-37`)는 파일시스템을
  걷는데 `changedSet` 은 인덱스만 봐서, 방금 쓴 계약서를 "소스 변경, MODULE.md 미변경" 이라고
  답했다. 침묵이 아니라 헛울음 — 게이트가 거짓말하는 경로였다.
  수정: `--staged` 에서도 untracked **MODULE.md** 는 "변경됨" 으로 센다. untracked 파일은 커밋에
  아직 없으니 내용 전체가 변경이다. 소스는 그대로 제외 — staged 가 아닌 `.cs` 는 실제로 커밋에
  안 들어간다.
- ~~**그 상태에서 R2 는 아예 돌지 않는다.**~~ 같은 뿌리였고 같이 해결됐다. R2 블록은
  `if (docChanged)` 안인데(`:154-160`) `docChanged` 가 이제 참이므로, 갓 만든 계약서의 이력 줄
  누락이 `--staged` 에서도 R2 로 잡힌다 (실측 확인).
- **두 모드가 이제 정확히 같은 답을 낸다** — probe 3개에서 WARN 집합·개수 모두 일치.
- **부수 발견**: 새 모듈이 서면 기존 모듈의 근거 소유권을 빼앗아 R6 이 운다. probe 로
  `tools/kod_converter/MODULE.md` 를 세웠을 때 `tools I6 근거 tools/kod_converter/tokenizer.py 가
  [[probe]] 소유이지만 out 에 없음` 이 떴다. 1번이 새 모듈을 세우는 작업은 아니지만,
  분할 후보를 승격할 때 이 반응을 기대할 수 있다.

## 예측 못 하겠는 것

- **새 문법의 `.kod` 라벨을 누가 소유하는가.** scriptbinary 책임 칸은 "`.kod` 라벨↔`LeAction` 이름
  매핑" 을 자기 것이라 적었지만(`MODULE.md:10`), 그 라벨이 *조건식 안의 연산자* 라면 `ActionNameMap`
  이 아니라 `LeComparisonOperator`(engine) 가 판정한다. 경계가 어디서 갈리는지 코드를 고쳐 보기
  전에는 모르겠다.
- **루트 I9 의 소유권이 실제로 어느 쪽으로 기우는가.** `tools/MODULE.md:36` 이 이미 "규칙 소유자를
  이쪽으로 옮길지 형제 인용으로 둘지 미결" 이라고 적어 뒀다. `commands.py` 미러에 새 문법을 넣는
  순간 이 미결을 건드려야 할 텐데, 옮기면 루트 I9 가 사라지고 `actions/MODULE.md:41`
  ("쪼개면 미러 규칙이 반으로 끊기므로 루트에 둔다")과 충돌한다. 세 계약서가 같은 상수를 두고
  삼각 구도라 어디로 정리될지 예측이 안 된다.
- **actions 쪽에 계약 변경이 필요한지 자체가 불확실.** `LeActionIf` 는 `LeComparisonOperator` 에
  위임만 하므로(`:38,89`) 전용 문법이 연산자 레벨에서 끝나면 actions 는 손대지 않을 수도 있다.
  그 경우 위 표의 actions 행 2개가 통째로 빠진다.
- **I6·I7 을 재작성으로 끝낼지, 폐기 묘비 + 신설로 갈지.** 현행 동작을 계약에서 지우는 것이므로
  `restored-project/MODULE.md:30` 의 I5 처럼 묘비를 남기는 편이 맞을 수 있는데, 그건 이관이 아니라
  폐기라 선례가 다르다. `module-gate.mjs:193` 은 `(폐기` 표기를 근거·검증 수단 요구에서 면제하므로
  둘 다 게이트를 통과한다 — 게이트가 갈라 주지 않는 판단이다.
- **연산자 인덱스 공간을 늘리면 기존 세이브가 깨지는지.** engine I2 는 actionCode 만 말하고
  연산자 인덱스는 계약에 없다. `.bytes` 도 세이브도 게이트 눈 밖이라 사전 예측 근거가 없다.

## 사후 대조란

(작업 후 채움)

### 예측대로 울었나
| 예측 | 실제 | 판정 |
|---|---|---|

### 게이트가 못 잡았고 나는 예측했다 → 규칙 부족
(비움)

### 게이트가 못 잡았고 나도 예측 못 했다 → 계약 부족
(비움)

### 예측이 틀렸다
(비움)

---

# 갱신 (2026-09-11) — 착수 직전 실측

원본 문단은 한 글자도 지우지 않았다. 원본이 쓰인 뒤 리포가 세 군데 움직였고, 그중 둘은
원본의 결론("이 작업 중 게이트가 커밋을 막는 일은 없다")을 뒤집는다.

## 전제 정정 3건

| 원본이 적은 것 | 2026-09-11 실측 | 결과 |
|---|---|---|
| 기준선 `0 FAIL, 8 WARN` (전부 R3 모듈 후보) | `module-gate: OK (5 modules, 2 changed files)` — 0 FAIL **0 WARN** | 75ece3e 가 "미결이 이미 모듈 후보로 적었으면 침묵" 을 R3 에 넣어 8 WARN 이 전부 사라졌다. `.harness/baseline-module-gate.txt` 는 현재 빈 파일이라 기준선 대조에 못 쓴다 |
| `am-gate.json` module-gate **non-blocking** | `"blocking": true` | implement-result.md 의 [DISCREPANCY-1] 이 적어 둔 승격 조건("모듈을 `status: active` 로 전환")이 engine 에서 충족돼 전환됐다 |
| **모든 모듈이 `status: draft`** → R1·R2·R11 전부 WARN | engine 만 `status: active`. restored-project·actions·scriptbinary·tools 는 draft | **engine 에서 나는 경고는 FAIL 이고 게이트가 exit 1 로 커밋을 막는다** |

## 등급 지도 (module-gate.mjs 실독)

`lvl(m)` = `strict(m) ? 'FAIL' : 'WARN'`, `strict` = `status === 'active'` (`:117-118`).
그런데 모든 규칙이 `lvl()` 을 쓰는 것은 아니다 — 세 규칙은 `'WARN'` 이 하드코딩돼 있어
**engine 이 active 여도 WARN 으로 나온다**:

- `lvl(m)` 사용 (engine 에서 FAIL): R1 R2 R3-대칭 R4 R5 R7 R9 R10 R11
- `'FAIL'` 고정 (모듈 무관): R0
- `'WARN'` 고정 (engine 에서도 WARN): **R6 · R8 · R12 · R3-모듈후보**

원본이 "R0 만 무조건 FAIL" 이라고 적은 것은 draft 전제에서만 맞다. 지금은 R0 + engine 의 9개 규칙이
커밋을 막을 수 있고, R6·R8·R12 는 engine 이 active 가 돼도 영원히 조언 등급이다.

## 건드릴 곳 — 다시 적은 표

작업 [1](문법 추가)의 실제 파일 목록. 코드를 읽고 확정했고, 원본 표의 tools·scriptbinary 행 2개는
**빠진다** (아래 "원본이 예측했지만 일어나지 않는 것" 참조).

| 위치 | 소유 모듈 | 걸릴 계약 | 예상 게이트 반응 |
|---|---|---|---|
| `restored-project/Assets/Scripts/Engine/Conditions/LeComparisonOperator.cs` | engine (**active**) | I6·I7 근거 파일 본체 | MODULE.md 동반 변경 시 **침묵**. 빠뜨리면 **FAIL engine R1** → exit 1 |
| `restored-project/Assets/Scripts/Actions/FlowControl/LeActionIf.cs` | actions (draft) | I1(LeParseError 40건) | MODULE.md 동반 시 침묵, 아니면 **WARN actions R1** |
| `restored-project/Assets/Tests/Editor/UnsetOperatorTests.cs` (신규) | restored-project (draft) | I12 의 검증 수단이 된다 | **WARN restored-project R1** |
| `restored-project/Assets/Tests/Editor/KodAdapterTests.cs` | restored-project (draft) | scriptbinary I7 근거(:2832) | **WARN restored-project R1** + **WARN scriptbinary R11** |
| `restored-project/Assets/Scripts/Engine/MODULE.md` | engine | 불변식·미결·이력 | 이력 줄 있으면 침묵, 없으면 **FAIL engine R2** |
| `restored-project/Assets/Scripts/Actions/MODULE.md` | actions | 불변식 I1 | 이력 줄 없으면 **WARN actions R2** |

합계 예측: **0 FAIL, 3 WARN** (restored-project R1, scriptbinary R11, 그리고 KodAdapterTests·신규
테스트가 같은 모듈이라 R1 은 한 줄로 합쳐지므로 실제로는 2줄일 수 있다 — 실측으로 확인한다).

## 원본이 예측했지만 일어나지 않는 것

착수 전에 코드를 열어 확인했다. 예측이 틀린 것이므로 사후 대조가 아니라 여기에 적는다.

1. **`tools/kod_converter` 는 손댈 게 없다.** 원본 표는 `commands.py` 수정 → `tools` R1 을 예측했다.
   실제로 `generator.py:418-435` 의 `_transform_condition` 은 조건 꼬리를 토큰 수에 관계없이 통과시킨다:
   `_transform_condition("만약 주인공 설정됨")` → `"$주인공 설정됨"` (실행 확인).
   `value` 가 빈 문자열이라 `$` 접두 분기를 타지 않고 `rstrip()` 이 꼬리 공백을 지운다.
   `commands.py` 는 **명령 이름** 표이고 연산자 표가 아니다 — 컨버터 어디에도 비교연산자 목록이 없다.
   따라서 원본 표의 `tools/kod_converter/commands.py` · `tools/tests/test_command_tables.py` 두 행과
   그에 딸린 `WARN tools R1` · `WARN restored-project R11` 예측은 **취소**된다.

2. **ScriptBinary 의 액션 이름 매핑도 손댈 게 없다.** `ActionNameMap`·`LeActionKeys` 에 비교연산자
   문자열이 0건이고(`KodArgTransformers.cs:242` 의 `"="`/`"+="`/`"-="` 는 `[변수]` 대입 연산자다),
   `만약`/`아니면` 은 애초에 등록된 액션이 아니라 `KodAdapter` 의 Path 1 이 직접 처리한다
   (`KodAdapter.cs:555-558`). 조건 꼬리를 쪼개는 `AppendComparisonOperands`(`:841-846`)는 공백
   split + `$` 제거뿐이라 토큰 수에 무관하다. 원본 표의 scriptbinary 행과 `ActionNameMapTests`·
   `KodAdapterTests` R11 예측 중 **scriptbinary 소스 쪽은 취소**된다 (테스트 쪽 R11 은 아래 3번 때문에 남는다).

3. **원본이 아예 몰랐던 세 번째 arity 소유자가 있다.** `KodAdapterTests.ScanGuardSites`
   (`:3020-3095`)는 코퍼스의 모든 `만약`/`아니면 만약` 줄을 훑어 **정확히 3토큰이 아니면
   `malformedCount++` 하고 `Assert.AreEqual(0, malformedCount)` 로 하드 페일**한다(`:3318`).
   근거로 적힌 이유가 바로 `LeActionIf._MakeFromRawFile` 이 `tokens[3]` 을 무조건 인덱싱한다는 것이다.
   후치 단항이 생기는 순간 그 전제가 거짓이 되므로, 이 게이트는 **[1] 과 같은 커밋에서** 2토큰 단항을
   받아들이게 고쳐야 한다. 안 고치면 [2] 에서 대본을 옮기는 즉시 EditMode 가 빨개진다.
   → 어느 MODULE.md 에도 이 arity 규칙이 없다. **계약 부족** 후보 1호.

4. **R1 과 "커밋을 기능 단위로 쪼갠다" 가 engine 에서 정면충돌한다.** 프롬프트는 문법 추가 /
   대본 이전 / 계약 갱신을 각각 따로 커밋하라고 한다. engine 이력은 "이 디렉토리의 `.cs` 를 고치면서
   이 파일을 같은 변경 묶음에서 건드리지 않는 커밋은 거부된다" 고 적었다. 둘 다 지킬 수는 없다.
   해소: **engine 계약 갱신은 engine `.cs` 커밋에 실린다.** 대본 이전의 결정 줄만 [2] 커밋으로 남긴다.
   → 이것은 게이트의 결함이 아니라 커밋 분할 규칙 쪽의 결함이다. 02 에 적는다.

## 코퍼스 건수 — 프롬프트·계약서와 실측이 어긋난다

프롬프트 [2] 와 `engine/MODULE.md` 미결이 똑같이 "setter **8파일 10곳**(`$주인공` 8·`$호구값` 2)" 이라고
적는다. 실측은 다르다 (`scripts-v2/**/*.kod` 967개 전수):

| 세는 대상 | 건수 | 파일 수 |
|---|---|---|
| 프로브 줄 `만약 $X = $임시_X_이름:` | **9** ($주인공 7 · $호구값 2) | **7** |
| 준비 줄 `[변수 $임시_X_이름 = "X"]` | **10** ($주인공 8 · $호구값 2) | **7** |

"10곳 / 주인공 8 / 호구값 2" 는 **준비 줄** 집계와 정확히 일치한다. 프로브 줄이 아니다.
차이 1건의 출처는 `4chapter/ch4_setter.kod:195-196` — 같은 준비 줄이 연속 두 번 있고 그것을 받는
`만약` 은 `:198` 하나뿐이다. 파일 수 8 은 어느 집계로도 나오지 않는다 (둘 다 7).

관용구 한 벌은 준비 줄 + 프로브 줄이므로 [2] 가 지울 줄은 **7파일 19줄**, 새 문법으로 바뀌는
조건문은 **9곳**이다. 프롬프트의 정지 조건에 걸리므로 [2] 착수 전에 멈추고 보고한다.

## 여전히 예측 못 하겠는 것

- 원본의 "예측 못 하겠는 것" 5개 중 1·2·3(`.kod` 라벨 소유자 / 루트 I9 삼각 구도 / actions 계약 변경
  필요 여부)은 위 1·2번으로 **해소**됐다: 연산자는 라벨 표를 거치지 않고, 루트 I9 는 안 건드리며,
  actions 는 `LeActionIf` 가 arity 를 알아야 하므로 손댄다.
- 4(I6·I7 재작성이냐 묘비냐)는 이번에 **판단 자체가 필요 없다** — 프롬프트가 I6·I7 을 손대지 말라고
  못박았고 미결도 그렇게 정해 뒀다. 남는다.
- 5(연산자 인덱스 확장이 기존 세이브를 깨는지)는 그대로 미지다. `.bytes` 도 세이브도 게이트 눈 밖이고,
  유일한 답은 [3] 의 round-trip 테스트다.
