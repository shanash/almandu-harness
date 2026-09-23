#!/usr/bin/env node
// module-harness-init.mjs — 소비 리포에 하네스(almandu-harness)를 설치한다 (DESIGN.md 7절)
// 사용: npx --no-install almandu-harness-init [--dry-run] [--hooks-path <디렉토리>] [--no-config] [--override-hooks] [--no-commands]  (옛 이름은 별칭)
//
// 손으로 하던 다섯을 대신한다: pre-commit 훅 작성과 남의 훅에 게이트 배선, 루트 CLAUDE.md 에 계약 문단 추가,
// MODULE.md 가 있는데 CLAUDE.md 가 없는 디렉토리에 어댑터 생성, .claude/commands/ 에 커맨드 셋 복사.
// 게이트 바이너리에 넣지 않은 이유는 판정 도구가 파일을 쓰게 되면 harness I5 가 흐려지기 때문이다.
// 이쪽은 처음부터 쓰는 도구이므로 판정을 하지 않는다 — 종료 코드는 쓰기 성공 여부뿐이다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noConfig = args.includes('--no-config');
const hpIdx = args.indexOf('--hooks-path');
const hooksPath = hpIdx < 0 ? '.githooks' : args[hpIdx + 1];
if (!hooksPath || hooksPath.startsWith('--')) { console.error('init: --hooks-path 에 디렉토리가 필요하다'); process.exit(2); }

const SKIP_DIRS = new Set(['.git', 'node_modules', 'Library', 'Temp', 'obj', 'Logs', 'builds']);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const toPosix = (p) => p.split('\\').join('/');

// 어댑터 문구의 출처는 스키마 하나다. 여기에 다시 적으면 두 판본이 생기고, 그 순간
// "로드되는 자리마다 같은 문장이 와야 한다" 는 약속을 아무도 검증할 수 없다
function adapterText() {
  const schema = join(HERE, 'MODULE-schema-v1.md');
  const block = readFileSync(schema, 'utf8')
    .split('### CLAUDE.md 어댑터')[1]?.match(/```markdown\n([\s\S]*?)```/);
  if (!block) { console.error(`init: ${schema} 에서 어댑터 문구를 찾지 못했다`); process.exit(2); }
  return block[1];
}

// GATE 사본은 여기 하나다 — HOOK 과 CHAIN 이 함께 쓴다 (install test 20 이 유일성을 고정한다)
const GATE = 'node "$(git rev-parse --show-toplevel)/node_modules/almandu-harness/module-gate.mjs"';
const HOOK = `#!/bin/sh\n# almandu-harness — 계약 게이트. 인덱스만 본다 (작업 트리 모드와 판정이 다르다). npx 를 쓰지 않는다: 워크스페이스 멤버에서 npm 이 멤버의 .bin 을 보지 않는다\nexec ${GATE} --staged\n`;
const CHAIN = `\n# almandu-harness — 계약 게이트 (설치 도구가 얹었다. 지우면 이 리포에서 계약 판정이 사라진다)\n${GATE} --staged || exit $?\n`;

// 루트 CLAUDE.md 가 계약 체계를 한 번은 말해야 한다. 어댑터는 재귀하지 않으므로
// 깊은 파일을 열기 전에 무엇을 읽어야 하는지는 이 문단만이 말해 준다
const ROOT_PARAGRAPH = `
## 계약

파일을 고치기 전에 그 파일을 소유한 **가장 깊은 MODULE.md** 를 읽는다.
어느 것인지 모르면 \`node "$(git rev-parse --show-toplevel)/node_modules/almandu-harness/module-gate.mjs" --scope <경로>\` 가 답한다.
불변식을 깨는 변경은 먼저 MODULE.md 를 고치고 이력을 남긴다.
`;

