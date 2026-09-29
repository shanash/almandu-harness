# 변경 기록

판마다 소비 리포가 **무엇을 받고, 올릴 때 무엇을 해야 하는지**만 적는다. 왜 그렇게 바뀌었는지는 적지 않는다 —
판마다 끝의 "사유" 가 가리키는 `MODULE.md`(루프는 `loop/MODULE.md`) 이력의 그날 줄이 출처다.

- 이 파일은 리포에만 있다 — 패키지에는 실리지 않는다. 날짜는 태그를 찍은 날(KST)이다
- 밀어 올린 태그는 옮기지 않는다. 고칠 것이 생기면 다음 판이 받는다
- 0.x 동안 minor 는 호환성 파괴일 수 있다 (DESIGN.md 7절 버전 표)
- **게이트 규칙을 조인 판은 아직 없다.** `module-gate.mjs` 는 v0.3.0 뒤로 0.11.0 에서 처음 바뀌었고 그것도 규칙이
  아니라 계약을 **찾는** 방법이다. v0.3.0 앞에서 는 것은 모드(`--json`·`--scope`·`--review`)뿐이다. 이미 통과하던 계약서가 FAIL 이 된 판은 0.7.0 하나다 — 규칙이 아니라
  패키지 이름이 바뀌어 옛 R14 표지가 설치 목록과 어긋난다 (그 판의 **이전**)
- 0.1.0·0.2.0 은 `package.json` 버전으로만 있었다 — 태그가 없어 태그로 설치할 수 없다

"올릴 때 할 일" 의 표시는 GUIDE.md 7절의 단계를 가리킨다. 어느 판이든 1단계(`--audit` 전수 확인)는 한다.

| 표시 | 할 일 |
|---|---|
| 없음 | 태그를 바꿔 설치하면 끝난다 |
| 커맨드 | `.claude/commands/` 의 사본을 지우고 설치 도구를 다시 돌린다 — 있는 파일은 덮지 않는다 (2단계) |
| 훅 | 이미 놓인 훅 파일과 루트 CLAUDE.md 의 계약 문단은 설치 도구가 덮지 않는다 — 훅 파일은 지우고 설치 도구를 다시 돌리고, 문단은 README 경로 형태 표대로 손으로 옮긴다 |
| 배선 | 설치 도구를 다시 돌리면 전에 배선하지 못한 자리에 배선한다 |
| 스킬 | 설치 도구를 다시 돌린다 — 새로 실린 파일이라 지울 것 없이 놓인다 (2단계) |
| 이전 | 설치 자리나 bin 이름이 바뀌었다 — README 의 그 절대로 **한 커밋**에 옮긴다 (3단계) |

## [Unreleased]

## [0.11.0] — 2026-09-29

- `LICENSE` 가 패키지에 실린다 — 모든 권리 보유, 사용 허락 없음 (README 라이선스 절). `package.json` 의 `license` 는 그대로 `UNLICENSED` 다
- 내려진 페르소나 두 파일(`review/personas/contract-checker.md`·`scope-watcher.md`) 맨 위에 묘비 한 줄이 붙었다. 질문 본문은 그대로다
- 이 파일이 생겼다 (리포에만 있다)
- `module-harness-init.mjs` 의 주석 세 줄이 근거로 패키지에 없던 작업 로그 대신 `DESIGN.md` 7절을 가리킨다. 동작은 그대로다
- 입구 스킬 `skills/module-loop/SKILL.md` 가 실리고, 설치 도구가 `.claude/skills/module-loop/` 에 놓는다 — 파일을 바꾸는 작업을 맡기면 `/module-work` 를 치지 않아도 에이전트가 그 절차로 들어간다. 절차는 담지 않고 `module-work` 를 부른다. `--no-commands` 가 함께 끈다. 커맨드 문구는 그대로다
- 게이트와 설치 도구가 계약을 git 의 무시 규칙으로 찾는다 — 이름 목록(`Library`·`Temp`·`obj`·`Logs`·`builds` 등)으로 디렉토리를 건너뛰며 파일시스템을 걷던 것을, 추적 파일과 무시되지 않은 새 파일 중에서 고르는 것으로 바꿨다. 무시된 자리(빌드 산출물·가상환경)의 MODULE.md 는 계약이 아니고, 설치 도구도 거기에 어댑터를 놓지 않는다. 그 이름의 **추적된** 디렉토리에 계약이 있었다면 이제 처음 판정된다 — 1단계 `--audit` 이 세는 모듈 수가 늘어 먼저 드러난다(`--audit` 은 인용 줄만 대조한다). 판정 규칙은 그대로다

