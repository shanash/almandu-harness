#!/usr/bin/env bash
# almandu-harness-install.sh — 대상 git 리포에 하네스를 설치하고 init 까지 한 번에 돌린다 (DESIGN.md 7절 설치)
#
# 패키지에 싣지 않는다. 막으려는 실패가 패키지가 설치되기 **전에** 나기 때문이다 —
# npm 이 부모 디렉토리의 package.json 을 프로젝트 루트로 잡으면 대상 리포의 .npmrc 를 읽지 않고(EALLOWGIT),
# 그 시점에는 bin 이 존재하지 않아 init 도 게이트도 끼어들 수 없다. 그래서 클론이나 태그의 raw URL 에서 돈다.
#
# 판정하지 않는다. 종료 코드는 0 설치·훅 연결, 1 실패·거부, 2 사용법, 3 설치했지만 pre-commit 이 게이트를 부르지 않음.
#
# bash 3.2(macOS 기본)와 Git Bash 에서 돈다. 그래서 배열·declare -A·mapfile·[[ =~ ]]·${x,,}·
# readlink -f·realpath·sed -i·grep -P·stat 을 쓰지 않는다. 대신 case·(cd && pwd -P)·cksum·awk 를 쓴다.
#
# 쓰는 함수의 절반은 act() 가 이름으로 받아 부른다. shellcheck 는 그 간접 호출을 못 따라가
# "never invoked" 로 읽으므로(0.11.0 기준 7건) 파일 단위로 끈다. 대가는 진짜 죽은 함수도
# 같이 안 잡히는 것이고, 그 탐지는 act 를 쓰는 한 애초에 서지 않는다.
# shellcheck disable=SC2329
set -eu
set -o pipefail
unset CDPATH
export GIT_TERMINAL_PROMPT=0

DEFAULT_REF="v0.8.0"
REPO_URL="https://github.com/shanash/almandu-harness"
GH_BASE="github:shanash/almandu-harness"