const done = [];
const skipped = [];
function put(rel, text, { mode } = {}) {
  const full = join(root, rel);
  if (existsSync(full) && readFileSync(full, 'utf8') === text) { skipped.push(`${rel} — 이미 같다`); return; }
  if (existsSync(full)) { skipped.push(`${rel} — 이미 있다 (덮어쓰지 않는다)`); return; }
  if (!dryRun) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    if (mode) chmodSync(full, mode);
  }
  done.push(rel);
}

// ---------- 1. pre-commit 훅 ----------
put(join(hooksPath, 'pre-commit'), HOOK, { mode: 0o755 });
if (!noConfig && mayConfig()) {
  const cur = (() => {
    // --local 만 본다. 전역 설정이 우연히 같은 값이어도 이 리포에는 기록이 남아야 한다
    try { return execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { return ''; }
  })();
  if (cur !== hooksPath) {
    if (!dryRun) execFileSync('git', ['config', 'core.hooksPath', hooksPath], { cwd: root });
    done.push(`git config core.hooksPath ${hooksPath}${cur ? ` (이전: ${cur})` : ''}`);
  }
}

// ---------- 2. 루트 CLAUDE.md 의 계약 문단 ----------
const rootAdapter = join(root, 'CLAUDE.md');
if (!existsSync(rootAdapter)) put('CLAUDE.md', ROOT_PARAGRAPH.trimStart());
else if (readFileSync(rootAdapter, 'utf8').includes('가장 깊은 MODULE.md')) skipped.push('CLAUDE.md — 계약 문단이 이미 있다');
else if (!dryRun) { writeFileSync(rootAdapter, readFileSync(rootAdapter, 'utf8').replace(/\n*$/, '\n') + ROOT_PARAGRAPH); done.push('CLAUDE.md — 계약 문단 추가'); }
else done.push('CLAUDE.md — 계약 문단 추가');

// ---------- 3. 모듈마다 어댑터 ----------
function findModules(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findModules(full, out);
    else if (name === 'MODULE.md') out.push(toPosix(relative(root, dirname(full))));
  }
  return out;
}
const adapter = adapterText();
for (const dir of findModules(root)) {
  const rel = dir ? `${dir}/CLAUDE.md` : 'CLAUDE.md';
  const full = join(root, rel);
  if (!existsSync(full)) { put(rel, adapter); continue; }
  const text = readFileSync(full, 'utf8');
  if (text.includes('@MODULE.md')) { skipped.push(`${rel} — @MODULE.md 가 이미 있다`); continue; }
  // 있는 CLAUDE.md 는 지우지 않는다. 어댑터를 맨 앞에 얹는다 — @import 는 위에 있어야 읽힌다
  if (!dryRun) writeFileSync(full, `${adapter}\n${text}`);
  done.push(`${rel} — 어댑터를 앞에 얹음`);
}

// ---------- 4. 소비 리포의 커맨드 ----------
// 문구의 출처는 패키지의 commands/ 하나다 (I7). 파일 이름 목록을 여기 두지 않는다 —
// 디렉토리를 읽으므로 커맨드가 넷째로 늘어도 이 파일은 그대로다.
// 플래그를 여기서 읽는 이유: 위쪽 상수 줄을 밀면 계약서의 인용 넷이 거짓이 된다 (R11(b))
if (!args.includes('--no-commands')) {
  const cmdDir = join(HERE, 'commands');
  // 0.8.0 이전 태그로 설치한 리포에는 이 디렉토리가 없다. 설치가 실패한 것은 아니므로 죽지 않는다
  if (!existsSync(cmdDir)) skipped.push('.claude/commands — 패키지에 commands/ 가 없다 (0.8.0 미만)');
  else for (const name of readdirSync(cmdDir)) {
    if (!name.endsWith('.md')) continue;
    put(`.claude/commands/${name}`, readFileSync(join(cmdDir, name), 'utf8'));
  }
}

wire();

