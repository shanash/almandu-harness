# 06 두 번째 소비 리포 — 한 생태계 모양의 기본값 둘 (2026-09-29)

대상: hwatu-cli (C++ 코어 + Unreal 클라이언트, 계약 2장 `draft`, v0.10.0). 대조로 kod-remastered (Unity, 계약 11장
`active`, v0.10.0) 와 이 리포를 함께 쟀다. 5단계 프롬프트 끝 절이 "'범용' 목표가 시험되는 첫 자리" 라고 적은
설치의 첫 관찰이다.

게이트에는 kod 에서 생긴 기본값이 둘 있었다 — R1 이 소스로 보는 확장자 `DEFAULT_WATCH`
(`.cs,.asmdef,.py,.sh,.mjs,.js,.ts`)와, 계약을 찾으며 건너뛰는 디렉토리 이름 `SKIP_DIRS`
(`.git,node_modules,Library,Temp,obj,Logs,builds`). 물은 것은 둘이다: C++·Unreal 리포에서 각각 무엇을 놓치는가,
그리고 고칠 자리가 소비 리포인가 게이트인가.

## 1. `watch` — 적혀 있었다

두 계약 모두 첫 초안 커밋부터 `watch` 를 적었다 (hwatu `b5dca8c` 2026-09-23, `b697596` 2026-09-24).

| 계약 | `watch` | 덮는 추적 파일 | 덮지 않는 것 |
|---|---|---|---|
| `MODULE.md` (루트 — `client-unreal/` 밖) | `.h,.cpp,.cs,Makefile,check_purity.sh` | `.h` 23 · `.cpp` 20 · `Makefile` · `tools/check_purity.sh` — 코드 전부 | `.md`·`.json`·`.toml`·`.jsonl`, 설치 도구가 놓은 `.githooks/pre-commit` |
| `client-unreal/MODULE.md` | `.h,.cpp,.cs,.ini,.uproject` | `.cpp` 45 · `.h` 36 · `.cs` 3(`*.Build.cs`·`*.Target.cs`) · `.ini` 4 · `.uproject` 1 — 코드 전부 | `.uasset` 104 · `.umap` 1 · `.png` 49 · `.wav` 2 같은 바이너리 에셋 |

기본값에 기댔다면 R1 은 `.cpp`·`.h` 변경에 한 번도 울지 않았다. 그 틈은 열려 있었지만 밟히지 않았다. 적은 것은
장치가 아니라 초안을 쓴 에이전트의 판단이다 — 스키마 템플릿은 `watch: .cs,.asmdef  # 선택` 만 보이고, 기본값이
무엇인지는 스키마에도 `/module-draft` 에도 없다. kod 도 11장 중 9장이 적었고, 기본값에 기대는 둘(`Engine`·
`restored-project`)은 Unity 모듈이라 기본값이 맞는 자리다.

관찰할 실패가 없다.

## 2. `SKIP_DIRS` — 걸러야 할 것을 걷고 있었다

`findModules` 는 파일시스템을 재귀로 걸으며 이름이 목록에 있는 디렉토리만 건너뛰었다. 소비 리포에는 이것을 고칠
자리가 없다 — 게이트의 상수이고, 스키마 필드는 3개월 동안 늘지 않는다.

| 리포 | 걷는 항목 | 추적 파일 | 걷는 항목의 대부분 |
|---|---|---|---|
| hwatu-cli | 3,521 | 333 | `client-unreal/Intermediate` 2,587 (73%) — 그중 Xcode `ProjectFiles` 2,140 |
| kod-remastered | 106,013 | 6,889 | 무시된 파이썬 가상환경 셋 96,874 (91%) — `spike-r0-2/.venv311` 60,397 · `spike-r0-1/.venv` 35,003 · `spike-r0-2/.venv` 1,474 |
| module-harness | 56 | 38 | — |

hwatu 에서 목록이 놓친 것은 Unreal 의 `Intermediate`·`Saved`·`Binaries`·`DerivedDataCache` 와 CMake 의 `build`(목록에는
kod 의 `builds` 가 있다)이고, kod 에서는 `.venv311` 처럼 이름을 미리 알 수 없는 가상환경이다. 둘 다 그 리포의
`.gitignore` 에는 이미 적혀 있었다.

틀린 답은 아직 없었다 — 세 리포 모두 걷기가 찾은 MODULE.md 가 추적된 계약과 같았다. 있던 것은 비용과 두 갈래의
잠재적 오답이다: 목록에 없는 이름의 무시된 디렉토리(가상환경의 패키지, 빌드 산출물) 안에 MODULE.md 가 생기면
계약으로 세고, 목록에 있는 이름의 **추적된** 디렉토리(예: `src/Library/`) 안의 계약은 말없이 빠진다.

## 3. 대조 — git 의 무시 규칙으로 찾으면

`git ls-files -z --cached --others --exclude-standard` 에서 고른 MODULE.md 를 걷기의 답과 대 보았다 (스크래치
스크립트, 각 2회). 둘 다 찾은 계약이 같았다 — kod 11, hwatu 2, 이 리포 2.

| 리포 | 걷기 | git |
|---|---|---|
| kod-remastered | 517~565ms | 18~24ms |
| hwatu-cli | 19~21ms | 9~10ms |
| module-harness | ~1ms | 7~8ms |

고친 게이트로 게이트 한 번(`--scope .`, 노드 기동 포함, 5회 중 최선)을 다시 쟀다 — kod 562 → 60ms, hwatu 59 → 47ms,
이 리포 42 → 47ms. 작은 리포에서는 git 을 한 번 띄우는 값이 걷기보다 비싸다. kod 의 옛 값은 첫 실행에서 1.36s 였고,
그 값을 게이트를 부르는 모든 자리가 냈다 — 커밋마다 훅이, 루프가 명령마다 몇 번씩.

## 4. 함정 둘

**패스스펙으로 거르면 환경변수 하나에 계약이 빠진다.** 출력을 줄이려고 `-- MODULE.md '*/MODULE.md'` 를 붙이면 kod 에서
11장이 나오지만, `GIT_LITERAL_PATHSPECS=1` 인 셸에서는 **0장**, `GIT_GLOB_PATHSPECS=1` 에서는 3장(깊이 1 뿐)이다.
게이트가 말없이 계약을 잃는 것은 가장 나쁜 쪽의 실패라, 패스스펙 없이 전체 목록을 받아 JS 에서 거른다.

**전체 목록은 파일 수에 비례한다.** kod 의 출력이 이미 492,245 바이트다 — `execFileSync` 기본 `maxBuffer`(1MB)의
절반이라, 파일이 두 배쯤인 Unity 리포에서는 게이트가 ENOBUFS 로 죽는다.

## 5. 무엇을 했나

- `watch`: 바꾸지 않았다. 스키마가 기본값을 말하지 않는 것은 DESIGN.md 10절 미결로 남겼다
- `SKIP_DIRS`: 없앴다. 게이트와 설치 도구가 계약을 git 의 무시 규칙으로 찾는다 — 결정과 고르지 않은 판은 DESIGN.md
  7절 "두 번째 소비 리포가 드러낸 기본값", 테스트와 양성 대조는 `MODULE.md` 이력 2026-09-29
