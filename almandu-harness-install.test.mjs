#!/usr/bin/env node
// almandu-harness-install.test.mjs — 설치 스크립트의 회귀 테스트
// 사용: npm test
//
// 이 리포의 계약서를 입력으로 쓰지 않는다 (I3). 임시 git 저장소에 fixture 를 세우고,
// 설치는 `npm pack` 으로 만든 로컬 tarball 에서 한다 — 네트워크를 쓰지 않는다.
// git·npm 설정은 전부 임시 파일로 끊는다. 사용자의 ~/.npmrc 나 전역 core.hooksPath 가
// 새어 들어오면 훅 정책 테스트가 머신마다 다른 답을 낸다 (D7).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'almandu-harness-install.sh');
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
// 놓일 커맨드 수를 디렉토리에서 센다 — 넷째가 늘어도 테스트가 따라온다 (I7 과 같은 이유)
const COMMAND_COUNT = readdirSync(join(HERE, 'commands')).filter((n) => n.endsWith('.md')).length;
assert.ok(COMMAND_COUNT > 0, 'commands/ 가 비었다 — 0 이면 아래 양성 대조가 0===0 으로 공허해진다');
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
const SKIP = platform() === 'win32' ? 'win32 에서는 돌리지 않는다' : false;

let TGZ;          // npm pack 산출물 (before 에서 한 번)
let PACK_DIR;
const NPM_MAJOR = Number(spawnSync('npm', ['-v'], { encoding: 'utf8' }).stdout.trim().split('.')[0]);

