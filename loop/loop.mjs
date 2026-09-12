#!/usr/bin/env node
// loop.mjs — scope → change → reconcile 루프 (DESIGN.md 4b)
// 사용: node loop/loop.mjs scope <경로>...                    (계약을 열고 기준선을 잡는다)
//       node loop/loop.mjs status
//       node loop/loop.mjs reconcile                          (재판정 + 기준선 차집합)
//       node loop/loop.mjs commit -m "<제목>" [-m <본문>...] [--contract "<한 줄>"] [--dry-run]
//       node loop/loop.mjs abort
// 종료 코드: 게이트를 부르는 명령은 게이트의 종료 코드를 그대로 낸다 — 루프는 판정하지 않는다.
//           루프 자신의 거부(세션 없음, scope 밖 경로 등)는 2 다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = process.env.MODULE_GATE ?? join(HERE, '..', 'module-gate.mjs');

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
// 반복 가능한 플래그. `-m` 은 git 처럼 여러 번 올 수 있다
const values = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const value = (f) => values(f)[0];

const die = (msg, code = 2) => { console.error(`loop: ${msg}`); process.exit(code); };
const run = (file, args, opts = {}) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const root = (() => {
  try { return run('git', ['rev-parse', '--show-toplevel']).trim(); }
  catch { die('git 저장소가 아니다'); }
})();
const git = (...args) => run('git', args, { cwd: root }).trim();
const gitZ = (...args) => run('git', args, { cwd: root }).split('\0').filter(Boolean);

// 세션은 `.git/` 안에서만 산다 — 커밋되지 않고, 게이트의 diff 에 나타나지 않고, 클론과 함께 죽는다.
// 리포 안에 두면 그 파일이 곧 "승인된 경고 목록" 이 되고, observations/01 이 적은 대로 규칙이
// 바뀌는 순간 거짓이 된다
const SESSION = join(git('rev-parse', '--absolute-git-dir'), 'module-loop', 'session.json');
const GATE_HASH = createHash('sha256').update(readFileSync(GATE)).digest('hex').slice(0, 12);
const head = () => git('rev-parse', 'HEAD');

// ---------- 게이트 호출 ----------
// 게이트는 FAIL 이 있으면 1 로 끝난다. 그건 오류가 아니라 판정이므로 코드와 출력을 함께 돌려준다
function gate(...args) {
  try { return { code: 0, out: run(process.execPath, [GATE, ...args], { cwd: root }) }; }
  catch (e) {
    if (e.status == null) throw e;
    return { code: e.status, out: e.stdout ?? '' };
  }
}
function gateJson(...args) {
  const { code, out } = gate(...args, '--json');
  const line = out.trim().split('\n').pop() ?? '';
  try { return { code, data: JSON.parse(line) }; }
  catch { return die(`게이트 출력을 읽지 못했다: ${out.slice(0, 400)}`); }
}

const pair = (r) => `${r.module}|${r.rule}`;
const fmt = (r) => `${r.level.padEnd(4)} ${r.module.padEnd(20)} ${r.rule}  ${r.message}`;
const deepFirst = (a, b) => b.split('/').length - a.split('/').length;

// 이 묶음이 담고 있는 것. 스테이지 여부를 묻지 않는다 — 루프의 단위는 작업 트리 전체다
const bundle = () => [...new Set([
  ...gitZ('diff', '--name-only', '-z', 'HEAD'),
  ...gitZ('ls-files', '-z', '--others', '--exclude-standard'),
])].sort();

// ---------- 세션 ----------
const readSession = () => (existsSync(SESSION) ? JSON.parse(readFileSync(SESSION, 'utf8')) : null);