# ---------- 출력 ----------
say()  { printf '%s\n' "$*"; }
ok()   { printf '  · %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
die()  { printf 'install: %s\n' "$1" >&2; exit 1; }
uerr() { printf 'install: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'USAGE'
사용: bash almandu-harness-install.sh <대상> [옵션]
      curl -fsSL https://raw.githubusercontent.com/shanash/almandu-harness/<태그>/almandu-harness-install.sh | bash -s -- <대상> [옵션]

<대상>                대상 작업 트리 안의 아무 디렉토리. "." 도 된다. 하나만 받는다.

--ref <태그>          설치할 태그 (기본은 스크립트 안의 DEFAULT_REF). v<N>.<N>.<N> 형식, v0.7.0 이상.
--spec <npm-스펙>     GitHub 스펙 대신 npm 이 받는 무엇이든 (file:../module-harness 등). --ref 와 함께 쓸 수 없다.
--hooks-path <디렉토리>  init 에 넘긴다. 리포 안의 상대 경로여야 한다.
--no-config           init 에 넘긴다: core.hooksPath 를 건드리지 않는다.
--no-commands         init 에 넘긴다: .claude/commands/*.md 를 놓지 않는다. 종료 코드에는 영향이 없다.
--override-hooks      이미 있는 core.hooksPath(로컬·전역)나 .git/hooks 의 훅을 덮거나 가리는 것을 허용한다.
--yes                 거부되는 둘을 허용한다: root/all 이 아닌 allow-git 값 교체, 하위 디렉토리 대상의 최상위 package.json 생성.
--dry-run             계획과 예상 종료 코드만 낸다. 아무것도 쓰지 않는다.
-h, --help            이 도움말.

종료 코드: 0 설치·훅 연결 · 1 실패·거부 · 2 사용법 · 3 설치했지만 pre-commit 이 게이트를 부르지 않는다
USAGE
}

# ---------- 도구 ----------
# 모든 쓰기는 이 함수를 지난다. 그래서 --dry-run 이 약속이 아니라 구조다
act() {
  _desc=$1; shift
  if [ "$DRY" = 1 ]; then printf 'DRY + %s\n' "$_desc"; return 0; fi
  "$@"
  printf '+ %s\n' "$_desc"
}

# JSON 은 grep 하지 않는다. 경로와 키를 argv 로 넘기므로 JS 소스에 보간되는 것이 없다.
# 종료 3 = JSON 이 깨졌다, 1 = 그런 키가 없다
json_get() {
  node -e '
const fs = require("fs");
let o;
try { o = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
for (const k of process.argv.slice(2)) {
  if (o === null || typeof o !== "object") process.exit(1);
  o = o[k];
}
if (o === undefined || o === null) process.exit(1);
process.stdout.write(typeof o === "object" ? JSON.stringify(o) : String(o));
' "$@"
}

ver_gt() {
  node -e '
const a = process.argv[1].split("."), b = process.argv[2].split(".");
for (let i = 0; i < 3; i++) {
  const x = Number(a[i] || 0), y = Number(b[i] || 0);
  if (x > y) process.exit(0);
  if (x < y) process.exit(1);
}
process.exit(1);
' "$1" "$2"
}

# 훅이 게이트를 부르고 git 이 실제로 돌릴 수 있는가. module-gate 는 almandu-module-gate 와 옛 별칭을 함께 잡는다
gate_hook() {
  [ -f "$1" ] || return 1
  if [ -z "$WIN" ] && [ ! -x "$1" ]; then return 1; fi
  _t=$(cat "$1")
  case "$_t" in *module-gate*) return 0 ;; esac
  return 1
}

WIN=
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; esac

# ---------- Phase 0 — 인수 ----------
TARGET=
REF=
SPEC=
HP=
NO_CONFIG=0
NO_COMMANDS=0
OVERRIDE=0
YES=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)            [ $# -ge 2 ] || uerr "--ref 에 태그가 필요하다"; REF=$2; shift 2 ;;
    --spec)           [ $# -ge 2 ] || uerr "--spec 에 npm 스펙이 필요하다"; SPEC=$2; shift 2 ;;
    --hooks-path)     [ $# -ge 2 ] || uerr "--hooks-path 에 디렉토리가 필요하다"; HP=$2; shift 2 ;;
    --no-config)      NO_CONFIG=1; shift ;;
    --no-commands)    NO_COMMANDS=1; shift ;;
    --override-hooks) OVERRIDE=1; shift ;;
    --yes)            YES=1; shift ;;
    --dry-run)        DRY=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    --*)              uerr "모르는 옵션: $1" ;;
    *)                [ -z "$TARGET" ] || uerr "<대상> 은 하나다 (둘째: $1)"; TARGET=$1; shift ;;
  esac
done

[ -n "$TARGET" ] || uerr "<대상> 이 필요하다 (--help 참고)"
if [ -n "$REF" ] && [ -n "$SPEC" ]; then uerr "--ref 와 --spec 은 함께 쓸 수 없다"; fi

if [ -n "$HP" ]; then
  case "$HP" in
    /*|~*|[A-Za-z]:*|..|../*|*/../*|*/..)
      uerr "--hooks-path 는 리포 안의 상대 경로여야 한다 (init 이 root 에 join 한다): $HP" ;;
  esac
fi

if [ -z "$SPEC" ]; then
  [ -n "$REF" ] || REF=$DEFAULT_REF
  # 글롭 문자를 먼저 떨군다 — 아래 case 의 패턴은 * 와 ? 를 그대로 통과시키고, 그러면 둘이 열린다:
  # `set -- $_num` 의 경로 확장과, ls-remote 가 refname 을 패턴으로 매칭하는 것(v0*.7*.0* → v0.7.0)
  case "$REF" in *[!v0-9.]*) uerr "--ref 에 쓸 수 있는 것은 v·숫자·점뿐이다: $REF" ;; esac
  case "$REF" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) uerr "--ref 형식은 v<N>.<N>.<N> 이다: $REF" ;;
  esac
  _num=${REF#v}
  # 따옴표를 붙이면 IFS 분할이 사라져 RMAJ/RMIN/RPAT 이 안 갈린다 — 분할이 목적이다.
  # directive 는 바로 다음 명령 하나에만 붙으므로 set -- 을 제 줄로 뗀다
  _ifs=$IFS; IFS=.
  # shellcheck disable=SC2086
  set -- $_num
  IFS=$_ifs
  RMAJ=${1:-x}; RMIN=${2:-x}; RPAT=${3:-x}
  case "$RMAJ$RMIN$RPAT" in
    ''|*[!0-9]*) uerr "--ref 형식은 v<N>.<N>.<N> 이다: $REF" ;;
  esac
  # v0.7.0 미만은 패키지 이름이 module-harness 라 almandu-* bin 이 아예 없다 (D3)
  if [ "$RMAJ" -eq 0 ] && [ "$RMIN" -lt 7 ]; then
    uerr "v0.7.0 미만 태그는 패키지 이름이 module-harness 라 almandu-* bin 이 없다: $REF"
  fi
  SPEC="$GH_BASE#$REF"
fi

# ---------- Phase 1 — 프리플라이트 (읽기만; 실패는 전부 첫 쓰기 전이다) ----------
for _t in git node npm; do
  command -v "$_t" >/dev/null 2>&1 || die "$_t 가 PATH 에 없다"
done
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "node 18 이상이 필요하다 (지금 $NODE_MAJOR)"
NPM_V=$(npm -v)
NPM_MAJOR=${NPM_V%%.*}

[ -d "$TARGET" ] || die "대상 디렉토리가 없다: $TARGET"
if ! IS_BARE=$(git -C "$TARGET" rev-parse --is-bare-repository 2>/dev/null); then
  die "git 작업 트리가 아니다: $TARGET"
fi
[ "$IS_BARE" = false ] || die "bare 저장소다 — 작업 트리가 없다: $TARGET"
INSIDE=$(git -C "$TARGET" rev-parse --is-inside-work-tree 2>/dev/null || printf 'false')
[ "$INSIDE" = true ] || die "git 작업 트리가 아니다: $TARGET"

