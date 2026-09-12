#!/usr/bin/env node
// loop.test.mjs — 루프의 회귀 테스트
// 사용: npm test   (node --test module-gate.test.mjs loop/loop.test.mjs)
//
// 게이트 테스트와 같은 방식이다 — 임시 git 저장소에 fixture 를 세운다. 이 리포의 계약서를
// 입력으로 쓰지 않으므로 계약서가 바뀌어도 이 테스트는 그대로다.
// fixture 헬퍼를 module-gate.test.mjs 에서 가져오지 않고 다시 적은 이유: 그 파일은 테스트
// 진입점이지 라이브러리가 아니고, 가져오면 loop 가 조상의 테스트에 묶인다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOP = join(HERE, 'loop.mjs');
const GATE = join(HERE, '..', 'module-gate.mjs');

// ---------- fixture ----------

function moduleDoc({ slug, path, status = 'draft', watch = '.mjs', history = ['- 2026-01-01 최초 작성'],
                     invariants = ['- I1. 아무것도 약속하지 않는다 (근거: 없음) [리뷰]'] }) {
  return [
    '---', `module: ${slug}`, `path: ${path}`, 'schema: 1', `status: ${status}`, `watch: ${watch}`, '---', '',
    '## 책임', `${slug} 를 소유한다.`, '',
    '## 진입점', '- 없음', '',
    '## 의존', '### in (이 모듈이 쓰는 것)', '- 없음', '### out (이 모듈을 쓰는 것)', '- 없음', '',
    '## 불변식', ...invariants, '',
    '## 미결', '',
    '## 이력', ...history, '',
  ].join('\n');
}

function write(dir, rel, text) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function putModule(dir, opts) {
  const where = opts.path === '.' ? '' : opts.path;
  write(dir, join(where, 'MODULE.md'), moduleDoc(opts));
  write(dir, join(where, 'CLAUDE.md'), '@MODULE.md\n');
}

