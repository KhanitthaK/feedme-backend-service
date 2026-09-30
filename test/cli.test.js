'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { timestamp } = require('../src/cli');

test('CLI accepts commands and prints timestamped queue status', () => {
  const cli = path.join(__dirname, '..', 'src', 'cli.js');
  const result = spawnSync(process.execPath, [cli], {
    input: 'normal\nvip\nstatus\n+\n-\nstatus\nquit\n',
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PENDING: #2 VIP, #1 NORMAL/);
  assert.match(result.stdout, /VIP order #2 returned to PENDING/);
  assert.match(result.stdout, /PROCESSING: \(none\)/);
  assert.ok(result.stdout.trim().split('\n').every((line) => /^\[\d{2}:\d{2}:\d{2}\] /.test(line)));
});

test('timestamps use HH:MM:SS UTC', () => {
  assert.equal(timestamp(Date.UTC(2026, 0, 1, 1, 2, 3)), '01:02:03');
});
