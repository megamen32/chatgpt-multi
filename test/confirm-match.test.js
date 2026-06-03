const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeText, isConfirmText, isExcluded } = require('../src/lib/confirm-match.js');

test('matches English Confirm regardless of case/whitespace', () => {
  assert.equal(isConfirmText('Confirm'), true);
  assert.equal(isConfirmText('  CONFIRM  '), true);
  assert.equal(isConfirmText('confirm'), true);
});

test('matches several localized confirm words', () => {
  for (const w of ['Подтвердить', 'Bestätigen', '确认', '확인', 'ยืนยัน', 'Confirmer']) {
    assert.equal(isConfirmText(w), true, `should match ${w}`);
  }
});

test('does not match cancel/deny words', () => {
  for (const w of ['Cancel', 'Отмена', 'Deny', 'Annuler']) {
    assert.equal(isConfirmText(w), false, `should NOT match ${w}`);
  }
});

test('does not match unrelated labels', () => {
  for (const w of ['Submit', 'Send', 'Save', 'OK', 'Regenerate', '']) {
    assert.equal(isConfirmText(w), false, `should NOT match ${w}`);
  }
});

test('strips zero-width characters before matching', () => {
  assert.equal(isConfirmText('Con​firm'), true);
});

test('normalizeText lowercases, trims, NFKC-normalizes', () => {
  assert.equal(normalizeText('  ＣＯＮＦＩＲＭ '), 'confirm'); // fullwidth -> ascii via NFKC
});

test('isExcluded detects substrings', () => {
  assert.equal(isExcluded('cancel order'), true);
  assert.equal(isExcluded('confirm'), false);
});

test('matches "Allow" / "Разрешить" used by Action permission dialogs', () => {
  for (const w of ['Allow', 'Разрешить', 'разрешаю', 'Always allow', 'Autoriser', 'Erlauben', '허용']) {
    assert.equal(isConfirmText(w), true, `should match ${w}`);
  }
});
