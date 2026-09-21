#!/usr/bin/env node
// module-harness-init.mjs — 소비 리포에 하네스(almandu-harness)를 설치한다 (DESIGN.md 7절)
// 사용: npx --no-install almandu-harness-init [--dry-run] [--hooks-path <디렉토리>] [--no-config] [--no-commands]  (옛 이름은 별칭)
//
// 손으로 하던 넷을 대신한다: pre-commit 훅 작성, 루트 CLAUDE.md 에 계약 문단 추가,
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

const HOOK = `#!/bin/sh
# almandu-harness — 계약 게이트. 인덱스만 본다 (작업 트리 모드와 판정이 다르다)
exec npx --no-install almandu-module-gate --staged
`;

// 루트 CLAUDE.md 가 계약 체계를 한 번은 말해야 한다. 어댑터는 재귀하지 않으므로
// 깊은 파일을 열기 전에 무엇을 읽어야 하는지는 이 문단만이 말해 준다
const ROOT_PARAGRAPH = `
## 계약

파일을 고치기 전에 그 파일을 소유한 **가장 깊은 MODULE.md** 를 읽는다.
어느 것인지 모르면 \`npx --no-install almandu-module-gate --scope <경로>\` 가 답한다.
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
if (!noConfig && !dryRun) {
  const cur = (() => {
    // --local 만 본다. 전역 설정이 우연히 같은 값이어도 이 리포에는 기록이 남아야 한다
    try { return execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { return ''; }
  })();
  if (cur !== hooksPath) {
    execFileSync('git', ['config', 'core.hooksPath', hooksPath], { cwd: root });
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

// ---------- 결과 ----------
for (const d of done) console.log(`${dryRun ? 'DRY ' : ''}+ ${d}`);
for (const s of skipped) console.log(`  · ${s}`);
if (!done.length) console.log('바꿀 것이 없다 — 이미 설치돼 있다');
else if (dryRun) console.log('\n--dry-run: 아무것도 쓰지 않았다');
else console.log('\n다음: 모듈마다 MODULE.md 를 쓰고 `npx --no-install almandu-module-gate` 로 확인한다 (MODULE-schema-v1.md 가 규칙서다)');