올릴 때 할 일: **스킬**

사유: `MODULE.md` 이력 2026-09-28 (묘비 · LICENSE 와 CHANGELOG), 2026-09-29 (AlMandu 파이프라인에서 끊기 · 입구 스킬 · 계약을 무시 규칙으로 찾기 · 0.11.0) · DESIGN.md 7절 버전 (1.0 을 보지 않은 것)

## [0.10.0] — 2026-09-23

- 설치 스크립트가 이미 설치된 git 태그를 다른 태그로 올릴 수 있다 — npm 12 에서 EALLOWGIT 로 죽던 것을, `package-lock.json` 루트 레코드의 `almandu-harness` 한 키를 새 spec 으로 맞춰 고쳤다. npm 이 저장하기 전에 끝나면(실패·중단) 락을 되돌린다
- 패키지에 실리는 파일은 버전과 README 의 테스트 수 한 줄 말고는 0.9.0 과 같다

올릴 때 할 일: **없음**. 설치 스크립트로 올린다면 v0.10.0 이상 태그의 스크립트를 쓴다 — 그 앞의 스크립트는 npm 12 에서 이미 설치된 태그를 올리다 죽는다

사유: `MODULE.md` 이력 2026-09-23 0.10.0 · DESIGN.md 7절 버전 (1.0 을 미룬 것)

## [0.9.0] — 2026-09-23

- 설치 도구가 훅 배선을 스스로 판단한다. `core.hooksPath` 는 켜도 아무것도 가리지 않을 때만 켜고, 켤 수 없으면 git 이 실제로 pre-commit 으로 실행할 파일에 게이트 호출을 얹는다 — git 디렉토리 안이거나 추적되지 않는 자리이고, 실행 가능하고, sh 계열일 때만. 없으면 만들고 있으면 shebang 바로 뒤에 넣는다
- 설치 도구에 `--override-hooks` 가 생겼다 (0.8.0 까지는 설치 스크립트에만 있었다). 설치 도구의 `--dry-run` 이 `core.hooksPath` 계획도 낸다
- 설치 스크립트의 종료 코드 3 이 "남의 것을 말없이 바꾸지 않고는 배선할 수 없다" 일곱 경우로 좁아졌다 (README 종료 코드 표)
- 놓는 훅 파일은 0.8.0 과 바이트 단위로 같다

올릴 때 할 일: **배선** — 0.8.0 에서 종료 코드 3 으로 끝났던 리포는 설치 도구를 다시 돌린다. 훅 파일은 지우지 않아도 된다. 얹은 자리(`.git/hooks/`)는 클론에 따라오지 않으므로 재클론한 뒤에도 설치 도구를 한 번 돌린다 (README 설치 스크립트 절)

사유: `MODULE.md` 이력 2026-09-23 [A]·[B]·[C] · DESIGN.md 7절 설치 (2026-09-23)

## [0.8.0] — 2026-09-22

