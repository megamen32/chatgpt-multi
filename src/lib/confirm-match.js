/*
 * Pure text-matching for the auto-confirm feature: decide whether a button's
 * label means "Confirm" (in 60+ languages) and is not an exclude word like
 * "Cancel". Ported from the standalone Auto-confirm extension; kept pure so it
 * is unit-tested in Node and reused by the DOM glue.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CGPTMP = root.CGPTMP || {}).confirmMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EXCLUDE_WORDS = ['cancel', 'отмена', 'annulliere', 'cerrar', 'fermer', 'annuler', 'annulla', 'anular', 'deny', 'отклонить', 'отказ'];

  const CONFIRM_WORDS = [
    'confirm', 'podtverdit', 'potvrdi', 'confirma', 'potvrdit', 'bekræft', 'bestätigen', 'confirmer',
    'kinnita', 'vahvista', 'megerősít', 'konfirmi', 'staðfesta', 'confermare', 'patvirtinti',
    'apstiprināt', 'bekreft', 'bevestigen', 'potwierdź', 'confirmar', 'confirmă', 'potvrdiť',
    'potrdi', 'xaqiiji', 'konfirmo', 'bekräfta', 'thibitisha', 'kumpirmahin', 'onayla',
    'xác nhận', 'sahkan', 'mengesahkan', 'подтвердить', 'потвърди', 'потврди', 'підтвердити',
    'επιβεβαιώστε', 'تأكيد', 'يؤكد', 'تایید', 'تصدیق کریں', 'নিশ্চিত করুন', 'પુષ્ટિ કરો',
    'पुष्टि करें', 'ਪੁਸ਼ਟੀ ਕਰੋ', 'ಸ್ಥಿರೀಕರಿಸಿ', 'స్థిరీకరించు',
    'உறுதிப்படுத்து', 'အတည်ပြုပါ', 'ยืนยัน', '确认', '確認', '확인', 'დაადასტურეთ',
    'հաստատել', 'растау', 'баталгаажуулах', 'አረጋግጥ',
  ].map((w) => w.trim().toLowerCase());

  const CONFIRM_SET = new Set(CONFIRM_WORDS);

  function normalizeText(str) {
    if (!str) return '';
    return str
      .trim()
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[​-‍﻿]/g, '');
  }

  function isExcluded(text) {
    return EXCLUDE_WORDS.some((w) => text.includes(w));
  }

  /** Exact-label match against the confirm vocabulary, minus exclusions. */
  function isConfirmText(text) {
    const t = normalizeText(text);
    return CONFIRM_SET.has(t) && !isExcluded(t);
  }

  return { normalizeText, isConfirmText, isExcluded, CONFIRM_WORDS, EXCLUDE_WORDS };
});