ROOT=$(cd "$(git -C "$TARGET" rev-parse --show-toplevel)" && pwd -P)
TARGET_ABS=$(cd "$TARGET" && pwd -P)
SUBDIR=
[ "$TARGET_ABS" = "$ROOT" ] || SUBDIR=1

trap 'rm -f "$ROOT/.npmrc.almandu.$$"' EXIT

if [ -n "$SUBDIR" ]; then
  say "대상: $TARGET_ABS → $ROOT (git 최상위)"
else
  say "대상: $ROOT (git 최상위)"
fi

# package.json 상태
PKG="$ROOT/package.json"
PKG_STATE=none
CUR_SPEC=
CUR_FIELD=
if [ -f "$PKG" ]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$PKG" >/dev/null 2>&1 \
    || die "$PKG 를 JSON 으로 읽을 수 없다 — 먼저 고쳐라"
  PKG_STATE=ok
  PKG_NAME=$(json_get "$PKG" name 2>/dev/null || true)
  case "$PKG_NAME" in
    almandu-harness|module-harness) die "대상이 하네스 리포 자신이다: $ROOT" ;;
  esac
  if json_get "$PKG" devDependencies module-harness >/dev/null 2>&1 \
    || json_get "$PKG" dependencies module-harness >/dev/null 2>&1; then
    die "옛 이름 module-harness 의존이 남아 있다 — 두 패키지가 같은 bin 을 낸다. README 의 이름 변경 절을 먼저 따르라"
  fi
  if CUR_SPEC=$(json_get "$PKG" devDependencies almandu-harness 2>/dev/null); then
    CUR_FIELD=devDependencies
  elif CUR_SPEC=$(json_get "$PKG" dependencies almandu-harness 2>/dev/null); then
    CUR_FIELD=dependencies
  else
    CUR_SPEC=
  fi
fi

INSTALLED_VER=
INST_PKG="$ROOT/node_modules/almandu-harness/package.json"
if [ -f "$INST_PKG" ]; then INSTALLED_VER=$(json_get "$INST_PKG" version 2>/dev/null || true); fi

# 다른 패키지 매니저 — 위임하지 않는다. npm 의 루트·락·allow-git 보장이 그대로 넘어가지 않는다
PM_LOCK=
for _f in pnpm-lock.yaml yarn.lock .pnp.cjs bun.lockb bun.lock; do
  if [ -e "$ROOT/$_f" ]; then PM_LOCK=$_f; break; fi
done
if [ -n "$PM_LOCK" ]; then
  case "$PM_LOCK" in
    pnpm-lock.yaml) _eq="pnpm add -D almandu-harness@$SPEC" ;;
    yarn.lock|.pnp.cjs) _eq="yarn add -D almandu-harness@$SPEC" ;;
    *) _eq="bun add -d almandu-harness@$SPEC" ;;
  esac
  die "$PM_LOCK 이 있다 — 이 스크립트는 npm 만 다룬다. 직접: $_eq (그 뒤 node node_modules/almandu-harness/module-harness-init.mjs)"
fi

if [ -n "$SUBDIR" ] && [ "$PKG_STATE" = none ] && [ "$YES" != 1 ]; then
  die "$ROOT 에 package.json 을 새로 만들어야 한다 (훅·게이트·R14 가 전부 최상위 기준이다). 뜻이 맞으면 --yes 로 다시 돌려라"
fi

# .npmrc 의 allow-git
NPMRC="$ROOT/.npmrc"
# 심링크면 손대지 않는다 — append 도 제자리 rewrite 도 링크를 따라가므로, 여기서 막지 않으면
# 대상이 ~/.npmrc 나 dotfiles 리포일 때 이 스크립트가 리포 밖을 고친다. 무엇을 고칠지는
# 사용자가 그 파일을 직접 보고 정할 일이다
[ ! -L "$NPMRC" ] || die ".npmrc 가 심링크다 — 리포 밖을 고치지 않는다. 대상 파일에 allow-git=root 를 직접 넣어라: $NPMRC"
NPMRC_ALLOW=
if [ -f "$NPMRC" ]; then
  NPMRC_ALLOW=$(awk -F= '/^[[:space:]]*allow-git[[:space:]]*=/ { v=$2; gsub(/[[:space:]]/, "", v) } END { print v }' "$NPMRC")
fi
case "$NPMRC_ALLOW" in
  root|all|'') ;;
  *) [ "$YES" = 1 ] || die ".npmrc 의 allow-git=$NPMRC_ALLOW 가 git 의존 설치를 막는다. 바꾸려면 --yes 로 다시 돌려라" ;;
esac

# 태그가 실재하는가 (첫 쓰기 전에 네트워크를 한 번 본다)
# --dry-run 도 본다 — 쓰기 전에 죽는 실패를 예언하지 못하면 예행연습이 설 자리가 없다
if [ -n "$REF" ]; then
  git ls-remote --tags --exit-code "$REPO_URL" "refs/tags/$REF" >/dev/null 2>&1 \
    || die "$REF 태그를 찾지 못했다 (없는 태그이거나 네트워크가 없다): $REPO_URL"
fi