// 루트 + 자식 둘. 자식이 둘이어야 "scope 를 지나지 않은 경로" 를 만들 수 있다 —
// 하나뿐이면 조상 계약이 이미 적재되어 어느 경로든 통과한다
function newRepo(t, { childStatus = 'draft' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'module-loop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
  git('init -q');
  git('config user.email loop@test');
  git('config user.name loop');
  git('config commit.gpgsign false');
  putModule(dir, { slug: 'root', path: '.' });
  putModule(dir, { slug: 'child', path: 'child', status: childStatus });
  putModule(dir, { slug: 'other', path: 'other' });
  write(dir, 'a.mjs', 'export const a = 1;\n');
  write(dir, 'child/b.mjs', 'export const b = 1;\n');
  write(dir, 'other/c.mjs', 'export const c = 1;\n');
  git('add -A');
  git('commit -q -m fixture');
  return { dir, git, write: (rel, text) => write(dir, rel, text) };
}

// stdout·stderr 를 함께 본다 — 루프는 판정 아닌 알림(기준선 재측정 등)을 stderr 로 보내고,
// 그래야 `--json` 의 stdout 이 JSON 만 담는다
function loop(dir, args, env = {}) {
  const r = spawnSync('node', [LOOP, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const sessionPath = (dir) => join(dir, '.git', 'module-loop', 'session.json');
const session = (dir) => JSON.parse(readFileSync(sessionPath(dir), 'utf8'));
const dirty = (dir) => execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();

// ---------- 테스트 ----------

test('scope 없이 reconcile 하면 거부한다 — 계약을 열지 않은 변경은 지나가지 못한다', (t) => {
  const r = newRepo(t);
  const got = loop(r.dir, ['reconcile']);
  assert.equal(got.code, 2);
  assert.match(got.out, /세션이 없다/);
});

test('scope 는 소유 계약을 깊은 것부터 내고 세션을 .git 안에 쓴다', (t) => {
  const r = newRepo(t);
  const got = loop(r.dir, ['scope', 'child/b.mjs']);
  assert.equal(got.code, 0);
  assert.deepEqual(session(r.dir).contracts, ['child/MODULE.md', 'MODULE.md']);
  assert.match(got.out, /child\/MODULE\.md/);
});

test('루프는 리포에 파일을 쓰지 않는다 — 세션은 .git 안에서만 산다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  loop(r.dir, ['reconcile']);
  assert.equal(dirty(r.dir), '');
  assert.ok(existsSync(sessionPath(r.dir)));
});

test('scope 를 다시 불러도 기준선은 처음 것을 그대로 쓴다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  const before = session(r.dir);
  r.write('child/b.mjs', 'export const b = 2;\n');   // 여기서 R1 경고가 생긴다
  loop(r.dir, ['scope', 'other/c.mjs']);
  const after = session(r.dir);
  assert.deepEqual(after.baseline, before.baseline);
  assert.deepEqual(after.contracts, ['child/MODULE.md', 'other/MODULE.md', 'MODULE.md']);
  assert.match(loop(r.dir, ['reconcile']).out, /신규 1건/);
});

test('HEAD 가 움직이면 세션을 거부한다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  r.git('add -A');
  r.git('commit -q -m moved');
  const got = loop(r.dir, ['reconcile']);
  assert.equal(got.code, 2);
  assert.match(got.out, /HEAD/);
});

test('게이트가 바뀌면 거부하지 않고 새 게이트로 기준선을 다시 잰다', (t) => {
  const r = newRepo(t);
  // 게이트 사본은 리포 밖에 둔다 — 안에 두면 그 .mjs 가 R1 을 울려 판정에 섞인다
  const gdir = mkdtempSync(join(tmpdir(), 'module-loop-gate-'));
  t.after(() => rmSync(gdir, { recursive: true, force: true }));
  const copy = join(gdir, 'gate-copy.mjs');
  copyFileSync(GATE, copy);
  const env = { MODULE_GATE: copy };
  r.write('child/b.mjs', 'export const b = 2;\n');   // scope 전부터 서 있는 R1
  loop(r.dir, ['scope', 'child/b.mjs'], env);
  assert.equal(session(r.dir).baseline.length, 1);
  appendFileSync(copy, '// 규칙이 바뀐 척\n');
  const got = loop(r.dir, ['reconcile'], env);
  assert.equal(got.code, 0, got.out);
  assert.match(got.out, /기준선을 다시 잰다/);
  // 재측정은 HEAD 의 트리를 본다. 거기엔 그 변경이 없으므로 R1 이 신규로 올라온다
  assert.match(got.out, /신규 1건/);
  assert.notEqual(session(r.dir).gate, undefined);
});

test('기준선을 다시 재도 리포의 작업 트리는 그대로다', (t) => {
  const r = newRepo(t);
  const gdir = mkdtempSync(join(tmpdir(), 'module-loop-gate-'));
  t.after(() => rmSync(gdir, { recursive: true, force: true }));
  const copy = join(gdir, 'gate-copy.mjs');
  copyFileSync(GATE, copy);
  const env = { MODULE_GATE: copy };
  loop(r.dir, ['scope', 'child/b.mjs'], env);
  appendFileSync(copy, '// 규칙이 바뀐 척\n');
  loop(r.dir, ['reconcile'], env);
  assert.equal(dirty(r.dir), '');
  // 임시 worktree 등록도 남기지 않는다
  assert.equal(execSync('git worktree list', { cwd: r.dir, encoding: 'utf8' }).trim().split('\n').length, 1);
});

test('reconcile 은 기준선에 있던 경고를 신규로 세지 않는다', (t) => {
  const r = newRepo(t);
  r.write('child/b.mjs', 'export const b = 2;\n');   // scope 전부터 서 있는 R1
  loop(r.dir, ['scope', 'child/b.mjs']);
  const got = loop(r.dir, ['reconcile']);
  assert.equal(got.code, 0);
  assert.match(got.out, /신규 0건/);
  assert.match(got.out, /기준선에 있던 1건/);
});

test('reconcile 의 종료 코드는 게이트의 종료 코드다 — 루프는 판정하지 않는다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const got = loop(r.dir, ['reconcile']);
  assert.equal(got.code, 1);
  assert.match(got.out, /FAIL\s+child\s+R1/);
});