- 소비 리포용 커맨드 셋 `commands/`(`/module-work`·`/module-review`·`/module-draft`)이 실리고, 설치 도구가 `.claude/commands/` 에 놓는다. `--no-commands` 로 끈다
- 설치 도구가 놓는 훅과 루트 CLAUDE.md 계약 문단이 게이트를 이름 해석 실행기가 아니라 설치 자리의 파일 경로로 부른다. 규칙서(`MODULE-schema-v1.md`)의 명령 예시도 같다 (README 경로 형태의 경계)
- 설치 스크립트 `almandu-harness-install.sh` 가 생겼다 — 패키지에는 싣지 않고 클론이나 태그의 raw URL 에서 돈다. 대상 리포의 git 최상위에 `package.json`·`.npmrc`·`.gitignore` 를 맞추고 설치한 뒤 설치 도구를 부르고, 훅이 부르는 게이트가 실제로 실행되는지까지 본다. v0.7.0 미만 태그는 받지 않는다
- README 에 npm 12 의 `allow-git=root` 안내가 들어갔다

올릴 때 할 일: **커맨드** — 처음 실리는 판이라 설치 도구를 다시 돌리면 놓인다. **훅** — 새 형태는 설치 도구가 덮지 않으므로 옮겨야 들어온다. 워크스페이스 멤버 리포(npm 11 이하)에서는 옛 형태가 판정 대신 npm 오류로 커밋을 막는다

사유: `MODULE.md` 이력 2026-09-20 0.8.0 · 2026-09-21 (훅 파일 경로 · 정지 가드) · 2026-09-22 (부르는 형태 · 규칙서의 처방문)

## [0.7.0] — 2026-09-18

- 패키지 이름이 `module-harness` 에서 `almandu-harness` 로 바뀌었다 — 설치 자리가 `node_modules/almandu-harness/` 다. 패키지 이름에는 별칭이 없다
- 정식 bin 은 `almandu-module-gate`·`almandu-harness-init`·`almandu-module-loop` 이고, 옛 이름 셋은 같은 파일을 가리키는 별칭이다
- R14 표지는 `(외부: almandu-harness)` 다 — 설치 목록과 안 맞는 옛 표지에는 R14 가 운다
- 설치 도구가 놓는 훅과 루트 문단이 새 bin 이름을 부른다
- GitHub 리포 이름도 `shanash/almandu-harness` 로 바뀌었고 옛 이름은 넘겨 주지 않는다. v0.3.0~v0.7.0 태그 안의 README 설치 줄은 옛 리포 이름이다 — 어느 태그든 새 리포 이름으로 설치한다

올릴 때 할 일: **이전** — README "이름 변경 (0.7.0)" 절의 다섯 단계를 한 커밋에. 이미 놓인 훅은 옛 bin 이름(별칭)으로 그대로 돈다

사유: `MODULE.md`·`loop/MODULE.md` 이력 2026-09-18 0.7.0 · DESIGN.md 7절 배포 (리포 이름)

## [0.6.0] — 2026-09-18

- 루프(`loop/loop.mjs`, bin `module-loop`)와 리뷰 페르소나(`review/`)가 패키지에 실린다 — 한 태그가 게이트·루프·페르소나를 함께 고정한다. 그 전에는 `file:` 로 설치한 리포만 받았다
- 루프의 명령·플래그·종료 코드·트레일러 형식이 공개 표면이 됐다 (DESIGN.md 7절 버전 표)

올릴 때 할 일: **없음**. 루프를 이 리포의 체크아웃에서 부르던 리포는 설치 자리의 사본으로 옮길 수 있다

사유: `MODULE.md`·`loop/MODULE.md` 이력 2026-09-18 0.6.0

## [0.5.0] — 2026-09-18

- 루프: 리뷰한 트리와 커밋하는 트리를 대조한다 — 패킷에 본문 해시(`diff.content`)를 넣고, 다르면 답을 싣지 않고 `Review: none` 으로 남긴다
- 루프: 통과가 아닌 리뷰 답을 `Review-Verdict:` 트레일러로 커밋에 싣는다
- 루프: `scope` 가 트리·HEAD 어디에도 없고 부모 디렉토리도 없는 경로를 거부한다
- 페르소나 둘이 내려졌다 — 계약 대조자(2026-09-16), 범위 감시자(2026-09-17). 루프가 그 둘의 답을 받지 않는다
- 루프와 페르소나는 아직 패키지 밖이다 (0.6.0 에 실린다)

