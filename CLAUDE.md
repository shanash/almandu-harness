@MODULE.md

이 디렉토리의 계약은 MODULE.md 에 있다. 불변식을 깨는 변경은 먼저 MODULE.md 를 고치고 이력을 남긴다.
하위 디렉토리에 MODULE.md 가 있으면 그쪽이 더 깊은 소유자다. 그 파일을 함께 읽어라.

## 이 리포는 AlMandu 파이프라인 위에서 개발하지 않는다 (2026-09-29)

이 하네스는 AlMandu 를 대체하려고 만든 것이다. 전역 규칙 중 AlMandu 파이프라인 항목은 여기서 적용하지 않는다 — 보안 원칙, 커밋·푸시 승인 경계, 주석 규칙은 그대로다.
- `/am:*` 스킬과 `am:*` 에이전트를 쓰지 않는다 — `.claude/settings.json` 이 이 리포에서 플러그인 `am@almandu` 를 끈다. `.am/`·`am-gate.json`·`am-calibration/`·`.claude/agent-memory/` 를 만들지 않는다 — 무시 목록에서 뺐으므로 생기면 `git status` 에 뜬다
- 설계는 세션 안에서 논의하고 근거는 `DESIGN.md` 에, 결과는 커밋·`MODULE.md` 이력·`observations/` 에 남긴다. 코드 주석이 작업 로그를 근거로 가리키지 않는다
- 커밋을 막는 것은 `.git/hooks/pre-commit` 의 게이트 하나다(전역 훅이 체인한다). 전역 규칙의 "`/am:verify` 통과" 는 여기서 "게이트가 0" 으로 읽고, `npm test` 는 CI(push·PR)가 돌고, diff 가 `[테스트]` 불변식의 근거를 건드리면 `node loop/loop.mjs review` 도 돈다. 훅이 없는 클론이면 먼저 놓는다:
  `printf '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/module-gate.mjs" --staged\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