test('commit 은 scope 를 지나지 않은 경로를 거부한다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('other/c.mjs', 'export const c = 2;\n');
  const got = loop(r.dir, ['commit', '-m', '무엇을 했다']);
  assert.equal(got.code, 2);
  assert.match(got.out, /scope 를 지나지 않은 경로/);
  assert.match(got.out, /other\/c\.mjs/);
});

test('commit 은 게이트가 FAIL 이면 커밋하지 않는다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const got = loop(r.dir, ['commit', '-m', '무엇을 했다']);
  assert.equal(got.code, 1);
  assert.match(got.out, /1 FAIL/);
  assert.notEqual(dirty(r.dir), '');
});

test('commit 은 active 계약이 묶음에 있으면 --contract 한 줄을 요구한다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  appendFileSync(join(r.dir, 'child/MODULE.md'), '- 2026-01-02 b 를 고쳤다\n');
  const refused = loop(r.dir, ['commit', '-m', '무엇을 했다']);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /--contract/);
  const ok = loop(r.dir, ['commit', '-m', '무엇을 했다', '--contract', 'child 이력에 한 줄']);
  assert.equal(ok.code, 0);
});

test('커밋 메시지가 코드와 계약을 나눠 적고 세션은 끝난다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  appendFileSync(join(r.dir, 'child/MODULE.md'), '- 2026-01-02 b 를 고쳤다\n');
  const got = loop(r.dir, ['commit', '-m', 'feat(child): b 를 고친다', '--contract', 'child 이력 한 줄']);
  assert.equal(got.code, 0);
  const msg = execSync('git log -1 --format=%B', { cwd: r.dir, encoding: 'utf8' });
  assert.match(msg, /^feat\(child\): b 를 고친다/);
  assert.match(msg, /계약: child 이력 한 줄/);
  assert.match(msg, /게이트: 0 FAIL 0 WARN \(신규 0\)/);
  assert.equal(existsSync(sessionPath(r.dir)), false);
  assert.equal(dirty(r.dir), '');
});

test('--dry-run 은 메시지만 내고 커밋하지 않는다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const head = execSync('git rev-parse HEAD', { cwd: r.dir, encoding: 'utf8' }).trim();
  const got = loop(r.dir, ['commit', '-m', '무엇을 했다', '--dry-run']);
  assert.equal(got.code, 0);
  assert.match(got.out, /커밋하지 않았다/);
  assert.equal(execSync('git rev-parse HEAD', { cwd: r.dir, encoding: 'utf8' }).trim(), head);
  assert.ok(existsSync(sessionPath(r.dir)));
});

test('reconcile 은 묶음이 건드린 계약의 불변식을 전부 되묻는다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const got = loop(r.dir, ['reconcile']);
  assert.match(got.out, /어느 것을 약화시켰나/);
  assert.match(got.out, /I1\. 아무것도 약속하지 않는다/);
});

test('--trailer 는 계약·게이트 줄과 같은 문단에 붙는다 — git 이 트레일러로 읽는 자리다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const got = loop(r.dir, ['commit', '-m', '무엇을 했다', '--trailer', 'Co-Authored-By: 누군가 <x@y>']);
  assert.equal(got.code, 0);
  const last = execSync('git log -1 --format=%B', { cwd: r.dir, encoding: 'utf8' }).trim().split('\n\n').pop();
  assert.match(last, /^게이트: .*\nCo-Authored-By: 누군가 <x@y>$/);
});

