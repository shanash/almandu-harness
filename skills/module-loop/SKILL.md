---
name: module-loop
description: 이 리포의 파일을 바꾸는 작업을 맡으면 — 버그 수정·기능 구현·리팩터링·이름 바꾸기·삭제·설정이나 문서 수정 — 사용자가 `/module-work` 를 치지 않았어도 첫 수정 전에 부른다. 소유 계약(MODULE.md)을 먼저 열고 게이트와 리뷰를 거쳐 커밋까지 가는 `/module-work` 절차의 입구다. 읽기만 하는 질문·설명·조사, 이미 `/module-work`·`/module-review`·`/module-draft` 안에서 도는 작업, `node_modules/` 안의 파일에는 쓰지 않는다.
---

맡은 수정 작업을 `/module-work` 의 절차로 돈다. 이 스킬은 **언제** 그 절차에 들어가는지만 갖는다 — 절차의 문구는 `module-work` 한 곳에 있고 여기 옮겨 적지 않는다. 옮겨 적으면 이 리포가 고쳐 둔 `module-work` 와 갈라진다.

1. Skill 도구로 `module-work` 를 부른다. args 는 사용자가 맡긴 요청 전문이다 — 줄이거나 바꿔 쓰지 않는다
2. `module-work` 가 없으면(설치 뒤 지웠다) 리포 루트의 `node_modules/almandu-harness/commands/module-work.md` 를 Read 로 열고 그 절차를 따른다. 그 파일의 `$ARGUMENTS` 자리가 이번 요청이다
3. 절차가 멈추라는 자리에서 멈춘다. 커밋은 사용자가 요청했을 때만 한다 — 이 스킬은 사용자가 부르지 않아도 돌므로, 요청 없이 끝까지 가면 맡기지 않은 커밋이 생긴다

## 하지 말 것

- 이 스킬이 불렸는데 절차 없이 바로 고치기 — 계약을 열지 않은 경로는 커밋 단계에서 거부되고, 그때 되돌리는 것이 더 비싸다
- 한 작업 안에서 이 스킬을 다시 부르기 — 범위 밖 파일이 필요해지면 `module-work` 가 말하는 대로 `scope` 를 다시 부른다
