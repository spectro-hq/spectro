import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../scripts/staging-checkpoint-remote.sh', import.meta.url),
  'utf8',
);
for (const [failExport, failResume] of [
  [false, false],
  [true, false],
  [false, true],
]) {
  test(`checkpoint watchdog: exportFailure=${failExport}, resumeFailure=${failResume}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectro-checkpoint-test-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, 'staging'));
    const log = join(dir, 'calls');
    const script = join(dir, 'checkpoint.sh');
    writeFileSync(
      script,
      source
        .replaceAll('/opt/spectro-staging', join(dir, 'staging'))
        .replaceAll('/opt/spectro-checkpoints', join(dir, 'backups'))
        .replaceAll('/run/lock/spectro-checkpoint.lock', join(dir, 'lock')),
    );
    const stub = `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const name=basename(process.argv[1]),a=process.argv.slice(2),s=a.join(' ');
appendFileSync(process.env.CALL_LOG,name+' '+s+'\\n');
if(name==='id')console.log('0');
if(name==='sleep')process.exit(0);
if(name==='tar')writeFileSync(a[a.indexOf('-cf')+1],'synthetic-archive');
if(name==='timeout'){const p=spawnSync(a[1],a.slice(2),{stdio:'inherit'});process.exit(p.status??1);}
if(name==='docker'){
 if(a.includes('start')&&process.env.FAIL_RESUME==='yes')process.exit(42);
 else if(s.includes('status.js'))console.log(JSON.stringify({status:'ok',clickhouseAvailable:true,jetstream:{streamStoredMessages:0,streamBytes:0,consumerPending:0,consumerAckPending:0,lostBytes:0,consumerDeliveredSequence:3,consumerAcknowledgedSequence:3}}));
 else if(a.includes('node')){const i=a.indexOf('node');const p=spawnSync(process.execPath,a.slice(i+1),{stdio:'inherit'});process.exit(p.status??1);}
 else if(a.includes('pg_dump')&&process.env.FAIL_EXPORT==='yes')process.exit(41);
 else if(a.includes('ps'))console.log('synthetic-container');
 else if(a[0]==='inspect')console.log('false');
 else if(s.includes('system.tables'))console.log('events_v1');
 else if(a.includes('images'))console.log('[]');
 else if(s.includes('pg_dump')||s.includes('clickhouse-client')||a[0]==='run')console.log('synthetic-data');
}
`;
    for (const command of [
      'docker',
      'systemd-run',
      'systemctl',
      'flock',
      'timeout',
      'id',
      'sleep',
      'tar',
    ]) {
      writeFileSync(join(bin, command), stub, { mode: 0o700 });
    }
    const result = spawnSync(
      '/bin/bash',
      [script, '--execute', 'checkpoint-20261018T000000Z-1234abcd'],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CALL_LOG: log,
          FAIL_EXPORT: failExport ? 'yes' : 'no',
          FAIL_RESUME: failResume ? 'yes' : 'no',
        },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, failResume ? 1 : failExport ? 41 : 0, result.stderr);
    const calls = readFileSync(log, 'utf8');
    assert(calls.indexOf('systemd-run ') < calls.indexOf('stop -t 10 web api ingest'));
    assert.match(calls, /start nats processor api ingest web/);
    if (failResume) assert.doesNotMatch(calls, /systemctl stop spectro-resume-.*\.timer/);
    else assert.match(calls, /systemctl stop spectro-resume-.*\.timer/);
    const status = readFileSync(
      join(dir, 'backups/checkpoint-20261018T000000Z-1234abcd/STATUS'),
      'utf8',
    );
    assert.match(status, failExport ? /^INCOMPLETE/ : /^COMPLETE server export/);
  });
}
