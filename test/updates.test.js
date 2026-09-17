'use strict';
/**
 * The update check.
 *
 * Only the pure parts: comparing two versions, and deciding what a GitHub
 * release payload means. The fetch itself is not worth a test - it is a
 * dozen lines around https.get whose only interesting behaviour, being offline,
 * is already "say nothing and carry on".
 */

const assert = require('assert');
const { compareVersions, parseRelease } = require('../src/main/updates');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('updates');

test('versions compare numerically, not as text', () => {
  // The case a string compare gets wrong, and the reason this is not one line.
  assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1);
  assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1);
  assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
  assert.strictEqual(compareVersions('1.2.3', '1.2.4'), -1);
});

test('a leading v and a missing patch part are tolerated', () => {
  assert.strictEqual(compareVersions('v2.1', '2.1.0'), 0);
  assert.strictEqual(compareVersions('V2.2', '2.1.9'), 1);
});

test('a pre-release suffix is ignored rather than parsed', () => {
  assert.strictEqual(compareVersions('2.0.0-beta.1', '2.0.0'), 0);
});

test('nonsense compares as zero rather than throwing', () => {
  assert.strictEqual(compareVersions('', ''), 0);
  assert.strictEqual(compareVersions(undefined, '1.0.0'), -1);
});

test('a newer tag is offered, with its release page', () => {
  const res = parseRelease({ tag_name: 'v2.1.0', html_url: 'https://example.invalid/r/2.1.0' }, '2.0.0');
  assert.strictEqual(res.available, true);
  assert.strictEqual(res.version, '2.1.0');
  assert.strictEqual(res.url, 'https://example.invalid/r/2.1.0');
});

test('the same or an older tag is not an update', () => {
  assert.strictEqual(parseRelease({ tag_name: 'v2.0.0' }, '2.0.0').available, false);
  assert.strictEqual(parseRelease({ tag_name: 'v1.3.0' }, '2.0.0').available, false);
});

test('a release with no tag is ignored rather than treated as version zero', () => {
  assert.strictEqual(parseRelease({}, '2.0.0').available, false);
});

test('a release without an html_url still offers the releases page', () => {
  assert.match(parseRelease({ tag_name: '9.9.9' }, '2.0.0').url, /^https:\/\/github\.com\//);
});

console.log(`\n${passed} passed`);