# 부모 walk — npm 이 루트를 그쪽으로 잡는 바로 그 자리다
PARENT=
PARENT_WS=
PARENT_CKSUM=
PARENT_HARNESS_VER=
_d=$(dirname "$ROOT")
while [ -n "$_d" ] && [ "$_d" != "/" ]; do
  if [ -f "$_d/package.json" ] || [ -d "$_d/node_modules" ]; then PARENT=$_d; break; fi
  _nd=$(dirname "$_d")
  [ "$_nd" != "$_d" ] || break
  _d=$_nd
done
if [ -n "$PARENT" ]; then
  if [ -f "$PARENT/package.json" ]; then
    PARENT_CKSUM=$(cksum < "$PARENT/package.json")
    if json_get "$PARENT/package.json" workspaces >/dev/null 2>&1; then PARENT_WS=1; fi
  fi
  if [ -f "$PARENT/node_modules/almandu-harness/package.json" ]; then
    PARENT_HARNESS_VER=$(json_get "$PARENT/node_modules/almandu-harness/package.json" version 2>/dev/null || true)
  fi
  warn "부모 $PARENT 에 package.json·node_modules 가 있다 — npm 이 그쪽을 루트로 잡는다. --prefix 로 끊는다${PARENT_WS:+ (workspaces 도 있다)}"
fi

# 커밋되지 않은 채 남아 있는 파일 — 경고만 한다
_dirty=$(git -C "$ROOT" status --porcelain -- package.json .npmrc .gitignore CLAUDE.md)
[ -z "$_dirty" ] || warn "package.json·.npmrc·.gitignore·CLAUDE.md 에 커밋되지 않은 변경이 있다 — 이 스크립트의 변경과 섞인다"

# 훅 상태
L_HP=$(git -C "$ROOT" config --local --get core.hooksPath 2>/dev/null || true)
E_HP_RAW=$(git -C "$ROOT" config --type=path --get core.hooksPath 2>/dev/null || true)
E_HP=
if [ -n "$E_HP_RAW" ]; then
  case "$E_HP_RAW" in
    /*) E_HP=$E_HP_RAW ;;
    *)  E_HP="$ROOT/$E_HP_RAW" ;;
  esac
fi

_gcd=$(git -C "$ROOT" rev-parse --git-common-dir)
case "$_gcd" in
  /*) ;;
  *) _gcd="$ROOT/$_gcd" ;;
esac
DEF_HOOK_DIR="$(cd "$_gcd" && pwd -P)/hooks"

# 기본 훅 디렉토리에서 **실제로 돌고 있는** 훅. hooksPath 가 하나라도 있으면 git 이 이 디렉토리를 통째로 무시하므로
# 그때는 세어도 의미가 없다 — 그래도 읽어 두고, 쓰는 것은 정책 표뿐이다
DEFAULT_HOOKS=
if [ -d "$DEF_HOOK_DIR" ]; then
  for _f in "$DEF_HOOK_DIR"/*; do
    [ -f "$_f" ] || continue
    _b=${_f##*/}
    case "$_b" in *.sample) continue ;; esac
    if [ -z "$WIN" ] && [ ! -x "$_f" ]; then continue; fi
    DEFAULT_HOOKS="$DEFAULT_HOOKS $_b"
  done
fi
DEFAULT_HOOKS=${DEFAULT_HOOKS# }

# 전역 훅이 리포 안의 훅을 체인하는가 — 텍스트 휴리스틱이다. 전역 훅을 돌려 보지는 않는다
CHAIN_CANDIDATE=
GLOBAL_CHAINS=
if [ -z "$L_HP" ] && [ -n "$E_HP" ]; then
  if [ -f "$ROOT/.husky/pre-commit" ]; then CHAIN_CANDIDATE="$ROOT/.husky/pre-commit"
  else CHAIN_CANDIDATE="$DEF_HOOK_DIR/pre-commit"; fi
  if [ -r "$E_HP/pre-commit" ]; then
    case "$CHAIN_CANDIDATE" in
      */.husky/pre-commit) _pat='.husky/pre-commit' ;;
      *) _pat='.git/hooks/pre-commit' ;;
    esac
    _gtext=$(cat "$E_HP/pre-commit")
    case "$_gtext" in *"$_pat"*) GLOBAL_CHAINS=1 ;; esac
  fi
fi

HAS_HEAD=
if git -C "$ROOT" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then HAS_HEAD=1; fi
[ -n "$HAS_HEAD" ] || warn "커밋이 하나도 없다 — 먼저 첫 커밋을 만들어라. 그 전에는 /module-work 의 1단계(loop scope)가 HEAD 를 찾지 못해 죽는다"

# ---------- 훅 정책 (§5 phase 6 표). 첫 쓰기 전에 전부 정해 둔다 ----------
DIR=${HP:-.githooks}
HOOK_STATE=fresh
if [ -n "$L_HP" ]; then
  case "$L_HP" in
    /*|[A-Za-z]:*|..|../*|*/../*|*/..) HOOK_STATE=local-outside ;;
    *) if [ "$L_HP" = "$DIR" ]; then HOOK_STATE=local-same; else HOOK_STATE=local-other; fi ;;
  esac