before(() => {
  if (SKIP) return;
  PACK_DIR = mkdtempSync(join(tmpdir(), 'harness-pack-'));
  const r = spawnSync('npm', ['pack', '--pack-destination', PACK_DIR], { cwd: HERE, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [name] = readdirSync(PACK_DIR).filter((n) => n.endsWith('.tgz'));
  assert.ok(name, `npm pack 산출물이 없다: ${readdirSync(PACK_DIR).join(',')}`);
  TGZ = join(PACK_DIR, name);
});

// npm test 는 사용자의 npm 설정을 npm_config_* 로 자식에 실어 보낸다. 먼저 전부 걷어낸 뒤 우리 값을 넣는다
function isolatedEnv(dir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('npm_config_')) env[k] = v;
  // 두 파일이어야 한다 — npm 12 는 같은 파일을 user 와 global 로 두 번 읽으면 설정 해석 전에 죽는다
  const userrc = join(dir, 'user.npmrc');
  const globalrc = join(dir, 'global.npmrc');
  writeFileSync(userrc, '');
  writeFileSync(globalrc, '');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '');
  return {
    ...env,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_userconfig: userrc,
    npm_config_globalconfig: globalrc,
    npm_config_cache: join(dir, 'npm-cache'),
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

function fixture(t) {
  const box = mkdtempSync(join(tmpdir(), 'harness-inst-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const env = isolatedEnv(box);
  const mk = (rel) => {
    const dir = join(box, rel);
    mkdirSync(dir, { recursive: true });
    const git = (...a) => {
      const r = spawnSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
      return r.stdout;
    };
    // --template= 로 비운다 — 개발자의 init.templateDir 이 .git/hooks 에 훅을 넣으면 정책 테스트가 갈린다
    git('init', '-q', '--template=');
    git('config', 'user.email', 'inst@test');
    git('config', 'user.name', 'inst');
    return { dir, git, write: (r, text) => { mkdirSync(dirname(join(dir, r)), { recursive: true }); writeFileSync(join(dir, r), text); } };
  };
  return { box, env, mk };
}

function run(f, dir, ...args) {
  const r = spawnSync(BASH, [SCRIPT, dir, ...args], { env: f.env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const install = (f, dir, ...args) => run(f, dir, '--spec', `file:${TGZ}`, ...args);

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const has = (dir, rel) => existsSync(join(dir, rel));
// 커맨드가 루프를 부르는 문자열을 다시 적지 않는다 — 다시 적으면 phase 7 이 GATE_CALL 을
// 공유하기 전에 갈라져 있던 자리가 테스트 쪽에 새로 생긴다 (MODULE.md 2026-09-21 이력)
const loopCall = (dir) => {
  const m = read(dir, '.claude/commands/module-work.md').match(/^node .*\/loop\/loop\.mjs"/m);
  assert.ok(m, '놓인 /module-work 가 루프를 파일 경로로 부르지 않는다');
  return m[0];
};
const localHooksPath = (f, dir) =>
  spawnSync('git', ['-C', dir, 'config', '--local', '--get', 'core.hooksPath'], { env: f.env, encoding: 'utf8' });

// 트리 전체의 파일 목록과 내용 — --dry-run 이 아무것도 쓰지 않았음을 보는 데 쓴다
function snapshot(dir, prefix = '') {
  const out = {};
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, snapshot(full, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = readFileSync(full, 'utf8');
  }
  return out;
}

// ---------- 1 ----------
test('DEFAULT_REF 는 package.json 버전과 같고, 문법이 선다', { skip: SKIP }, () => {
  const line = readFileSync(SCRIPT, 'utf8').split('\n').find((l) => l.startsWith('DEFAULT_REF='));
  assert.match(line, /^DEFAULT_REF="v[0-9.]+"$/);
  assert.equal(line, `DEFAULT_REF="v${PKG.version}"`,
    '버전을 올렸으면 같은 커밋에서 DEFAULT_REF 도 올린다 — 기본 ref 가 옛 태그를 가리키면 설치된 리포에 커맨드가 없다');
  assert.equal(spawnSync(BASH, ['-n', SCRIPT]).status, 0);
});

// ---------- 2 ----------
test('사용법 오류는 2 이고, 거부된 --ref 는 아무것도 쓰지 않는다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  assert.equal(run(f, r.dir, '--help').code, 0);
  assert.equal(spawnSync(BASH, [SCRIPT], { env: f.env, encoding: 'utf8' }).status, 2);
  assert.equal(run(f, r.dir, '--nope').code, 2);
  assert.equal(run(f, r.dir, '--ref', 'v0.8.0', '--spec', 'x').code, 2);
  // 글롭은 형식 case 를 통과한다 — 통과하면 ls-remote 가 refname 패턴으로 받아 없는 태그를 있다고 답한다.
  // 종료 코드만 보면 안 된다: 형식 거부도 2 라서, 글롭 가드를 지워도 숫자 case 가 대신 2 를 낸다.
  // 어느 가드가 잡았는지는 메시지로만 갈린다
  for (const bad of ['v0*.7*.0*', 'v0.7.?', 'v0.7.0 x', 'v[01].7.0']) {
    const got = run(f, r.dir, '--ref', bad);
    assert.equal(got.code, 2, bad);
    assert.match(got.out, /쓸 수 있는 것은 v·숫자·점뿐이다/, bad);
  }

  const before = snapshot(r.dir);
  const got = run(f, r.dir, '--ref', 'v0.6.0');
  assert.equal(got.code, 2, got.out);
  assert.match(got.out, /module-harness/);
  assert.deepEqual(snapshot(r.dir), before);
  assert.equal(r.git('status', '--porcelain'), '');
});

// ---------- 3 ----------
test('신선한 리포에 설치한다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  const got = install(f, r.dir);
  assert.equal(got.code, 0, got.out);
  const pkg = JSON.parse(read(r.dir, 'package.json'));
  assert.equal(pkg.private, true);
  assert.ok(pkg.devDependencies['almandu-harness'], got.out);
  assert.match(read(r.dir, '.npmrc'), /allow-git=root/);
  assert.match(read(r.dir, '.gitignore'), /node_modules\//);
  assert.ok(has(r.dir, 'node_modules/almandu-harness'));
  assert.match(read(r.dir, '.githooks/pre-commit'), /module-gate/);
  assert.equal(localHooksPath(f, r.dir).stdout.trim(), '.githooks');
});

// ---------- 4 ----------
test('재실행은 줄을 늘리지 않는다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  assert.equal(install(f, r.dir).code, 0);
  const pkgBefore = read(r.dir, 'package.json');
  const got = install(f, r.dir);
  assert.equal(got.code, 0, got.out);
  assert.equal(read(r.dir, '.npmrc').split('allow-git=root').length - 1, 1);
  assert.equal(read(r.dir, '.gitignore').split('node_modules/').length - 1, 1);
  assert.equal(read(r.dir, 'package.json'), pkgBefore);
});

// ---------- 5 ----------
test('hwatu 회귀: 부모에 package.json·node_modules·workspaces 가 있어도 자식에 설치된다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const parent = join(f.box, 'parent');
  mkdirSync(join(parent, 'node_modules'), { recursive: true });
  writeFileSync(join(parent, 'package.json'),
    `${JSON.stringify({ name: 'parent', private: true, workspaces: ['child'] }, null, 2)}\n`);
  const parentBytes = readFileSync(join(parent, 'package.json'));
  const r = f.mk('parent/child');
  r.git('commit', '-q', '--allow-empty', '-m', 'init');

  const got = install(f, r.dir);
  // exit 0 은 phase 7 이 훅과 같은 문자열을 sh 로 돌려 게이트가 실제로 실행된 것까지 포함한다 (D5 정정: MODULE.md 이력)
  assert.equal(got.code, 0, got.out);
  assert.ok(has(r.dir, 'node_modules/almandu-harness'));
  assert.deepEqual(readFileSync(join(parent, 'package.json')), parentBytes);
  assert.equal(existsSync(join(parent, 'node_modules/almandu-harness')), false);

  // 훅이 npm 의 해소를 쓰지 않는다는 것을 npm 버전과 무관하게 고정한다.
  // npx 를 127 로 죽는 스텁으로 가린 채 훅을 돌린다 — 옛 npx 훅이면 여기서 운다
  const stub = join(f.box, 'stub-npx');
  mkdirSync(stub, { recursive: true });
  const npxSeen = join(f.box, 'npx-seen.txt');
  writeFileSync(join(stub, 'npx'), `#!/bin/sh\nprintf 'called\\n' > "${npxSeen}"\nexit 127\n`);
  chmodSync(join(stub, 'npx'), 0o755);
  const hook = spawnSync('sh', [join(r.dir, '.githooks/pre-commit')],
    { cwd: r.dir, env: { ...f.env, PATH: `${stub}:${f.env.PATH}` }, encoding: 'utf8' });
  const hookOut = `${hook.stdout ?? ''}${hook.stderr ?? ''}`;
  assert.equal(hook.status, 0, hookOut);
  assert.equal(existsSync(npxSeen), false, `훅이 아직 npx 를 지난다: ${hookOut}`);

  // 커맨드가 적은 그 문자열이 멤버에서 npm 해소 없이 도는가 — 훅에 물은 것과 같은 질문이다.
  // 형태는 loopCall() 이 이미 고정했으므로(닫는 따옴표까지) 여기 남는 것은 cwd 질문 하나다
  mkdirSync(join(r.dir, 'sub'), { recursive: true });
  const loop = spawnSync('sh', ['-c', `${loopCall(r.dir)} scope .`],
    { cwd: join(r.dir, 'sub'), env: { ...f.env, PATH: `${stub}:${f.env.PATH}` }, encoding: 'utf8' });
  const loopOut = `${loop.stdout ?? ''}${loop.stderr ?? ''}`;
  assert.equal(loop.status, 0, loopOut);
  assert.equal(existsSync(npxSeen), false, `루프 호출이 아직 npx 를 지난다: ${loopOut}`);
});

// ---------- 6 ----------
test('--dry-run 은 아무것도 쓰지 않는다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  const before = snapshot(r.dir);
  const cfgBefore = spawnSync('git', ['-C', r.dir, 'config', '--local', '--list'], { env: f.env, encoding: 'utf8' }).stdout;
  const got = install(f, r.dir, '--dry-run');
  assert.equal(got.code, 0, got.out);
  assert.match(got.out, /DRY \+/);
  assert.deepEqual(snapshot(r.dir), before);
  assert.equal(spawnSync('git', ['-C', r.dir, 'config', '--local', '--list'], { env: f.env, encoding: 'utf8' }).stdout, cfgBefore);

  // 둘째 arm — 미리보기는 act 를 거치지 않고 init 을 진짜로 돌리는 유일한 자리다.
  // 여기서 꼬리를 빠뜨리면 계획이 거짓말을 한다: 세 줄을 보여주고 실제 실행은 아무것도 안 놓는다
  // 커맨드를 놓지 않은 채로 seed 한다 — 이미 놓여 있으면 put() 이 '이미 같다' 로 빠져서
  // 플래그를 넘기든 말든 0 줄이고, 그러면 이 arm 이 아무것도 잡지 못한다
  const s = f.mk('seeded');
  assert.equal(install(f, s.dir, '--no-commands').code, 0);
  const cmdLines = (r) => r.out.split('\n').filter((l) => l.trim().startsWith('DRY + .claude/commands/')).length;
  // 양성 대조 — 플래그가 없으면 놓을 것을 전부 보여준다. 이것이 아래 0 을 뜻 있게 만든다
  const on = install(f, s.dir, '--dry-run');
  assert.equal(cmdLines(on), COMMAND_COUNT, on.out);
  // 본 검사 — preview_init 이 --no-commands 를 넘기지 않으면 위 수가 여기 그대로 나온다
  const off = install(f, s.dir, '--dry-run', '--no-commands');
  assert.equal(cmdLines(off), 0, off.out);
});

// ---------- 7 ----------
test('전역 hooksPath 는 기본으로 가리지 않는다 (exit 3), --override-hooks 로만 가린다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const ghooks = join(f.box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  writeFileSync(join(f.box, 'gitconfig'), `[core]\n\thooksPath = ${ghooks}\n`);
  const r = f.mk('repo');

  const got = install(f, r.dir);
  assert.equal(got.code, 3, got.out);
  assert.notEqual(localHooksPath(f, r.dir).status, 0);
  assert.ok(has(r.dir, '.githooks/pre-commit'));
  // 전역 훅은 이 머신의 모든 리포에서 돈다 — 고치라고 말하지 않는다
  assert.equal(got.out.includes(`${ghooks}/pre-commit`), false, got.out);

  const over = install(f, r.dir, '--override-hooks');
  assert.equal(over.code, 0, over.out);
  assert.equal(localHooksPath(f, r.dir).stdout.trim(), '.githooks');
});

// ---------- 8 ----------
test('남의 pre-commit 이 있는 로컬 hooksPath 는 건드리지 않는다 (exit 3)', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  r.write('tools/git-hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  chmodSync(join(r.dir, 'tools/git-hooks/pre-commit'), 0o755);
  r.git('config', 'core.hooksPath', 'tools/git-hooks');
  const foreign = read(r.dir, 'tools/git-hooks/pre-commit');

  const got = install(f, r.dir);
  assert.equal(got.code, 3, got.out);
  assert.equal(localHooksPath(f, r.dir).stdout.trim(), 'tools/git-hooks');
  assert.equal(read(r.dir, 'tools/git-hooks/pre-commit'), foreign);
  assert.match(got.out, /module-gate\.mjs" --staged \|\| exit \$\?/);
});

// ---------- 9 ----------
test('pre-commit 이 없는 로컬 hooksPath 에는 init 이 채워 넣는다 (exit 0)', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  mkdirSync(join(r.dir, 'tools/git-hooks'), { recursive: true });
  r.git('config', 'core.hooksPath', 'tools/git-hooks');

  const got = install(f, r.dir);
  assert.equal(got.code, 0, got.out);
  assert.match(read(r.dir, 'tools/git-hooks/pre-commit'), /module-gate/);
  assert.equal(localHooksPath(f, r.dir).stdout.trim(), 'tools/git-hooks');
});

// ---------- 10 ----------
test('allow-git 충돌은 --yes 없이는 거부한다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const a = f.mk('a');
  a.write('.npmrc', 'allow-git=none\n');
  const got = install(f, a.dir);
  assert.equal(got.code, 1, got.out);
  assert.equal(has(a.dir, 'package.json'), false);

  const b = f.mk('b');
  b.write('.npmrc', 'allow-git=none\n');
  chmodSync(join(b.dir, '.npmrc'), 0o600);   // 토큰이 든 .npmrc 를 흉내낸다
  const yes = install(f, b.dir, '--yes');
  assert.equal(yes.code, 0, yes.out);
  assert.equal(read(b.dir, '.npmrc').split('allow-git=root').length - 1, 1);
  assert.equal(read(b.dir, '.npmrc').includes('allow-git=none'), false);
  // 제자리 쓰기라 모드가 남는다. mv 로 되돌리면 0600 이 임시 파일의 umask 기본값(보통 0644)이 된다
  assert.equal(statSync(join(b.dir, '.npmrc')).mode & 0o777, 0o600, '.npmrc 의 모드가 바뀌었다');
  assert.equal(readdirSync(b.dir).filter((n) => n.startsWith('.npmrc.almandu.')).length, 0, '임시 파일이 남았다');

  // 심링크는 거부한다 — append 도 rewrite 도 링크를 따라가므로 대상이 리포 밖이면 밖을 고친다
  const c = f.mk('link');
  const outside = join(f.box, 'outside.npmrc');
  writeFileSync(outside, 'allow-git=none\n');
  symlinkSync(outside, join(c.dir, '.npmrc'));
  const lnk = install(f, c.dir, '--yes');
  assert.equal(lnk.code, 1, lnk.out);
  assert.match(lnk.out, /심링크/);
  assert.equal(readFileSync(outside, 'utf8'), 'allow-git=none\n', '리포 밖 파일이 바뀌었다');
});

// ---------- 11 ----------
test('거부: pnpm 락, git 아님, 하네스 자신, 최상위 package.json 없는 하위 디렉토리', { skip: SKIP }, (t) => {
  const f = fixture(t);

  const p = f.mk('pnpm');
  p.write('pnpm-lock.yaml', '');
  const g1 = install(f, p.dir);
  assert.equal(g1.code, 1, g1.out);
  assert.equal(has(p.dir, 'package.json'), false);

  const plain = join(f.box, 'plain');
  mkdirSync(plain, { recursive: true });
  assert.equal(install(f, plain).code, 1);
  assert.equal(existsSync(join(plain, 'package.json')), false);

  const self = f.mk('self');
  self.write('package.json', `${JSON.stringify({ name: 'almandu-harness' }, null, 2)}\n`);
  const g2 = install(f, self.dir);
  assert.equal(g2.code, 1, g2.out);
  assert.equal(has(self.dir, 'node_modules'), false);

  const sub = f.mk('sub');
  mkdirSync(join(sub.dir, 'deep'), { recursive: true });
  const g3 = install(f, join(sub.dir, 'deep'));
  assert.equal(g3.code, 1, g3.out);
  assert.equal(has(sub.dir, 'package.json'), false);
});

// ---------- 12 ----------
test('.git/hooks 에서 돌고 있는 훅은 말없이 끄지 않는다 (exit 3)', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  const hookDir = join(r.dir, '.git/hooks');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, 'commit-msg'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(hookDir, 'commit-msg'), 0o755);
  const before = readdirSync(hookDir).sort().join(',');
  const beforeText = readFileSync(join(hookDir, 'commit-msg'), 'utf8');

  const got = install(f, r.dir);
  assert.equal(got.code, 3, got.out);
  assert.notEqual(localHooksPath(f, r.dir).status, 0);
  assert.ok(has(r.dir, '.githooks/pre-commit'));
  assert.equal(readdirSync(hookDir).sort().join(','), before);
  assert.equal(readFileSync(join(hookDir, 'commit-msg'), 'utf8'), beforeText);
  assert.match(got.out, /commit-msg/);
  assert.match(got.out, /module-gate\.mjs" --staged \|\| exit \$\?/);

  const over = install(f, r.dir, '--override-hooks');
  assert.equal(over.code, 0, over.out);
  assert.equal(localHooksPath(f, r.dir).stdout.trim(), '.githooks');
  assert.match(over.out, /commit-msg/);
});

// ---------- 13 ----------
test('전역 훅이 리포 훅을 체인하면 그 자리를 본다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const ghooks = join(f.box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  writeFileSync(join(ghooks, 'pre-commit'),
    '#!/bin/sh\nif [ -x "$PWD/.git/hooks/pre-commit" ]; then "$PWD/.git/hooks/pre-commit" || exit $?; fi\n');
  chmodSync(join(ghooks, 'pre-commit'), 0o755);
  writeFileSync(join(f.box, 'gitconfig'), `[core]\n\thooksPath = ${ghooks}\n`);

  const a = f.mk('chained');
  mkdirSync(join(a.dir, '.git/hooks'), { recursive: true });
  writeFileSync(join(a.dir, '.git/hooks/pre-commit'),
    '#!/bin/sh\nnpx --no-install almandu-module-gate --staged || exit $?\n');
  chmodSync(join(a.dir, '.git/hooks/pre-commit'), 0o755);
  const g1 = install(f, a.dir);
  assert.equal(g1.code, 0, g1.out);
  assert.notEqual(localHooksPath(f, a.dir).status, 0);
  assert.match(g1.out, /체인/);

  const b = f.mk('unchained');
  const g2 = install(f, b.dir);
  assert.equal(g2.code, 3, g2.out);
  assert.match(g2.out, /\.git\/hooks\/pre-commit/);
  assert.equal(g2.out.includes(`${ghooks}/pre-commit`), false, g2.out);
});