// ---------- 결과 ----------
for (const d of done) console.log(`${dryRun ? 'DRY ' : ''}+ ${d}`);
for (const s of skipped) console.log(`  · ${s}`);
if (!done.length) console.log('바꿀 것이 없다 — 이미 설치돼 있다');
else if (dryRun) console.log('\n--dry-run: 아무것도 쓰지 않았다');
else console.log('\n다음: 모듈마다 MODULE.md 를 쓰고 `node "$(git rev-parse --show-toplevel)/node_modules/almandu-harness/module-gate.mjs"` 로 확인한다 (MODULE-schema-v1.md 가 규칙서다)');

// ---------- 5. 훅 배선 ----------
// git 이 pre-commit 으로 실제로 실행할 파일이 무엇인지는 git 의 규칙이라 추측이 아니다 (design 3-A).
// mayConfig() 는 그 자리를 가리지 않을 때만 core.hooksPath 를 켠다. wire() 는 켤 수 없을 때
// 그 실제 실행 파일에 게이트 호출을 얹는다 — 작업 트리 안·비추적일 때만.
// args 는 이미 초기화돼 있다 (:15) — 여기서 상수로 다시 두면 :67 의 TDZ 를 깨므로 함수 안에서 읽는다
function overrideHooks() { return args.includes('--override-hooks'); }

