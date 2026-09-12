#!/usr/bin/env node
// module-gate.test.mjs — 게이트 자신의 회귀 테스트
// 사용: node --test .harness/module-gate.test.mjs
//
// 임시 git 저장소에 fixture 모듈을 세우고 규칙별로 우는지·조용한지 본다.
// 이 리포의 계약서를 판정하지 않는다 — 계약서가 바뀌어도 이 테스트는 그대로여야 하고,
// .harness/ 가 별도 저장소로 나갈 때 이 파일이 게이트를 따라간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'module-gate.mjs');

// ---------- fixture ----------

// 최소 계약서. 기본값은 어느 규칙도 울리지 않는 상태이고, 테스트가 한 곳만 어긋나게 만든다
function moduleDoc({
  slug, path, status = 'draft', watch,
  inDeps = ['- 없음'], outDeps = ['- 없음'],
  invariants = ['- I1. 아무것도 약속하지 않는다 (근거: 없음) [리뷰]'],
  pending = [], history = ['- 2026-01-01 최초 작성'],
}) {
  return [
    '---',
    `module: ${slug}`,
    `path: ${path}`,
    'schema: 1',
    `status: ${status}`,
    ...(watch ? [`watch: ${watch}`] : []),
    '---',
    '',
    '## 책임',
    `${slug} 를 소유한다.`,
    '',
    '## 진입점',
    '- 없음',
    '',
    '## 의존',
    '### in (이 모듈이 쓰는 것)',
    ...inDeps,
    '### out (이 모듈을 쓰는 것)',
    ...outDeps,
    '',
    '## 불변식',
    ...invariants,
    '',
    '## 미결',
    ...pending,
    '',
    '## 이력',
    ...history,
    '',
  ].join('\n');
}

function write(dir, rel, text) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

// 모듈 하나 = MODULE.md + 어댑터. 어댑터가 없으면 R9 가 울어 다른 규칙의 판정이 묻힌다.
// at 은 파일을 실제로 놓을 자리 — frontmatter 의 path 와 어긋나게 둘 때만 쓴다 (R0)
function putModule(dir, opts, at = opts.path) {
  const where = at === '.' ? '' : at;
  write(dir, join(where, 'MODULE.md'), moduleDoc(opts));
  write(dir, join(where, 'CLAUDE.md'), '@MODULE.md\n');
}

function newRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'module-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
  git('init -q');
  git('config user.email gate@test');
  git('config user.name gate');
  git('config commit.gpgsign false');
  return { dir, git, commit: () => { git('add -A'); git('commit -q -m fixture'); } };
}

function gate(dir, ...args) {
  try {
    return { code: 0, out: execFileSync('node', [GATE, ...args], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// "WARN alpha R3" 같은 줄이 있는지
const has = (out, level, slug, rule) =>
  out.split('\n').some((l) => l.startsWith(level) && l.includes(` ${slug} `) && l.includes(` ${rule}  `));

// alpha 와 beta 를 서로 올바르게 물린 상태로 세운다
function twoModules(t, { alphaStatus = 'draft' } = {}) {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', status: alphaStatus, outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'] });
  putModule(r.dir, { slug: 'beta', path: 'beta', inDeps: ['- [[alpha]] — alpha 를 쓴다'] });
  write(r.dir, 'alpha/a.cs', 'class A {}\n');
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  return r;
}

// ---------- 테스트 ----------

test('깨끗한 트리는 OK 를 찍고 0 으로 끝난다', (t) => {
  const r = twoModules(t);
  const { code, out } = gate(r.dir);
  assert.equal(code, 0);
  assert.match(out, /module-gate: OK/);
});

test('R0 path 가 실제 위치와 다르면 draft 여도 FAIL', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'elsewhere' }, 'alpha');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1);
  assert.ok(has(out, 'FAIL', 'alpha', 'R0'), out);
});

test('R1 소스만 고치면 운다 — active 는 FAIL, draft 는 WARN', (t) => {
  for (const [status, level, code] of [['active', 'FAIL', 1], ['draft', 'WARN', 0]]) {
    const r = twoModules(t, { alphaStatus: status });
    write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
    const got = gate(r.dir);
    assert.equal(got.code, code, `${status}: ${got.out}`);
    assert.ok(has(got.out, level, 'alpha', 'R1'), `${status}: ${got.out}`);
  }
});

test('R1 은 계약서를 같은 변경에 넣으면 조용해진다', (t) => {
  const r = twoModules(t, { alphaStatus: 'active' });
  write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha', status: 'active',
    outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'],
    history: ['- 2026-01-01 최초 작성', '- 2026-01-02 x 를 더한다'],
  });
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!has(out, 'FAIL', 'alpha', 'R1'), out);
});

test('R2 계약 섹션을 고치고 이력을 안 늘리면 운다', (t) => {
  const r = twoModules(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'],
    invariants: ['- I1. 새 약속을 한다 (근거: 없음) [리뷰]'],
  });
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R2'), out);
});