// ---------- 14 ----------
test('--ref 재실행은 이미 설치돼 있으면 npm 을 부르지 않는다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  assert.equal(install(f, r.dir).code, 0);
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'seed');

  // 의존 스펙만 --ref 판으로 바꾼다. node_modules 는 이미 맞는 판본이다
  const spec = `github:shanash/almandu-harness#v${PKG.version}`;
  const pkgPath = join(r.dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies['almandu-harness'] = spec;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'spec');

  // 네트워크와 설치를 모두 대역으로 막는다. ls-remote 는 늘 성공, npm install 은 로그만 남긴다
  const stub = join(f.box, 'stub');
  mkdirSync(stub, { recursive: true });
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const realNpm = spawnSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim();
  const npmLog = join(f.box, 'npm.log');
  writeFileSync(join(stub, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = ls-remote ] && exit 0; done\nexec ${realGit} "$@"\n`);
  writeFileSync(join(stub, 'npm'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = install ] && printf 'install\\n' >> "${npmLog}"; done\nexec ${realNpm} "$@"\n`);
  chmodSync(join(stub, 'git'), 0o755);
  chmodSync(join(stub, 'npm'), 0o755);

  const env = { ...f.env, PATH: `${stub}:${f.env.PATH}` };
  const got = spawnSync(BASH, [SCRIPT, r.dir, '--ref', `v${PKG.version}`], { env, encoding: 'utf8' });
  const out = `${got.stdout ?? ''}${got.stderr ?? ''}`;
  assert.equal(got.status, 0, out);
  assert.match(out, /이미 설치돼 있다/);
  assert.equal(existsSync(npmLog), false, `npm install 이 불렸다: ${existsSync(npmLog) ? readFileSync(npmLog, 'utf8') : ''}`);
});

