#!/usr/bin/env node
// loop.mjs — scope → change → reconcile 루프 (DESIGN.md 4b)
// 사용: node loop/loop.mjs scope <경로>...                    (계약을 열고 기준선을 잡는다)
//       node loop/loop.mjs status
//       node loop/loop.mjs reconcile                          (재판정 + 기준선 차집합)
//       node loop/loop.mjs review                             (게이트가 정한 배치대로 리뷰어를 돌린다)
//       node loop/loop.mjs review --packet [--contract "<한 줄>"]  (페르소나에게 줄 입력을 만든다)
//       node loop/loop.mjs commit -m "<제목>" [-m <본문>...] [--contract "<한 줄>"] [--dry-run]
//       node loop/loop.mjs abort
// 종료 코드: 게이트를 부르는 명령은 게이트의 종료 코드를 그대로 낸다 — 루프는 판정하지 않는다.
//           루프 자신의 거부(세션 없음, scope 밖 경로 등)는 2 다.
import { execFileSync, spawnSync } from 'node:child_process';
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
// 패킷도 같은 자리에 산다 — 재생성 가능하고 커밋되지 않는다 (DESIGN-review.md 2절)
const PACKET = join(dirname(SESSION), 'review-packet.json');
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
const slugOf = (f) => (existsSync(join(root, f))
  ? readFileSync(join(root, f), 'utf8').match(/^module:\s*(.+?)\s*$/m)?.[1] ?? f : f);