// 새 게이트를 옛 트리(세션의 HEAD)에 대고 기준선을 다시 잰다. 임시 worktree 는 OS 임시
// 디렉토리에 뜨고 `.git/worktrees/` 에 등록만 남으므로 리포의 작업 트리는 그대로다.
// scope 시점에 이미 더러웠던 변경은 HEAD 에 없어 재측정에 안 들어간다 — 그만큼 신규로
// 과보고하고, 과소보고하지 않는다
function remeasure(sha) {
  const dir = mkdtempSync(join(tmpdir(), 'module-loop-base-'));
  const wt = join(dir, 'head');
  let baseline = null;
  let err = null;
  try {
    run('git', ['worktree', 'add', '--detach', '--quiet', wt, sha], { cwd: root });
    let out = '';
    try { out = run(process.execPath, [GATE, '--json'], { cwd: wt }); }
    catch (e) { if (e.status == null) throw e; out = e.stdout ?? ''; }
    baseline = JSON.parse(out.trim().split('\n').pop()).results.map(pair);
  } catch (e) { err = e; }
  // die 는 즉시 종료하므로 정리를 finally 에 두지 않는다 — 임시 worktree 등록이 남는다
  try { run('git', ['worktree', 'remove', '--force', wt], { cwd: root }); } catch { /* 이미 없다 */ }
  rmSync(dir, { recursive: true, force: true });
  if (err) die(`기준선을 다시 재지 못했다 (${String(err.message).split('\n')[0]}) — \`abort\` 후 다시 \`scope\``);
  return baseline;
}

function requireSession() {
  const s = readSession();
  if (!s) die('세션이 없다 — `scope` 를 먼저 돌려라. 계약을 열지 않은 변경은 이 루프를 지나가지 못한다');
  if (s.head !== head()) die(`기준선은 HEAD ${s.head.slice(0, 8)} 에서 쟀는데 지금은 ${head().slice(0, 8)} 이다 — \`abort\` 후 다시 \`scope\``);
  // 옛 규칙으로 잰 기준선과 새 규칙의 판정은 차집합을 낼 수 없다. 거부하면 이 루프의 첫 용도
  // (게이트를 고치는 커밋)가 자기 루프를 못 쓰므로, 버리는 대신 새 게이트로 다시 잰다
  if (s.gate !== GATE_HASH) {
    console.error('loop: 게이트가 바뀌었다 — HEAD 의 임시 worktree 에서 새 게이트로 기준선을 다시 잰다');
    s.baseline = remeasure(s.head);
    s.gate = GATE_HASH;
    writeFileSync(SESSION, `${JSON.stringify(s, null, 2)}\n`);
  }
  return s;
}