// ---------- 15 ----------
test('allow-git 프로브가 환경변수 덮어쓰기를 잡는다', {
  skip: SKIP || (NPM_MAJOR < 12 ? `npm ${NPM_MAJOR} 에는 allow-git 이 없다` : false),
}, (t) => {
  const f = fixture(t);
  const r = f.mk('repo');
  const env = { ...f.env, npm_config_allow_git: 'none' };
  const got = spawnSync(BASH, [SCRIPT, r.dir, '--spec', `file:${TGZ}`], { env, encoding: 'utf8' });
  const out = `${got.stdout ?? ''}${got.stderr ?? ''}`;
  assert.equal(got.status, 1, out);
  assert.match(out, /npm_config_allow_git/);
  assert.equal(has(r.dir, 'node_modules'), false);
});

// ---------- 16 ----------
test('--no-config 에서도 게이트를 부르는 훅이 없으면 exit 3 이다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const a = f.mk('foreign');
  a.write('.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
  chmodSync(join(a.dir, '.githooks/pre-commit'), 0o755);
  a.git('add', '-A');
  a.git('commit', '-q', '-m', 'seed');
  const before = read(a.dir, '.githooks/pre-commit');

  const got = install(f, a.dir, '--no-config');
  assert.equal(got.code, 3, got.out);
  assert.equal(read(a.dir, '.githooks/pre-commit'), before);
  assert.match(got.out, /module-gate\.mjs" --staged \|\| exit \$\?/);

  // 이 머신의 기본 arm 이 --no-config 쪽이다. 그 arm 에서 커맨드 꼬리가 먹는지를 여기서 고정한다
  const b = f.mk('nocmd');
  const g2 = install(f, b.dir, '--no-config', '--no-commands');
  assert.equal(has(b.dir, '.claude'), false, g2.out);

  // 여섯째 경우 (3-C) — 설정은 켤 수 있는데(fresh) .githooks/pre-commit 이 이미 있고 게이트를 안 부른다.
  // 리포를 따로 세운다 — [B] 에서 이 리포에 .git/hooks/pre-commit 이 생기면 첫 arm 과 상태가 섞인다
  const sixth = f.mk('sixth');
  sixth.write('.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
  chmodSync(join(sixth.dir, '.githooks/pre-commit'), 0o755);
  sixth.git('add', '-A');
  sixth.git('commit', '-q', '-m', 'seed');
  const sixthBefore = read(sixth.dir, '.githooks/pre-commit');

  const g3 = install(f, sixth.dir);
  assert.equal(g3.code, 3, g3.out);
  assert.equal(localHooksPath(f, sixth.dir).stdout.trim(), '.githooks', '이 경우는 우리가 config 를 켠다 — test 8 은 이 값을 재지 못한다');
  assert.equal(read(sixth.dir, '.githooks/pre-commit'), sixthBefore);
  assert.match(g3.out, /\.githooks\/pre-commit/, g3.out);
  assert.match(g3.out, /module-gate\.mjs" --staged \|\| exit \$\?/, g3.out);
});

// ---------- 17 ----------
test('설치가 끝나면 /module-work 가 설 수 있다', { skip: SKIP }, (t) => {
  const f = fixture(t);

  // (A) 기본 arm — 커밋이 하나 있는 신선한 리포
  const a = f.mk('work');
  a.git('commit', '-q', '--allow-empty', '-m', 'init');
  const got = install(f, a.dir);
  assert.equal(got.code, 0, got.out);
  for (const n of ['module-work.md', 'module-review.md', 'module-draft.md'])
    assert.ok(has(a.dir, `.claude/commands/${n}`), `${n} 이 없다: ${got.out}`);
  const loopFile = 'node_modules/almandu-harness/loop/loop.mjs';
  assert.ok(read(a.dir, '.claude/commands/module-work.md').includes(loopFile));
  assert.ok(has(a.dir, loopFile), '커맨드가 가리키는 루프가 패키지에 실려 오지 않았다');
  const persona = 'node_modules/almandu-harness/review/personas/invariant-judge.md';
  assert.ok(read(a.dir, '.claude/commands/module-review.md').includes(persona));
  assert.ok(has(a.dir, persona), '커맨드가 가리키는 페르소나가 패키지에 실려 오지 않았다');
  const scope = spawnSync(BASH, ['-c', `${loopCall(a.dir)} scope .`],
    { cwd: a.dir, env: f.env, encoding: 'utf8' });
  assert.equal(scope.status, 0, `${scope.stdout}${scope.stderr}`);
  assert.match(got.out, /\/module-draft/);
  assert.match(got.out, /\/module-work/);
  assert.equal(got.out.includes('0. git add -A'), false, got.out);

  // (B) --no-commands — 별도의 신선한 fixture. A 를 재사용하면 phase 8 의 분기에 닿지 못한다
  const b = f.mk('nocmd');
  b.git('commit', '-q', '--allow-empty', '-m', 'init');
  const g2 = install(f, b.dir, '--no-commands');
  assert.equal(g2.code, 0, g2.out);
  assert.equal(has(b.dir, '.claude'), false);
  assert.match(g2.out, /commands\/\*\.md 를 \.claude\/commands\/ 로 복사한다/);

  // (C) 커밋 0 개 — 경고와 0 번, 그리고 **그 전제**를 함께 고정한다.
  // 루프에 HEAD 가드가 들어오는 날 아래 notStrictEqual 이 먼저 울어서 이 경고를 지우게 만든다
  const c = f.mk('nohead');
  const g3 = install(f, c.dir);
  assert.equal(g3.code, 0, g3.out);
  assert.match(g3.out, /커밋이 하나도 없다/);
  assert.match(g3.out, /0\. git add -A/);
  const scope0 = spawnSync(BASH, ['-c', `${loopCall(c.dir)} scope .`],
    { cwd: c.dir, env: f.env, encoding: 'utf8' });
  assert.notStrictEqual(scope0.status, 0,
    '커밋 0 개에서 loop scope 가 이제 선다 — phase 1 의 경고와 phase 8 의 0 번을 지울 때다 (DESIGN 10절)');
});

// ---------- 18 ----------
// 예행연습이 태그 확인을 건너뛰던 판에서는 없는 태그에도 "종료 코드 0 으로 예상된다" 를 냈다.
// 쓰기 전에 죽는 실패를 못 잡으면 예행연습이 진짜를 예언하지 못한다 (README 의 --dry-run 문단)
test('--dry-run 도 태그 존재를 확인한다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  // ls-remote 만 주어진 코드로 답하고 나머지는 진짜 git 에 넘긴다 — 네트워크를 쓰지 않는다
  const stubbed = (name, code) => {
    const dir = join(f.box, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = ls-remote ] && exit ${code}; done\nexec ${realGit} "$@"\n`);
    chmodSync(join(dir, 'git'), 0o755);
    return { ...f.env, PATH: `${dir}:${f.env.PATH}` };
  };
  const dry = (env, dir) => {
    const g = spawnSync(BASH, [SCRIPT, dir, '--ref', `v${PKG.version}`, '--dry-run'], { env, encoding: 'utf8' });
    return { code: g.status, out: `${g.stdout ?? ''}${g.stderr ?? ''}` };
  };

  // (A) 태그가 없으면 예행연습도 진짜와 같은 자리에서 같은 종료 코드로 멈춘다
  const a = f.mk('gone');
  const before = snapshot(a.dir);
  const g1 = dry(stubbed('stub-gone', 2), a.dir);
  assert.equal(g1.code, 1, g1.out);
  assert.match(g1.out, /태그를 찾지 못했다/);
  assert.deepEqual(snapshot(a.dir), before, '거부해도 쓰기는 없다');

  // (B) 양성 대조 — 태그가 있으면 계획 끝까지 간다. 이것이 없으면 (A) 는
  // "예행연습이 늘 실패한다" 와 구별되지 않는다
  const b = f.mk('there');
  const g2 = dry(stubbed('stub-there', 0), b.dir);
  assert.equal(g2.code, 0, g2.out);
  assert.match(g2.out, /DRY \+/);
  assert.equal(g2.out.includes('태그를 찾지 못했다'), false, g2.out);
});

// ---------- 19 ----------
test('정지 가드는 우리 git 과 npm 이 부르는 git 에 닿고, 부르는 쪽의 주입은 건드리지 않는다', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const seen = join(f.box, 'seen.txt');
  // ls-remote 가 받은 GIT_CONFIG_* 환경만 적고 성공으로 답한다 — 네트워크를 쓰지 않는다
  const dir = join(f.box, 'stub-env');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'git'),
    '#!/bin/sh\nfor a in "$@"; do\n'
    + `  if [ "$a" = ls-remote ]; then\n`
    + `    printf '%s|%s=%s|%s=%s\\n' "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" "$GIT_CONFIG_KEY_1" "$GIT_CONFIG_VALUE_1" > "${seen}"\n`
    + '    exit 0\n  fi\ndone\n'
    + `exec ${realGit} "$@"\n`);
  chmodSync(join(dir, 'git'), 0o755);

  const dry = (env, d) =>
    spawnSync(BASH, [SCRIPT, d, '--ref', `v${PKG.version}`, '--dry-run'], { env, encoding: 'utf8' });

  // (A) 가드가 없으면 멈춘 연결이 끊기지 않는다 — 우리 ls-remote 가 실제로 그 값을 받는다
  const a = f.mk('guard');
  const g1 = dry({ ...f.env, PATH: `${dir}:${f.env.PATH}` }, a.dir);
  assert.equal(g1.status, 0, `${g1.stdout ?? ''}${g1.stderr ?? ''}`);
  assert.equal(readFileSync(seen, 'utf8').trim(),
    '2|http.lowSpeedLimit=1|http.lowSpeedTime=60');

  // (B) 부르는 쪽이 이미 GIT_CONFIG_COUNT 로 자기 설정을 주입하고 있으면 덮지 않는다.
  // 덮으면 그쪽 설정이 조용히 사라진다 — 가드를 건너뛰는 것이 그 대가다
  const b = f.mk('injected');
  const g2 = dry({
    ...f.env,
    PATH: `${dir}:${f.env.PATH}`,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'caller',
  }, b.dir);
  assert.equal(g2.status, 0, `${g2.stdout ?? ''}${g2.stderr ?? ''}`);
  assert.equal(readFileSync(seen, 'utf8').trim(), '1|user.name=caller|=');

  // (C) 가드가 실제로 막으려는 자리는 npm 이 git 의존을 받으려고 부르는 git 이다 — `--ref` 실사용 경로다.
  // 상속이 일반론이 아니라 이 머신에서 참인지를 여기서 고정한다. 우리 호출과 npm 의 호출은
  // `refs/tags/…` 인자로 가른다: 우리 것은 통과시키고, npm 의 것이 받은 환경만 적고 실패시킨다
  const npmSeen = join(f.box, 'npm-seen.txt');
  const dir2 = join(f.box, 'stub-npm');
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir2, 'git'),
    '#!/bin/sh\n'
    + 'for a in "$@"; do case "$a" in refs/tags/*) exit 0 ;; esac; done\n'
    + 'for a in "$@"; do\n'
    + '  if [ "$a" = ls-remote ]; then\n'
    + `    printf '%s=%s|%s=%s\\n' "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" "$GIT_CONFIG_KEY_1" "$GIT_CONFIG_VALUE_1" > "${npmSeen}"\n`
    + '    exit 128\n  fi\ndone\n'
    + `exec ${realGit} "$@"\n`);
  chmodSync(join(dir2, 'git'), 0o755);

  const c = f.mk('npmgit');
  const g3 = spawnSync(BASH, [SCRIPT, c.dir, '--ref', `v${PKG.version}`],
    { env: { ...f.env, PATH: `${dir2}:${f.env.PATH}` }, encoding: 'utf8' });
  const out3 = `${g3.stdout ?? ''}${g3.stderr ?? ''}`;
  assert.equal(g3.status, 1, out3);
  assert.match(out3, /npm install 이 실패했다/);
  assert.equal(existsSync(npmSeen), true, `npm 이 git 을 부르지 않았다: ${out3}`);
  assert.equal(readFileSync(npmSeen, 'utf8').trim(),
    'http.lowSpeedLimit=1|http.lowSpeedTime=60');
});

// ---------- 20 ----------
// 같은 명령이 두 파일에 산다 — init 이 훅 본문을 쓰고(원본), 스크립트가 phase 7 에서 돌리고
// phase 8 에서 붙여 넣을 줄로 낸다. 갈라지면 스크립트의 검사가 훅과 다른 것을 증명하게 된다 (I6·I7 과 같은 이유)
test('훅 본문과 스크립트의 게이트 호출은 한 문자열이다', { skip: SKIP }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-tie-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['-C', dir, 'init', '-q', '--template=']);
  const got = spawnSync('node', [join(HERE, 'module-harness-init.mjs'), '--no-config', '--no-commands'],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(got.status, 0, `${got.stdout}${got.stderr}`);
  const hookLines = readFileSync(join(dir, '.githooks/pre-commit'), 'utf8').split('\n');
  const execLine = hookLines.find((l) => l.startsWith('exec '));
  assert.ok(execLine, '훅 본문에 exec 줄이 없다');
  const call = execLine.slice(5).replace(' --staged', '');
  const script = readFileSync(SCRIPT, 'utf8');
  assert.equal(script.split(call).length - 1, 1,
    `스크립트에 훅의 호출 문자열 사본이 ${script.split(call).length - 1} 개다 — 하나(GATE_CALL)여야 한다`);
  assert.ok(script.includes(`GATE_CALL='${call}'`), `GATE_CALL 이 훅 본문과 다르다: ${call}`);
  assert.match(script, /_line="\$GATE_CALL --staged \|\| exit \\\$\?"/);
  assert.match(script, /sh -c "\$GATE_CALL --scope \."/);
});

// ---------- 21 ----------
// 체인 배선의 양성 대조 — 전역 훅이 리포 훅을 체인해도, 오늘의 install 은 그 자리에 아무것도
// 얹지 않아 3 으로 끝나고 위반 커밋은 통과한다. [B] 가 이 단언을 뒤집는다
test('전역 훅이 체인해도 오늘의 install 은 배선하지 않는다 — 위반 커밋이 통과한다 (양성 대조)', { skip: SKIP }, (t) => {
  const f = fixture(t);
  const ghooks = join(f.box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  writeFileSync(join(ghooks, 'pre-commit'),
    '#!/bin/sh\necho global-hook-ran\n'
    + 'if [ -x "$PWD/.git/hooks/pre-commit" ]; then "$PWD/.git/hooks/pre-commit"; exit $?; fi\n');
  chmodSync(join(ghooks, 'pre-commit'), 0o755);
  writeFileSync(join(f.box, 'gitconfig'), `[core]\n\thooksPath = ${ghooks}\n`);

  const r = f.mk('chain-target');
  const got = install(f, r.dir);
  assert.equal(got.code, 3, got.out);
  assert.equal(has(r.dir, '.git/hooks/pre-commit'), false,
    '이 arm 은 훅이 없는 상태를 본다 — 있으면 LC 가 그것을 부른다는 뜻이라 대조가 다른 것을 잰다');

  // R0 를 어기는 MODULE.md 를 심고 스테이지한다 — 게이트가 돌았다면 이 커밋은 막혔을 것이다
  r.write('MODULE.md',
    ['---', 'module: bad', 'path: elsewhere', 'schema: 1', 'status: draft', '---', '', '## 책임', 'x', ''].join('\n'));
  r.git('add', '-A');
  const commit = spawnSync('git', ['commit', '-q', '-m', 'violate'], { cwd: r.dir, env: f.env, encoding: 'utf8' });
  const commitOut = `${commit.stdout ?? ''}${commit.stderr ?? ''}`;
  // [B] 가 이 단언을 뒤집는다 — 전역 훅이 체인하는 자리에 init 이 게이트를 얹으면 이 커밋은 막힌다
  assert.equal(commit.status, 0, commitOut);
  assert.match(commitOut, /global-hook-ran/, '전역 훅이 돌지 않았다 — 대조 자체가 무의미하다');
});