elif [ -n "$E_HP" ]; then
  HOOK_STATE=inherited
elif [ -n "$DEFAULT_HOOKS" ]; then
  HOOK_STATE=default-hooks
fi

HOOK_DIR=$DIR
SET_CONFIG=1
case "$HOOK_STATE" in
  fresh|local-same)
    ;;
  local-other)
    HOOK_DIR=$L_HP
    case "$HOOK_DIR" in */_) HOOK_DIR=${HOOK_DIR%/_} ;; esac   # husky v9 의 .husky/_ 는 사용자 훅이 .husky 에 있다
    if [ "$OVERRIDE" = 1 ]; then HOOK_DIR=$DIR; else SET_CONFIG=0; fi
    ;;
  local-outside|inherited|default-hooks)
    if [ "$OVERRIDE" != 1 ]; then SET_CONFIG=0; fi
    ;;
esac
[ "$NO_CONFIG" != 1 ] || SET_CONFIG=0

case "$HOOK_STATE" in
  inherited)
    warn "전역 core.hooksPath=$E_HP — 로컬 $DIR 을 켜면 이 리포에서 전역 훅이 돌지 않는다"
    if [ -n "$GLOBAL_CHAINS" ]; then ok "전역 훅이 $CHAIN_CANDIDATE 을 체인한다 (감지, 검증 아님)"; fi
    if [ "$OVERRIDE" = 1 ]; then
      warn "--override-hooks: 이 리포에서 전역 훅($E_HP)이 돌지 않게 된다. 유지하려면 $DIR/pre-commit 이 $E_HP 의 훅을 직접 부르게 하라 (리포 안의 수정이다 — 전역 훅은 건드리지 않는다)"
    fi ;;
  default-hooks)
    warn ".git/hooks 에서 돌고 있는 훅이 있다: $DEFAULT_HOOKS"
    if [ "$OVERRIDE" = 1 ]; then warn "--override-hooks: 이 리포에서 그 훅들($DEFAULT_HOOKS)이 돌지 않게 된다"; fi ;;
  local-other)
    if [ "$OVERRIDE" = 1 ]; then warn "--override-hooks: 이전 core.hooksPath=$L_HP 를 $DIR 로 바꾼다"
    else ok "이미 있는 core.hooksPath=$L_HP 를 그대로 쓴다 (init 은 $HOOK_DIR 에 쓴다)"; fi ;;
  local-outside)
    warn "core.hooksPath=$L_HP 가 리포 밖이거나 절대 경로다 — init 은 그 값을 그대로 쓸 수 없다" ;;
  *) ;;
esac

# ---------- 훅 연결 판정 (phase 1 에서는 예측, phase 7 에서는 실측) ----------
WIRED=0
WIRE_NOTE=
check_wired() {
  WIRED=0
  WIRE_NOTE=
  case "$HOOK_STATE" in
    inherited)
      if [ "$SET_CONFIG" = 1 ]; then
        if gate_hook "$ROOT/$HOOK_DIR/pre-commit"; then WIRED=1; fi
      elif gate_hook "$E_HP/pre-commit"; then
        WIRED=1; WIRE_NOTE="게이트: 전역 훅에서 (감지, 검증 아님)"
      elif [ -n "$GLOBAL_CHAINS" ] && gate_hook "$CHAIN_CANDIDATE"; then
        WIRED=1; WIRE_NOTE="게이트: 전역 훅이 체인하는 $CHAIN_CANDIDATE 에서 (감지, 검증 아님)"
      fi ;;
    default-hooks)
      if [ "$SET_CONFIG" = 1 ]; then
        if gate_hook "$ROOT/$HOOK_DIR/pre-commit"; then WIRED=1; fi
      elif gate_hook "$DEF_HOOK_DIR/pre-commit"; then WIRED=1; fi ;;
    local-outside)
      if [ "$SET_CONFIG" = 1 ] && gate_hook "$ROOT/$HOOK_DIR/pre-commit"; then WIRED=1; fi ;;
    *)
      if gate_hook "$ROOT/$HOOK_DIR/pre-commit"; then WIRED=1; fi ;;
  esac
}

# 예측은 "init 이 그 자리에 훅을 만들 것인가" 를 한 칸 더 본다
predict_wired() {
  check_wired
  [ "$WIRED" = 0 ] || return 0
  case "$HOOK_STATE" in
    fresh|local-same|local-other) ;;
    *) [ "$SET_CONFIG" = 1 ] || return 0 ;;
  esac
  [ -e "$ROOT/$HOOK_DIR/pre-commit" ] || WIRED=1
}
predict_wired
EXPECT_WIRED=$WIRED

# ---------- Phase 2 — 최상위에 쓰기 ----------
write_pkg() {
  node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({ name: process.argv[2], private: true }, null, 2) + "\n");