// review 는 세션을 요구하지 않는다 — 리뷰 범위는 세션이 아니라 diff 가 정한다
function reviewRepo(t, { expect = 2 } = {}) {
  const r = newRepo(t);
  write(r.dir, 'child/MODULE.md', moduleDoc({ slug: 'child', path: 'child', invariants: [
    '- I1. b 를 약속한다 (근거: child/b.mjs:1) [테스트]',
    `- I2. export 는 둘이다 (근거: child/b.mjs:2, 재현: child 에서 \`export \` ${expect}건) [grep]`,
    '- I3. 판정 수단이 없다 (근거: child/b.mjs:3) [리뷰]',
  ] }));
  r.write('child/b.mjs', 'export const b = 1;\nexport const c = 2;\nconst d = 3;\n');
  r.git('add -A');
  r.git('commit -q -m fixture2');
  r.write('child/b.mjs', 'export const b = 9;\nexport const c = 2;\nconst d = 3;\n');
  return r;
}

test('review 는 태그별로 리뷰어를 배치하고 세션을 요구하지 않는다', (t) => {
  const r = reviewRepo(t);
  const got = loop(r.dir, ['review', '--json']);
  assert.equal(got.code, 0, got.out);
  const j = JSON.parse(got.out.trim().split('\n').pop());
  assert.deepEqual(j.byTag, { 테스트: 1, grep: 1, 리뷰: 1, 없음: 0 });
  assert.equal(j.test.known, false);          // fixture 에 package.json 이 없다
  assert.deepEqual(j.r13, []);
  assert.equal(j.failed, false);
});

test('review 는 R13 이 재현 주장의 어긋남을 내면 1 로 끝난다', (t) => {
  const r = reviewRepo(t, { expect: 1 });     // 실제로는 2건이다
  const got = loop(r.dir, ['review']);
  assert.equal(got.code, 1, got.out);
  assert.match(got.out, /R13 이 어긋남을 냈다/);
});

test('review 는 리포의 테스트 명령이 실패하면 1 로 끝난다', (t) => {
  const r = reviewRepo(t);
  r.write('package.json', '{ "name": "fixture", "scripts": { "test": "node -e \\"process.exit(1)\\"" } }\n');
  const got = loop(r.dir, ['review']);
  assert.equal(got.code, 1, got.out);
  assert.match(got.out, /`npm test` 실패/);
});

test('review 는 변경과 무관한 불변식을 내지 않는다', (t) => {
  const r = reviewRepo(t);
  const j = JSON.parse(loop(r.dir, ['review', '--json']).out.trim().split('\n').pop());
  // other/MODULE.md 의 I1 은 근거가 "없음" 이라 어느 파일도 인용하지 않는다
  assert.deepEqual([...new Set(j.invariants.map((i) => i.module))], ['child']);
});

// ---------- 리뷰 패킷 (DESIGN-review.md 2절) ----------

const packetPath = (dir) => join(dir, '.git', 'module-loop', 'review-packet.json');
const packet = (dir) => JSON.parse(readFileSync(packetPath(dir), 'utf8'));

test('패킷은 같은 트리에서 두 번 만들면 같은 해시다', (t) => {
  const r = reviewRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  const first = loop(r.dir, ['review', '--packet', '--json']);
  assert.equal(first.code, 0, first.out);
  const a = JSON.parse(first.out.trim().split('\n').pop());
  const b = JSON.parse(loop(r.dir, ['review', '--packet', '--json']).out.trim().split('\n').pop());
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash.length, 64);
  assert.deepEqual(a.packet.session, { head: session(r.dir).head, gate_hash: session(r.dir).gate });
  assert.deepEqual(a.packet.scope, ['child', 'root']);
  assert.deepEqual(a.packet.diff.owners, { 'child/b.mjs': 'child' });
});

test('봉인이 깨진 세션에서는 패킷을 만들지 않는다', (t) => {
  const r = reviewRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.git('add -A');
  r.git('commit -q -m moved');
  const got = loop(r.dir, ['review', '--packet']);
  assert.equal(got.code, 2);
  assert.match(got.out, /HEAD/);
  assert.equal(existsSync(packetPath(r.dir)), false);
});