// 계약서의 불변식 줄. 근거 앞까지만 보여 준다 — reconcile 이 묻는 것은 "이 문장이 아직 참인가" 다
function invariantsOf(file) {
  if (!existsSync(join(root, file))) return [];
  const sec = readFileSync(join(root, file), 'utf8').split(/^## /m).find((s) => s.startsWith('불변식'));
  return sec ? sec.split('\n').filter((l) => /^- I\d+\./.test(l)).map((l) => l.replace(/\s*\(근거:.*$/, '')) : [];
}
const isContract = (f) => f === 'MODULE.md' || f.endsWith('/MODULE.md');
const isActive = (f) => existsSync(join(root, f)) && /^status:\s*active\s*$/m.test(readFileSync(join(root, f), 'utf8'));

// ---------- scope ----------
if (cmd === 'scope') {
  const paths = [];
  for (let i = 1; i < argv.length && !argv[i].startsWith('--'); i++) paths.push(argv[i]);
  if (!paths.length) die('경로가 없다: node loop/loop.mjs scope <경로>...');

  const { data: scoped } = gateJson('--scope', ...paths);
  const prev = readSession();
  // 기준선은 첫 scope 것만 쓴다. 변경 도중 scope 를 다시 부르면서 새로 재면 그 사이에 만든
  // 경고가 "원래 서 있던 것" 으로 둔갑한다
  const carry = prev && prev.head === head() && prev.gate === GATE_HASH ? prev : null;
  const baseline = carry ? carry.baseline : gateJson().data.results.map(pair);
  const dirty = carry ? carry.dirty : bundle();

  const session = {
    schema: 1,
    started: carry?.started ?? new Date().toISOString(),
    head: head(),
    gate: GATE_HASH,
    paths: [...new Set([...(carry?.paths ?? []), ...scoped.paths.map((p) => p.path)])].sort(),
    contracts: [...new Set([...(carry?.contracts ?? []), ...scoped.contracts])].sort(deepFirst),
    baseline,
    dirty,
  };
  mkdirSync(dirname(SESSION), { recursive: true });
  writeFileSync(SESSION, `${JSON.stringify(session, null, 2)}\n`);

  if (has('--json')) { process.stdout.write(`${JSON.stringify({ schema: 1, mode: 'scope', ...session })}\n`); process.exit(0); }
  console.log(`scope: ${session.paths.join(', ')}`);
  if (!session.contracts.length) console.log('  소유 계약 없음 — 이 경로를 책임지는 MODULE.md 가 트리에 없다');
  else {
    console.log('읽어야 할 계약 (깊은 것부터):');
    for (const c of session.contracts) console.log(`  ${c}`);
    console.log('→ Read 로 열어라. cat 으로 열면 같은 디렉토리의 CLAUDE.md 어댑터가 실리지 않는다.');
  }
  const bl = baseline.length;
  console.log(`\n기준선: ${bl}건 — 이 변경의 책임이 아니다. reconcile 은 여기 없던 것만 신규로 센다`);
  if (carry) console.log(`  (${carry.started} 세션에 이어 붙였다 — 기준선은 그대로다)`);
  if (dirty.length) {
    console.log(`\n작업 트리에 이미 변경 ${dirty.length}건이 있다. commit 은 이것들도 같은 묶음에 싣는다:`);
    for (const f of dirty) console.log(`  ${f}`);
  }
  process.exit(0);
}

// ---------- reconcile ----------
if (cmd === 'reconcile') {
  const s = requireSession();
  const { code, data } = gateJson();
  const fresh = data.results.filter((r) => !s.baseline.includes(pair(r)));
  const carried = data.results.filter((r) => s.baseline.includes(pair(r)));
  const files = bundle();
  const { data: owned } = files.length ? gateJson('--scope', ...files) : { data: { paths: [] } };
  const unscoped = owned.paths.filter((p) => p.contracts.length && !s.contracts.includes(p.contracts[0]));
  const touched = [...new Set(owned.paths.flatMap((p) => p.contracts))].sort(deepFirst);

  if (has('--json')) {
    process.stdout.write(`${JSON.stringify({
      schema: 1, mode: 'reconcile', fail: data.fail, warn: data.warn,
      fresh, carried, contracts: touched, unscoped: unscoped.map((p) => p.path),
    })}\n`);
    process.exit(code);
  }
  console.log(`묶음: ${files.length}개 파일, 게이트 ${data.fail} FAIL ${data.warn} WARN`);
  if (fresh.length) { console.log(`\n신규 ${fresh.length}건 — 이 변경이 만든 것이다:`); for (const r of fresh) console.log(`  ${fmt(r)}`); }
  else console.log('\n신규 0건');
  if (carried.length) { console.log(`\n기준선에 있던 ${carried.length}건 (이 변경 전부터 서 있었다):`); for (const r of carried) console.log(`  ${fmt(r)}`); }
  if (unscoped.length) {
    console.log(`\nscope 를 지나지 않은 경로 ${unscoped.length}개 — commit 이 거부한다:`);
    for (const p of unscoped) console.log(`  ${p.path} → ${p.contracts[0]}`);
  }
  // 게이트가 못 보는 자리. 계약서를 고쳤는지는 R1·R11 이 보지만, 고친 문장이 사실인지는 아무도 안 본다
  console.log('\n이 변경이 아래 문장 중 어느 것을 약화시켰나 — 답은 계약서에 적는다:');
  for (const c of touched) {
    console.log(`  ${c}`);
    for (const inv of invariantsOf(c)) console.log(`    ${inv.replace(/^- /, '')}`);
  }
  process.exit(code);
}

// ---------- commit ----------
if (cmd === 'commit') {
  const s = requireSession();
  const paragraphs = values('-m');
  const contractLine = value('--contract');
  if (!paragraphs.length) die('-m "<제목>" 이 필요하다');

  const files = bundle();
  if (!files.length) die('묶음이 비었다 — 커밋할 변경이 없다');

  // 이 루프의 존재 이유. 계약을 열지 않고 고친 경로는 커밋되지 않는다
  const { data: owned } = gateJson('--scope', ...files);
  const unscoped = owned.paths.filter((p) => p.contracts.length && !s.contracts.includes(p.contracts[0]));
  if (unscoped.length) {
    console.error('loop: scope 를 지나지 않은 경로가 묶음에 있다 — 그 계약을 먼저 열어라:');
    for (const p of unscoped) console.error(`  ${p.path} → node loop/loop.mjs scope ${p.path}`);
    process.exit(2);
  }

  const { code, data } = gateJson();
  if (data.fail) {
    console.error(`loop: 게이트가 ${data.fail} FAIL — 커밋하지 않는다`);
    for (const r of data.results.filter((r) => r.level === 'FAIL')) console.error(`  ${fmt(r)}`);
    process.exit(code);
  }

  // active 모듈의 계약이 묶음에 있으면 그 갱신이 무엇인지 한 줄로 적게 한다. R1 이 코드와 계약을
  // 같은 묶음에 묶으므로 커밋 메시지가 둘을 나누지 않으면 이력에서 계약 갱신이 사라진다
  const activeContracts = files.filter((f) => isContract(f) && isActive(f));
  if (activeContracts.length && !contractLine)
    die(`active 계약이 묶음에 있다 (${activeContracts.join(', ')}) — \`--contract "<무엇이 왜 바뀌었나>"\` 를 적어라`);

  // 트레일러는 한 문단이어야 git 이 그렇게 읽는다 — `--trailer` 로 받은 줄도 같은 문단에 붙인다
  const fresh = data.results.filter((r) => !s.baseline.includes(pair(r))).length;
  const trailer = [
    ...(contractLine ? [`계약: ${contractLine}`] : []),
    `게이트: ${data.fail} FAIL ${data.warn} WARN (신규 ${fresh})`,
    ...values('--trailer'),
  ].join('\n');
  const message = `${[...paragraphs, trailer].join('\n\n')}\n`;

  if (has('--dry-run')) {
    console.log(`묶음 ${files.length}개 파일:`);
    for (const f of files) console.log(`  ${f}`);
    console.log(`\n--- 커밋 메시지 ---\n${message}--- 여기까지 (--dry-run: 커밋하지 않았다) ---`);
    process.exit(0);
  }
  git('add', '-A');
  run('git', ['commit', '-q', '-F', '-'], { cwd: root, input: message });
  rmSync(SESSION, { force: true });
  console.log(`커밋했다: ${git('rev-parse', '--short', 'HEAD')}  (파일 ${files.length}개, 세션 종료)`);
  process.exit(0);
}

// ---------- status / abort ----------
if (cmd === 'status') {
  const s = readSession();
  if (!s) { console.log('세션 없음 — `scope` 로 시작한다'); process.exit(0); }
  // status 는 세션을 건드리지 않는다 — 재측정은 reconcile·commit 이 할 일이므로 여기서는 알리기만 한다
  const stale = s.head !== head() ? 'HEAD 가 움직였다 — `abort` 후 다시 `scope`'
    : s.gate !== GATE_HASH ? '게이트가 바뀌었다 — 다음 reconcile 이 기준선을 다시 잰다' : null;
  if (has('--json')) { process.stdout.write(`${JSON.stringify({ schema: 1, mode: 'status', stale, ...s })}\n`); process.exit(0); }
  console.log(`세션 ${s.started} (HEAD ${s.head.slice(0, 8)}, 게이트 ${s.gate})`);
  console.log(`  경로 ${s.paths.length}개, 적재된 계약 ${s.contracts.length}개, 기준선 ${s.baseline.length}건`);
  for (const c of s.contracts) console.log(`    ${c}`);
  if (stale) console.log(`  ${stale}`);
  process.exit(0);
}

if (cmd === 'abort') {
  rmSync(SESSION, { force: true });
  console.log('세션을 버렸다');
  process.exit(0);
}

die('사용: node loop/loop.mjs <scope|status|reconcile|commit|abort> ...');
