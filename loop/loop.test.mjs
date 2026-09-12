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

function moduleDoc({ slug, path, status = 'draft', watch = '.mjs', history = ['- 2026-01-01 최초 작성'] }) {
  return [
    '---', `module: ${slug}`, `path: ${path}`, 'schema: 1', `status: ${status}`, `watch: ${watch}`, '---', '',
    '## 책임', `${slug} 를 소유한다.`, '',
    '## 진입점', '- 없음', '',
    '## 의존', '### in (이 모듈이 쓰는 것)', '- 없음', '### out (이 모듈을 쓰는 것)', '- 없음', '',
    '## 불변식', '- I1. 아무것도 약속하지 않는다 (근거: 없음) [리뷰]', '',
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