' "$PKG" "$NEW_PKG_NAME"
}
if [ "$PKG_STATE" = none ]; then
  _base=$(printf '%s' "${ROOT##*/}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9._-' '-')
  while :; do
    case "$_base" in [._-]*) _base=${_base#?} ;; *) break ;; esac
  done
  [ -n "$_base" ] || _base=repo
  NEW_PKG_NAME="$_base-harness"
  act "package.json ($NEW_PKG_NAME, private)" write_pkg
else
  ok "package.json — 이미 있다 (건드리지 않는다)"
fi

append_line() {   # $1 = 파일, $2 = 줄
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then printf '\n' >> "$1"; fi
  printf '%s\n' "$2" >> "$1"
}
rewrite_npmrc() {
  _tmp="$ROOT/.npmrc.almandu.$$"
  # .npmrc 의 모든 줄이 지나가는 파일이라 토큰이 실린다. 리다이렉트는 umask(보통 0644)로
  # 만들므로 내용을 넣기 전에 조인다
  : > "$_tmp"
  chmod 600 "$_tmp"
  awk '!/^[[:space:]]*allow-git[[:space:]]*=/ { print } END { print "allow-git=root" }' "$NPMRC" > "$_tmp"
  # mv 가 아니라 제자리 쓰기다 — mv 는 이름 바꾸기라 원본의 모드를 임시 파일 것으로 갈아치운다
  # (토큰이 든 0600 .npmrc 가 0644 가 된다). 대가는 원자성이고, 비운 뒤 실패하면 내용이
  # 사라지므로 실패를 직접 잡는다. 심링크는 여기 오기 전 프리플라이트에서 이미 거부됐다
  if ! cat "$_tmp" > "$NPMRC"; then
    trap - EXIT
    die ".npmrc 를 쓰지 못했다 — 새 내용은 $_tmp 에 남겼다. 커밋하지 말고 옮긴 뒤 지워라"
  fi
  rm -f "$_tmp"
}
case "$NPMRC_ALLOW" in
  root) ok ".npmrc — allow-git=root 이미 있다" ;;
  all)  ok ".npmrc — allow-git=all 이 root 를 이미 포함한다" ;;
  '')   act ".npmrc — allow-git=root" append_line "$NPMRC" "allow-git=root" ;;
  *)    act ".npmrc — allow-git=$NPMRC_ALLOW → root" rewrite_npmrc ;;
esac

# 전역 excludes 로만 무시되는 것은 다른 머신에 없다 — 리포 안의 파일이 무시할 때만 건너뛴다
GI_SRC=
if GI_OUT=$(git -C "$ROOT" check-ignore -v --no-index node_modules/almandu-harness 2>/dev/null); then
  GI_SRC=${GI_OUT%%:*}