// ---------- 리뷰 패킷의 재료 ----------
// 계약 섹션 목록의 출처는 게이트 하나다 — 여기 사본을 두면 게이트가 섹션을 늘릴 때
// contract_diff 가 그 섹션을 조용히 빠뜨린다. 읽지 못하면 패킷을 만들지 않는다
function contractSections() {
  const m = readFileSync(GATE, 'utf8').match(/const CONTRACT_SECTIONS\s*=\s*\[([^\]]*)\]/);
  if (!m) die('게이트에서 CONTRACT_SECTIONS 를 읽지 못했다 — 계약 섹션 목록의 출처는 게이트 하나다');
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// 계약서에서 계약 칸만 뽑는다. 미결·이력은 빼므로 그쪽만 바뀐 커밋의 contract_diff 는 빈 문자열이다 —
// 리뷰가 묻는 것은 "이번에 무엇을 약속했나" 이고, 이력 한 줄은 약속이 아니다 (R2 와 같은 경계)
const contractText = (text, sections) => sections.map((s) => {
  const body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
    .match(new RegExp(`\\n## ${s}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return `## ${s}\n${(body ? body[1] : '').trim()}\n`;
}).join('\n');

// 계약 칸만 뽑아 base 판본과 대조한다. hunk 를 골라내지 않고 뽑은 텍스트끼리 비교하는 이유는
// hunk 헤더가 어느 섹션에 속하는지 git 이 markdown 을 모르면 말해 주지 않기 때문이다
function contractDiff(files) {
  if (!files.length) return '';
  const sections = contractSections();
  const dir = mkdtempSync(join(tmpdir(), 'module-loop-packet-'));
  const out = [];
  try {
    for (const f of files) {
      let before = '';
      try { before = run('git', ['show', `HEAD:${f}`], { cwd: root }); } catch { /* 새 계약서 */ }
      const now = existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '';
      for (const [side, text] of [['base', before], ['work', now]]) {
        const p = join(dir, side, f);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, contractText(text, sections));
      }
      let d = '';
      try { d = run('git', ['diff', '--no-index', '--unified=3', '--', `base/${f}`, `work/${f}`], { cwd: dir }); }
      catch (e) { if (e.status !== 1) throw e; d = e.stdout ?? ''; }
      if (!d.trim()) continue;
      // 임시 디렉토리 이름이 패킷에 새면 같은 트리가 다른 해시를 낸다. 헤더를 리포 경로로 되돌린다
      out.push(`${d.split('\n').filter((l) => !l.startsWith('index ')).map((l) =>
        l.startsWith('diff --git ') ? `diff --git a/${f} b/${f}`
          : l.startsWith('--- ') ? `--- a/${f}`
            : l.startsWith('+++ ') ? `+++ b/${f}` : l).join('\n').trim()}\n`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return out.join('');
}

// 키 순서가 해시를 바꾸지 않게 정렬해 직렬화한다. 5b 의 review-result 가 이 해시로 패킷에 묶인다
const stable = (v) => (Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
    : v);
const packetHash = (p) => createHash('sha256').update(JSON.stringify(stable(p))).digest('hex');

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

// ---------- review --packet ----------
// 리뷰 단계의 **입력**만 만든다 (DESIGN-review.md 2절). 판단은 여기 없다 — 패킷은 호출자가
// 페르소나에게 줄 재료이고, 답은 사람이나 서브에이전트가 낸다.
// 세션 봉인을 그대로 상속한다: 봉인이 깨져 있으면 패킷을 만들지 않는다. 낡은 기준선으로 만든
// 패킷은 "이번 변경" 이 무엇인지를 두고 거짓말한다.
if (cmd === 'review' && has('--packet')) {
  const s = requireSession();
  const { code, data } = gateJson();
  // 기계가 이미 거부한 것에 판단을 붙일 이유가 없다 (DESIGN-review.md 1절)
  if (data.fail) {
    console.error(`loop: 게이트가 ${data.fail} FAIL — 패킷을 만들지 않는다. reconcile 이 OK 여야 리뷰가 돈다`);
    for (const r of data.results.filter((r) => r.level === 'FAIL')) console.error(`  ${fmt(r)}`);
    process.exit(code);
  }

  const files = bundle();
  if (!files.length) die('묶음이 비었다 — 리뷰할 변경이 없다');
  const contractFiles = files.filter(isContract);
  const codeFiles = files.filter((f) => !isContract(f));
  const codeSet = new Set(codeFiles);

  // 계약 대조자는 이 문장과 계약 diff 를 맞춰 본다. 문장이 없으면 그 질문이 성립하지 않으므로
  // I6 이 커밋에서 요구하는 것과 같은 자리에서 같은 줄을 요구한다
  const statement = value('--contract') ?? s.contract_statement ?? '';
  const activeContracts = contractFiles.filter(isActive);
  if (activeContracts.length && !statement)
    die(`active 계약이 묶음에 있다 (${activeContracts.join(', ')}) — \`--contract "<무엇이 왜 바뀌었나>"\` 를 적어라`);
  if (statement !== (s.contract_statement ?? '')) {
    s.contract_statement = statement;
    writeFileSync(SESSION, `${JSON.stringify(s, null, 2)}\n`);
  }

  const { data: owned } = gateJson('--scope', ...files);
  const { data: scoped } = gateJson('--review');
  // 읽지 않은 코드에 판단을 붙이면 추측이 된다 — 근거 파일을 이번 diff 가 건드린 것만 싣는다
  const reviewInvariants = scoped.invariants
    .filter((it) => it.tag === '리뷰' && it.evidence.some((e) => codeSet.has(e.split(':')[0])))
    .map((it) => ({ module: it.module, id: it.id, text: it.text, evidence: it.evidence, touched: true }));

  const packet = {
    session: { head: s.head, gate_hash: s.gate },
    scope: [...new Set(s.contracts.map(slugOf))],
    diff: {
      code: codeFiles,
      contract: contractFiles,
      owners: Object.fromEntries(owned.paths.map((p) => [p.path, p.owner])),
    },
    contract_statement: statement,
    contract_diff: contractDiff(contractFiles),
    review_invariants: reviewInvariants,
  };
  const hash = packetHash(packet);
  mkdirSync(dirname(PACKET), { recursive: true });
  writeFileSync(PACKET, `${JSON.stringify(packet, null, 2)}\n`);

  if (has('--json')) {
    process.stdout.write(`${JSON.stringify({ schema: 1, mode: 'packet', hash, packet })}\n`);
    process.exit(0);
  }
  console.log(`패킷: .git/module-loop/review-packet.json  (sha256 ${hash.slice(0, 8)})`);
  console.log(`  scope: ${packet.scope.join(', ') || '없음'}`);
  console.log(`  코드 ${codeFiles.length}개, 계약 ${contractFiles.length}개 — 계약 diff ${packet.contract_diff ? '있음' : '없음 (미결·이력만 바뀌었다)'}`);
  console.log(`  [리뷰] 불변식 ${reviewInvariants.length}개 — 판단이 필요한 자리다`);
  for (const it of reviewInvariants) console.log(`    ${it.module} ${it.id} ${it.text}`);
  console.log('\n→ 페르소나 셋에 이 패킷을 준다. 답은 이 루프가 만들지 않는다');
  process.exit(0);
}

// ---------- review ----------
// 게이트가 리뷰 범위와 태그를 정하고(`--review`), 여기서는 그 배치대로 리뷰어를 돌린다.
// 계약 문장에 대한 판정은 하지 않는다 — 종료 코드는 테스트 러너와 R13 의 결과를 그대로 낸 것이다.
if (cmd === 'review') {
  const { data: scope } = gateJson('--review');
  const { data: verdict } = gateJson();     // [grep] 리뷰어는 R13 의 판정을 그대로 쓴다 (두 번째 카운터를 만들지 않는다)
  const group = (tag) => scope.invariants.filter((it) => (it.tag ?? '없음') === tag);

  // [테스트] 는 "그 불변식을 검증하는 테스트" 를 특정하지 못한다 — 계약서가 적지 않는다.
  // 리포의 테스트 명령 전체를 돌리고 통과를 증거로 삼되, 명령을 모르면 모른다고 말한다
  let test = { known: false, ok: null, tail: '' };
  const pkg = join(root, 'package.json');
  if (group('테스트').length && existsSync(pkg)) {
    const script = JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test;
    if (script) {
      const r = spawnSync('npm', ['test', '--silent'], { cwd: root, encoding: 'utf8' });
      test = { known: true, ok: r.status === 0, tail: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n') };
    }
  }
  // R13 은 재현 주장을 다시 센 결과다. 예산에 걸려 못 센 것도 R13 으로 말하므로 그대로 옮긴다
  const r13 = verdict.results.filter((r) => r.rule === 'R13');
  const failed = (test.known && !test.ok) || r13.length > 0;

  if (has('--json')) {
    process.stdout.write(`${JSON.stringify({
      schema: 1, mode: 'review', changed: scope.changed, invariants: scope.invariants,
      byTag: scope.byTag, unjudgeable: scope.unjudgeable, test, r13, failed,
    })}\n`);
    process.exit(failed ? 1 : 0);
  }
  console.log(`review: ${scope.changed}개 파일 변경 → 봐야 할 불변식 ${scope.invariants.length}개`);
  const show = (it) => {
    console.log(`  ${it.module.padEnd(14)} ${it.id.padEnd(4)} ${it.text}`);
    console.log(`    근거 ${it.evidence.join(' ')}`);
  };
  if (group('테스트').length) {
    console.log(`\n[테스트] ${group('테스트').length}건 — ${test.known ? (test.ok ? '`npm test` 통과. 그것이 증거다' : '`npm test` 실패 — 아래 문장 중 무엇이 깨졌는지 먼저 본다') : '테스트 명령을 모른다. 사람이 돌린다'}`);
    group('테스트').forEach(show);
    if (test.known && !test.ok) console.log(test.tail.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  if (group('grep').length) {
    console.log(`\n[grep] ${group('grep').length}건 — ${r13.length ? 'R13 이 어긋남을 냈다' : 'R13 이 재현 주장을 다시 셌고 어긋남이 없다'}`);
    for (const it of group('grep')) {
      show(it);
      for (const rp of it.repro) console.log(`    재현: ${rp.scope} 에서 \`${rp.pattern}\` ${rp.expect}건`);
    }
    for (const r of r13) console.log(`    ${fmt(r)}`);
  }
  if (group('리뷰').length) {
    console.log(`\n[리뷰] ${group('리뷰').length}건 — 판정 수단이 없다고 계약서가 스스로 적은 자리다. 여기만 판단이 필요하다`);
    group('리뷰').forEach(show);
  }
  if (group('없음').length) { console.log(`\n[태그 없음] ${group('없음').length}건 — R5 가 이미 울고 있을 것이다`); group('없음').forEach(show); }
  if (scope.unjudgeable.length) console.log(`\n판정 수단이 없는 계약서: ${scope.unjudgeable.join(', ')} — 불변식이 둘 이상인데 전부 [리뷰] 다`);
  console.log('\n지적은 위 ID 를 인용한다. 인용할 불변식이 없는 지적은 계약이 비었다는 뜻이거나(→ 계약을 고친다) 취향이다(→ 버린다).');
  process.exit(failed ? 1 : 0);
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

die('사용: node loop/loop.mjs <scope|status|reconcile|review|commit|abort> ...');