function gitConfigLocal(key) {
  try { return execFileSync('git', ['config', '--local', '--get', key], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
function gitConfigPath(key) {
  try { return execFileSync('git', ['config', '--type=path', '--get', key], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
function resolvedGitPath(kind) {
  const raw = execFileSync('git', ['rev-parse', kind], { cwd: root, encoding: 'utf8' }).trim();
  return raw.startsWith('/') || /^[A-Za-z]:/.test(raw) ? raw : join(root, raw);
}
function gitCommonDir() { return resolvedGitPath('--git-common-dir'); }
function isLinkedWorktree() { return resolvedGitPath('--git-dir') !== gitCommonDir(); }

function looksOutside(p) {
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return true;
  if (p === '..' || p.startsWith('../') || p.includes('/../') || p.endsWith('/..')) return true;
  return false;
}
// husky v9 의 core.hooksPath 는 .husky/_ 다 — git 이 실제로 돌리는 것은 그 디스패처지만
// 배선할 자리는 그것이 부르는 사용자 훅 .husky/pre-commit 이다
function normalizeHooksDir(dir) { return dir.endsWith('/_') ? dir.slice(0, -2) : dir; }

function isExecutable(full) {
  try { return (statSync(full).mode & 0o111) !== 0; } catch { return false; }
}
function hasGateCall(text) { return text.includes('module-gate'); }
function shebangIsShLike(text) {
  const first = text.split('\n', 1)[0];
  return /^#!\s*\S*\/(env\s+)?(sh|bash)(\s|$)/.test(first);
}
function isTracked(relPath) {
  try { execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], { cwd: root, stdio: 'ignore' }); return true; }
  catch { return false; }
}
// 파일이 아직 없어도 그 디렉토리에 추적 파일이 있으면 추적되는 자리다 — 거기 만든 훅은 다음 커밋에 실린다 (design 5-B 1-a)
function isTrackedPlace(full) {
  if (!relative(gitCommonDir(), full).startsWith('..')) return false;   // git 디렉토리 안은 추적되지 않는다
  const rel = toPosix(relative(root, full));
  if (isTracked(rel)) return true;
  const dir = toPosix(relative(root, dirname(full)));
  if (!dir) return false;   // 작업 트리 루트에 직접 놓이는 경우는 없다 — hooksPath 가 '.' 인 리포를 추적 자리로 보지 않는다
  return execFileSync('git', ['ls-files', '--', dir], { cwd: root, encoding: 'utf8' }).trim() !== '';
}

// 전역 훅이 리포 안을 체인하는가 — 텍스트 휴리스틱이다 (스크립트의 GLOBAL_CHAINS 와 같은 성질)
function detectChain(globalHooksDir) {
  const huskyPath = join(root, '.husky', 'pre-commit');
  const candidate = existsSync(huskyPath) ? huskyPath : join(gitCommonDir(), 'hooks', 'pre-commit');
  let text;
  try { text = readFileSync(join(globalHooksDir, 'pre-commit'), 'utf8'); } catch { return null; }
  const pat = candidate === huskyPath ? '.husky/pre-commit' : '.git/hooks/pre-commit';
  return text.includes(pat) ? candidate : null;
}

function hookState() {
  const L = gitConfigLocal('core.hooksPath');
  if (L) {
    if (looksOutside(L)) return { kind: 'local-outside', L };
    const dir = normalizeHooksDir(L);
    return dir === hooksPath ? { kind: 'local-same' } : { kind: 'local-other', dir };
  }
  const E = gitConfigPath('core.hooksPath');
  if (E) return { kind: 'inherited', E, chain: detectChain(E) };
  const hooksDir = join(gitCommonDir(), 'hooks');
  let hasDefault = false;
  if (existsSync(hooksDir)) {
    for (const name of readdirSync(hooksDir)) {
      if (name.endsWith('.sample')) continue;
      const full = join(hooksDir, name);
      try { if (statSync(full).isFile() && isExecutable(full)) { hasDefault = true; break; } } catch { /* 무시 */ }
    }
  }
  return hasDefault ? { kind: 'default-hooks' } : { kind: 'fresh' };
}

// 설정을 켜도 아무것도 가리지 않을 때만 참이다 — fresh·local-same, 또는 --override-hooks
function mayConfig() {
  if (overrideHooks()) return true;
  const st = hookState();
  return st.kind === 'fresh' || st.kind === 'local-same';
}

function insertChain(full, text) {
  const nl = text.indexOf('\n');
  const shebangLine = nl === -1 ? text : text.slice(0, nl + 1);
  const rest = nl === -1 ? '' : text.slice(nl + 1);
  if (!dryRun) writeFileSync(full, shebangLine + CHAIN + rest);
  done.push(`${toPosix(relative(root, full))} — 게이트 호출을 덧붙임`);
}

function wire() {
  if (isLinkedWorktree()) {
    skipped.push('배선 — 연결된 워크트리다: 배선 자리가 메인 리포의 것이라 건드리지 않는다');
    return;
  }

  // 설정을 켰다면(dry-run 에서는 켤 것이라면) git 이 도는 자리는 put() 이 관리하는 hooksPath 다 (design 5-B 2)
  if (!noConfig && mayConfig()) return;
  const st = hookState();
  if (st.kind === 'local-same') return;

  let target;
  if (st.kind === 'local-outside') {
    skipped.push(`배선 — core.hooksPath=${st.L} 가 리포 밖이거나 절대 경로다`);
    return;
  }
  if (st.kind === 'local-other') {
    target = join(root, st.dir, 'pre-commit');
  } else if (st.kind === 'inherited') {
    if (!st.chain) { skipped.push(`배선 — 전역 core.hooksPath=${st.E} 가 리포 안을 체인하지 않는다`); return; }
    target = st.chain;
  } else {
    // fresh · default-hooks — 설정이 꺼져 있으면 git 이 실제로 도는 자리는 git-common-dir/hooks 다
    target = join(gitCommonDir(), 'hooks', 'pre-commit');
  }

  const relTarget = toPosix(relative(root, target));
  if (isTrackedPlace(target)) { skipped.push(`배선 — ${relTarget} 은 추적되는 자리다 (건드리지 않는다)`); return; }
  if (!existsSync(target)) { put(relTarget, HOOK, { mode: 0o755 }); return; }
  if (!isExecutable(target)) { skipped.push(`배선 — ${relTarget} 에 실행 권한이 없다`); return; }
  const text = readFileSync(target, 'utf8');
  if (hasGateCall(text)) { skipped.push(`배선 — ${relTarget} 이 이미 게이트를 부른다`); return; }
  if (!shebangIsShLike(text)) { skipped.push(`배선 — ${relTarget} 의 shebang 을 모른다`); return; }
  insertChain(target, text);
}