test('R3 한쪽에만 적은 의존은 대칭 경고', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', outDeps: ['- [[beta]] — 한쪽만 적었다'] });
  putModule(r.dir, { slug: 'beta', path: 'beta' });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
  assert.match(out, /beta\.in 에 \[\[alpha\]\] 없음/);
});

test('R3 모듈 후보 — 미결이 이미 적어 뒀으면 침묵, 아니면 경고', (t) => {
  // 미결에 없음 → 운다
  const bare = newRepo(t);
  putModule(bare.dir, { slug: 'alpha', path: 'alpha', inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'] });
  bare.commit();
  const before = gate(bare.dir).out;
  assert.ok(has(before, 'WARN', 'alpha', 'R3'), before);

  // 미결이 경로로 적어 뒀으면 침묵 — 표기(`ghost/`)와 슬러그(ghost)가 달라도 마지막 조각으로 만난다
  const named = newRepo(t);
  putModule(named.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'],
    pending: ['- 모듈 후보: `sub/ghost/` (MODULE.md 없음)'],
  });
  named.commit();
  const after = gate(named.dir);
  assert.equal(after.code, 0, after.out);
  assert.match(after.out, /module-gate: OK/);
});

test('R3 침묵은 "모듈" 을 말하는 줄에만 적용된다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'],
    // 경로는 있지만 모듈 후보로 적은 줄이 아니다
    pending: ['- 불변식 후보: `sub/ghost/` 의 산출물을 아무도 검증하지 않는다'],
  });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
});

test('R6 근거가 다른 모듈 소유이면 in 쪽에 적혀 있어도 조용하다', (t) => {
  // in 에 있음 → 침묵 (방향이 맞는지는 R3 이 본다)
  const ok = newRepo(t);
  putModule(ok.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다'],
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(ok.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다'] });
  write(ok.dir, 'beta/b.cs', 'class B {}\n');
  ok.commit();
  const silent = gate(ok.dir);
  assert.equal(silent.code, 0, silent.out);
  assert.ok(!has(silent.out, 'WARN', 'alpha', 'R6'), silent.out);

  // 어느 쪽에도 없음 → 운다
  const bad = newRepo(t);
  putModule(bad.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(bad.dir, { slug: 'beta', path: 'beta' });
  write(bad.dir, 'beta/b.cs', 'class B {}\n');
  bad.commit();
  const loud = gate(bad.dir).out;
  assert.ok(has(loud, 'WARN', 'alpha', 'R6'), loud);
});

test('R6 부모-자식은 양방향으로 면제된다', (t) => {
  // 스키마가 부모-자식 in/out 링크를 금하므로, 면제가 한 방향이면 조용해질 길이 없다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'parent', path: 'proj',
    invariants: ['- I1. 자식 파일에 기댄다 (근거: proj/child/c.cs:1) [grep]'],
  });
  putModule(r.dir, {
    slug: 'child', path: 'proj/child',
    invariants: ['- I1. 부모 파일에 기댄다 (근거: proj/p.cs:1) [grep]'],
  });
  write(r.dir, 'proj/p.cs', 'class P {}\n');
  write(r.dir, 'proj/child/c.cs', 'class C {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!/R6/.test(out), out);
});

test('R11 근거 파일이 바뀌면 그 파일을 소유하지 않은 모듈도 운다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다'],
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(r.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다'] });
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  write(r.dir, 'beta/b.cs', 'class B { int y; }\n');
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R11'), out);   // 소유 밖 — R1 이 못 보는 자리
  assert.ok(has(out, 'WARN', 'beta', 'R1'), out);     // 소유 안 — R1 이 보는 자리
});

test('--staged 는 인덱스만 본다', (t) => {
  const r = twoModules(t, { alphaStatus: 'active' });
  write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
  assert.equal(gate(r.dir).code, 1);                  // 작업 트리 모드는 본다
  assert.equal(gate(r.dir, '--staged').code, 0);      // 스테이지 전이면 커밋에 안 들어간다
  r.git('add alpha/a.cs');
  assert.equal(gate(r.dir, '--staged').code, 1);      // 스테이지하면 본다
});

test('R12 는 어디로도 해석되지 않는 근거 경로를 경고한다', (t) => {
  // 해석 실패는 "리포 루트 기준이 아님" 과 다른 사고다 — 정정할 곳이 없고, 그 파일을
  // R11 도 추적하지 못한다. 침묵하면 틀린 경로가 계약서에 그대로 눌러앉는다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 없는 파일에 기댄다 (근거: nowhere/missing.cs:12) [grep]'],
  });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R12'), out);
  assert.match(out, /해석되지 않/);
});

test('R12 는 해석되지만 기준이 다른 경로와 해석 실패를 구분해 말한다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 제 파일에 기댄다 (근거: a.cs:1) [grep]'],   // alpha/a.cs 로 해석된다
  });
  write(r.dir, 'alpha/a.cs', 'class A {}\n');
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R12'), out);
  assert.match(out, /리포 루트 기준이 아님/);
  assert.ok(!/해석되지 않/.test(out), out);
});