test('게이트가 FAIL 이면 패킷을 만들지 않는다 — 기계가 거부한 것에 판단을 붙이지 않는다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  r.write('child/b.mjs', 'export const b = 2;\n');
  const got = loop(r.dir, ['review', '--packet']);
  assert.equal(got.code, 1);
  assert.match(got.out, /FAIL/);
  assert.equal(existsSync(packetPath(r.dir)), false);
});

test('미결·이력만 바뀐 MODULE.md 는 contract_diff 가 빈 문자열이다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  appendFileSync(join(r.dir, 'child/MODULE.md'), '- 2026-01-02 이력 한 줄\n');
  assert.equal(loop(r.dir, ['review', '--packet']).code, 0);
  const p = packet(r.dir);
  assert.deepEqual(p.diff.contract, ['child/MODULE.md']);
  assert.deepEqual(p.diff.code, []);
  assert.equal(p.contract_diff, '');
});

test('불변식이 바뀌면 contract_diff 에 그 줄이 들어간다', (t) => {
  const r = newRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs']);
  write(r.dir, 'child/MODULE.md', moduleDoc({ slug: 'child', path: 'child', invariants: [
    '- I1. 이제는 무엇인가를 약속한다 (근거: child/b.mjs:1) [리뷰]',
  ] }));
  assert.equal(loop(r.dir, ['review', '--packet']).code, 0);
  const p = packet(r.dir);
  assert.match(p.contract_diff, /^diff --git a\/child\/MODULE\.md b\/child\/MODULE\.md$/m);
  assert.match(p.contract_diff, /^\+- I1\. 이제는 무엇인가를 약속한다/m);
  assert.doesNotMatch(p.contract_diff, /module-loop-packet-/);   // 임시 경로가 새면 해시가 흔들린다
});

test('근거 파일이 diff 에 없는 [리뷰] 불변식은 패킷에 들어가지 않는다', (t) => {
  const r = reviewRepo(t);
  loop(r.dir, ['scope', 'child/b.mjs', 'other/c.mjs']);
  loop(r.dir, ['review', '--packet']);
  // child I3 만 [리뷰] 이고 그 근거 child/b.mjs 가 이번 diff 에 있다
  assert.deepEqual(packet(r.dir).review_invariants.map((i) => `${i.module}/${i.id}`), ['child/I3']);
  assert.equal(packet(r.dir).review_invariants[0].touched, true);
  // b.mjs 를 되돌리고 다른 파일만 고치면 그 불변식은 빠진다
  r.write('child/b.mjs', 'export const b = 1;\nexport const c = 2;\nconst d = 3;\n');
  r.write('other/c.mjs', 'export const c = 2;\n');
  loop(r.dir, ['review', '--packet']);
  assert.deepEqual(packet(r.dir).review_invariants, []);
  assert.deepEqual(packet(r.dir).diff.code, ['other/c.mjs']);
});

test('active 계약이 묶음에 있으면 패킷도 --contract 한 줄을 요구한다', (t) => {
  const r = newRepo(t, { childStatus: 'active' });
  loop(r.dir, ['scope', 'child/b.mjs']);
  appendFileSync(join(r.dir, 'child/MODULE.md'), '- 2026-01-02 이력 한 줄\n');
  const refused = loop(r.dir, ['review', '--packet']);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /--contract/);
  const ok = loop(r.dir, ['review', '--packet', '--contract', '이력 한 줄을 더했다']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(packet(r.dir).contract_statement, '이력 한 줄을 더했다');
  // 세션이 문장을 들고 있으므로 다시 만들 때 플래그를 되풀이하지 않아도 된다
  assert.equal(loop(r.dir, ['review', '--packet']).code, 0);
  assert.equal(packet(r.dir).contract_statement, '이력 한 줄을 더했다');
});