올릴 때 할 일: **커맨드** — 리뷰 커맨드 사본이 내려진 두 페르소나를 부르면 뺀다

사유: `loop/MODULE.md` 이력 2026-09-17 0.5.0 · 2026-09-16 (계약 대조자) · 2026-09-17 (범위 감시자)

## [0.4.1] — 2026-09-13

- 페르소나 출력 형식: 답을 코드펜스로 감싸지 않는다. 계약 대조자의 근거 줄번호는 작업 트리 파일의 실제 줄이다
- 패키지 밖의 변경이다 — 실리는 파일은 버전 말고 0.4.0 과 같다

올릴 때 할 일: **없음**

사유: `MODULE.md` 이력 2026-09-13 0.4.1 · 5d 결함1 · 5d 결함2

## [0.4.0] — 2026-09-13

- 루프: `review --packet`(페르소나에게 줄 패킷을 만든다)과 `review --answer`(답을 받아 적는다), 커밋 트레일러 `Review:`·`Review-Result:`
- 리뷰 페르소나 셋(`review/personas/`) — 계약 대조자·불변식 판정자·범위 감시자
- 패키지 밖의 변경이다 — 실리는 파일은 버전 말고 0.3.0 과 같다

올릴 때 할 일: **없음**

사유: `MODULE.md` 이력 2026-09-13 0.4.0 · 2026-09-12 5b, `loop/MODULE.md` 이력 2026-09-12 5a · 5b

## [0.3.0] — 2026-09-12

- 설치 도구 `module-harness-init`(bin) — `.githooks/pre-commit` 훅과 `core.hooksPath`, 루트 CLAUDE.md 의 계약 문단, MODULE.md 가 있는데 CLAUDE.md 가 없는 디렉토리의 어댑터를 놓는다. 어댑터 문구는 규칙서에서 읽는다. 있는 파일은 덮지 않는다. `--dry-run`·`--hooks-path`·`--no-config`
- 게이트 `--review` — 판정하지 않고, 이 diff 를 리뷰할 때 봐야 할 불변식을 태그별로 낸다
- 규칙서: "태그가 리뷰어를 정한다", "계약 갱신은 코드 커밋과 같은 묶음이다" 절
- 루프(`loop/`)가 리포에 생겼다 — 패키지에는 0.6.0 에 실린다

올릴 때 할 일: **없음** — 첫 태그다. 손으로 두던 훅·문단·어댑터는 설치 도구가 없는 것만 놓는다

사유: `MODULE.md` 이력 2026-09-12 운영 · 5단계 · 4b

## 0.2.0 — 2026-09-12 (태그 없음)

- 게이트 `--json`(같은 판정을 stdout 에 JSON 으로 — 봉투의 `fail` 이 종료 코드와 같다)과 `--scope <경로>...`(판정하지 않고, 그 경로를 고치려면 읽어야 할 계약을 깊은 것부터 낸다)

사유: `MODULE.md` 이력 2026-09-12 4a

## 0.1.0 — 2026-09-12 (태그 없음)

- kod-remastered 의 `.harness/` 에서 떨어져 나와 npm 패키지 `module-harness` 가 됐다 — bin `module-gate`, 규칙 R0~R14, `--staged`·`--base`·`--fix`·`--audit`, 규칙서 `MODULE-schema-v1.md`

사유: `MODULE.md` 이력 2026-09-12 (npm 패키지가 됐다)

[Unreleased]: https://github.com/shanash/almandu-harness/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/shanash/almandu-harness/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/shanash/almandu-harness/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/shanash/almandu-harness/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/shanash/almandu-harness/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/shanash/almandu-harness/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/shanash/almandu-harness/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/shanash/almandu-harness/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/shanash/almandu-harness/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/shanash/almandu-harness/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shanash/almandu-harness/tree/v0.3.0