fi
case "$GI_SRC" in
  ''|/*|.git/*) act ".gitignore — node_modules/" append_line "$ROOT/.gitignore" "node_modules/" ;;
  *) ok ".gitignore — node_modules 가 이미 $GI_SRC 로 무시된다" ;;
esac

# ---------- Phase 3 — npm 이 대상의 설정을 읽는지 증명한다 ----------
if [ "$DRY" != 1 ] && [ "$NPM_MAJOR" -ge 12 ]; then
  _got=$(npm --prefix "$ROOT" config get allow-git 2>/dev/null || true)
  case "$_got" in
    root|all) ok "npm 이 대상의 .npmrc 를 읽는다 (allow-git=$_got)" ;;
    *) die "npm 이 대상의 .npmrc 를 읽지 않는다 (allow-git=$_got) — npm_config_allow_git 환경변수나 사용자/전역 설정이 프로젝트 .npmrc 를 덮고 있다" ;;
  esac
elif [ "$NPM_MAJOR" -lt 12 ]; then
  ok "allow-git 은 npm $NPM_MAJOR 에서 확인할 수 없다 (거기서는 git 의존이 그냥 허용된다). npm 12 머신을 위해 .npmrc 는 맞춰 둔다"
fi

# ---------- Phase 4 — 설치 ----------
SAVE_FLAG=--save-dev
[ "$CUR_FIELD" != dependencies ] || SAVE_FLAG=--save-prod
NEW_SPEC="almandu-harness@$SPEC"
SKIP_INSTALL=0
if [ -n "$REF" ] && [ "$CUR_SPEC" = "$GH_BASE#$REF" ] && [ "$INSTALLED_VER" = "${REF#v}" ]; then
  SKIP_INSTALL=1
fi

npm_install() {
  npm --prefix "$ROOT" install "$SAVE_FLAG" --workspaces=false --no-audit --no-fund "$NEW_SPEC" \
    || die "npm install 이 실패했다 (위의 npm 메시지를 보라)"
}
if [ "$SKIP_INSTALL" = 1 ]; then
  ok "이미 설치돼 있다 (v$INSTALLED_VER)"
else
  if [ -n "$CUR_SPEC" ] && [ "$CUR_SPEC" != "$SPEC" ]; then say "+ 의존 변경: $CUR_SPEC → $SPEC"; fi
  if [ -n "$REF" ] && [ -n "$INSTALLED_VER" ] && ver_gt "$INSTALLED_VER" "${REF#v}"; then
    warn "다운그레이드다: 설치된 v$INSTALLED_VER → $REF"
  fi
  act "npm --prefix $ROOT install $SAVE_FLAG --workspaces=false --no-audit --no-fund $NEW_SPEC" npm_install
fi

# ---------- Phase 5 — 설치 자리 확인 ----------
if [ "$DRY" != 1 ]; then
  [ -f "$INST_PKG" ] || die "$INST_PKG 가 없다 — 설치가 대상 리포 밖으로 갔다"
  _n=$(json_get "$INST_PKG" name 2>/dev/null || true)
  [ "$_n" = almandu-harness ] || die "$INST_PKG 의 이름이 almandu-harness 가 아니다: $_n"
  _v=$(json_get "$INST_PKG" version 2>/dev/null || true)
  if [ -n "$REF" ] && [ "$_v" != "${REF#v}" ]; then die "설치된 판이 $REF 가 아니다 (v$_v)"; fi
  if [ -n "$WIN" ]; then
    [ -e "$ROOT/node_modules/.bin/almandu-module-gate.cmd" ] || [ -e "$ROOT/node_modules/.bin/almandu-module-gate" ] \
      || die "node_modules/.bin 에 almandu-module-gate 가 없다"
  else
    [ -e "$ROOT/node_modules/.bin/almandu-module-gate" ] || die "node_modules/.bin/almandu-module-gate 가 없다"
  fi
  json_get "$PKG" "${CUR_FIELD:-devDependencies}" almandu-harness >/dev/null 2>&1 \
    || json_get "$PKG" dependencies almandu-harness >/dev/null 2>&1 \
    || die "$PKG 에 almandu-harness 의존이 기록되지 않았다"
  if [ -n "$PARENT" ]; then
    if [ -n "$PARENT_CKSUM" ] && [ "$PARENT_CKSUM" != "$(cksum < "$PARENT/package.json")" ]; then
      die "부모 $PARENT/package.json 이 바뀌었다 — npm 이 그쪽을 루트로 잡았다"
    fi
    _pv=
    if [ -f "$PARENT/node_modules/almandu-harness/package.json" ]; then
      _pv=$(json_get "$PARENT/node_modules/almandu-harness/package.json" version 2>/dev/null || true)
    fi
    [ "$_pv" = "$PARENT_HARNESS_VER" ] || die "부모 $PARENT/node_modules 에 almandu-harness 가 설치됐다 (v$_pv)"
  fi
  ok "설치 자리 확인: $ROOT/node_modules/almandu-harness (v$_v)"
fi

# ---------- Phase 6 — init ----------
INIT="$ROOT/node_modules/almandu-harness/module-harness-init.mjs"

# init 의 cwd 는 반드시 ROOT 다 — init 이 거기서 git rev-parse --show-toplevel 로 제 루트를 잡는다
init_run() { (cd "$ROOT" && node "$INIT" "$@"); }
# init 을 부르는 자리는 이 둘뿐이다. 커맨드 플래그를 훅 정책 표의 arm 마다 붙이면 하나가 빠져도 초록으로 지나간다
run_init() {
  _desc="init${*:+ $*}"
  if [ "$NO_COMMANDS" = 1 ]; then act "$_desc --no-commands" init_run "$@" --no-commands
  else                            act "$_desc"                init_run "$@"
  fi
}
# 미리보기는 act 를 거치지 않는다 — dry-run 에서도 진짜로 돌려서 계획을 받아 온다
preview_init() {
  if [ "$NO_COMMANDS" = 1 ]; then (cd "$ROOT" && node "$INIT" "$@" --dry-run --no-commands)
  else                            (cd "$ROOT" && node "$INIT" "$@" --dry-run)
  fi
}
call_init() {   # $1 = run_init | preview_init
  _fn=$1
  if [ "$HOOK_DIR" != ".githooks" ]; then
    if [ "$SET_CONFIG" = 0 ]; then "$_fn" --hooks-path "$HOOK_DIR" --no-config
    else                           "$_fn" --hooks-path "$HOOK_DIR"; fi
  else
    if [ "$SET_CONFIG" = 0 ]; then "$_fn" --no-config
    else                           "$_fn"; fi
  fi
}

if [ "$DRY" = 1 ]; then
  # init 의 dry-run 은 config 계획을 보고하지 않는다 — 스크립트가 제 손으로 낸다
  if [ "$SET_CONFIG" = 1 ] && [ "$L_HP" != "$HOOK_DIR" ]; then say "DRY + git config core.hooksPath $HOOK_DIR"; fi
  call_init run_init
  if [ -f "$INIT" ]; then call_init preview_init 2>&1 | sed 's/^/  /'; fi
else
  call_init run_init
fi

# ---------- Phase 7 — 사후 검사 ----------
if [ "$DRY" != 1 ]; then
  check_wired
  [ -z "$WIRE_NOTE" ] || ok "$WIRE_NOTE"
  if [ "$WIRED" = 1 ] && [ -z "$WIRE_NOTE" ]; then ok "게이트: $HOOK_DIR/pre-commit"; fi

  if ! (cd "$ROOT" && npx --no-install almandu-module-gate --scope . >/dev/null 2>&1); then
    die "npx --no-install almandu-module-gate 가 풀리지 않는다 — 훅도 같은 방식으로 실패한다"
  fi
  ok "게이트 실행 확인: npx --no-install almandu-module-gate --scope ."

  case "$(command -v node)" in
    */.nvm/*) warn "node 가 nvm 아래에 있다 — GUI git 클라이언트는 그 PATH 를 못 볼 수 있다. 훅이 node 를 절대 경로로 부르게 두는 편이 안전하다" ;;
  esac
else
  WIRED=$EXPECT_WIRED
fi

# ---------- Phase 8 — 리포트 ----------
say ""
say "커밋할 파일"
_status=$(git -C "$ROOT" status --short)
if [ -n "$_status" ]; then printf '%s\n' "$_status" | sed 's/^/  /'; else say "  (없음)"; fi

say ""
say "다음"
if [ -f "$ROOT/.claude/commands/module-work.md" ] || { [ "$DRY" = 1 ] && [ "$NO_COMMANDS" != 1 ]; }; then
  if [ -z "$HAS_HEAD" ]; then
    say '  0. git add -A && git commit -m "chore: 하네스 설치"'
    say "     ← 커밋이 하나도 없을 때만 나온다. 그 전에는 3 번의 1단계(loop scope)가 HEAD 를 못 찾아 죽는다"
  fi
  say "  1. /module-draft <디렉토리>   계약서 초안을 하나 세운다 (MODULE.md 가 없으면 게이트가 셀 것이 없다)"
  # 백틱은 명령 치환이 아니라 안내문의 마크다운 표기다 — 확장되지 않는 것이 의도다
  # shellcheck disable=SC2016
  say '  2. 그 MODULE.md 의 in 에 `[[harness]] … (외부: almandu-harness)` 를 적는다 (R14)'
  say '  3. /module-work "<이번에 할 일>"   계약 → 수정 → 게이트 → 리뷰 → 커밋'
else
  if [ -z "$HAS_HEAD" ]; then say '  0. git add -A && git commit -m "chore: 하네스 설치"'; fi
  say "  1. 모듈마다 MODULE.md 를 쓴다 (node_modules/almandu-harness/MODULE-schema-v1.md 가 규칙서다)"
  # 백틱은 명령 치환이 아니라 안내문의 마크다운 표기다 — 확장되지 않는 것이 의도다
  # shellcheck disable=SC2016
  say '  2. 그 MODULE.md 의 in 에 `[[harness]] … (외부: almandu-harness)` 를 적는다 (R14)'
  say "  3. 리뷰 커맨드가 필요하면 node_modules/almandu-harness/commands/*.md 를 .claude/commands/ 로 복사한다"
fi

if [ "$WIRED" != 1 ]; then
  say ""
  say "게이트가 연결되지 않았다"
  _line='npx --no-install almandu-module-gate --staged || exit $?'
  case "$HOOK_STATE" in
    inherited)
      if [ -n "$GLOBAL_CHAINS" ]; then
        say "  (a) $CHAIN_CANDIDATE 에 이 줄을 덧붙인다 (없으면 #!/bin/sh 로 만들고 chmod +x):"
        say "      $_line"
        say "      훅 매니저(pre-commit·husky v4·lefthook)가 그 파일을 만들었다면 매니저 설정에 넣어라 — 다시 생성될 때 사라진다"
      fi
      say "  (b) --override-hooks 로 다시 돌린다 (이 리포에서 전역 훅이 돌지 않게 된다)"
      say "  전역 훅은 고치지 않는다 — 그 훅은 이 머신의 모든 리포에서 돌고, almandu-harness 가 없는 리포에서 이 줄은 exit 1 이다" ;;
    default-hooks)
      say "  .git/hooks 에서 돌고 있는 훅: $DEFAULT_HOOKS"
      say "  (a) $DEF_HOOK_DIR/pre-commit 에 이 줄을 덧붙인다 (없으면 #!/bin/sh 로 만들고 chmod +x):"
      say "      $_line"
      say "      훅 매니저(pre-commit·husky v4·lefthook)가 그 파일을 만들었다면 매니저 설정에 넣어라 — 다시 생성될 때 사라진다"
      say "  (b) --override-hooks 로 다시 돌린다 ($DEFAULT_HOOKS 가 이 리포에서 돌지 않게 된다)" ;;
    local-outside)
      say "  core.hooksPath=$L_HP 가 리포 밖이다. --override-hooks 로 $DIR 을 쓰거나, 그 디렉토리의 pre-commit 에 직접 덧붙인다:"
      say "      $_line" ;;
    *)
      say "  $HOOK_DIR/pre-commit 이 게이트를 부르지 않는다 (init 은 이미 있는 훅을 덮지 않는다). 이 줄을 덧붙인다:"
      say "      $_line" ;;
  esac
fi

if [ "$DRY" = 1 ]; then
  say ""
  if [ "$EXPECT_WIRED" = 1 ]; then
    say "--dry-run: 아무것도 쓰지 않았다. 실제 실행의 종료 코드는 0 으로 예상된다"
    exit 0
  fi
  say "--dry-run: 아무것도 쓰지 않았다. 실제 실행의 종료 코드는 3 으로 예상된다"
  exit 3
fi

[ "$WIRED" = 1 ] || exit 3
exit 0
