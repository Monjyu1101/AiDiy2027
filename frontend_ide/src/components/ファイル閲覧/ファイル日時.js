// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// UTCの日付文字列で比較せず、閲覧端末の年・月・日を使う。
export function fileDateInfo(mtime, now = Date.now()) {
  if (typeof mtime !== 'number' || !Number.isFinite(mtime)) return { text: '—', today: false, iso: undefined, title: '更新日時不明' };
  const date = new Date(mtime), current = new Date(now);
  if (!Number.isFinite(date.getTime())) return { text: '—', today: false, iso: undefined, title: '更新日時不明' };
  const today = date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth() && date.getDate() === current.getDate();
  const title = date.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { text: today ? '今日 ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : title, today, iso: date.toISOString(), title };
}
export function nextLocalMidnight(now = Date.now()) {
  const next = new Date(now); next.setHours(24, 0, 0, 0); return next.getTime();
}

export const timeSearchPresets = [
  ['start', '起動'], ['fifteen', '15分'], ['hour', '1時間'], ['twoHours', '2時間'],
  ['morning', '午前'], ['today', '今日'], ['afternoon', '午後'], ['clear', '解除'],
];

// プリセットは選択時の閲覧端末の日付で確定する。上限は含まない。
export function timeSearchRange(preset, startedAt, now = Date.now()) {
  if (preset === 'start') return { since: startedAt, until: null };
  const minutes = { fifteen: 15, hour: 60, twoHours: 120 }[preset];
  if (minutes) return { since: now - minutes * 60_000, until: null };
  if (['morning', 'today', 'afternoon'].includes(preset)) {
    const start = new Date(now), boundary = new Date(now);
    start.setHours(0, 0, 0, 0); boundary.setHours(12, 30, 0, 0);
    return {
      since: preset === 'afternoon' ? +boundary : +start,
      until: preset === 'morning' ? +boundary : nextLocalMidnight(now),
    };
  }
  return { since: null, until: null };
}

// datetime-localはUTCへ読み替えず、閲覧端末の日時として扱う。
export function localDateTimeInput(value) {
  if (!Number.isFinite(value)) return '';
  const date = new Date(value), pad = number => String(number).padStart(2, '0');
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function parseLocalDateTime(value, { end = false, invalid = false } = {}) {
  if (invalid) return NaN;
  if (!value) return null;
  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return NaN;
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`;
  const at = new Date(canonical).getTime();
  // 月末の繰り上がり・存在しないローカル日時を黙って別の日時にしない。
  if (localDateTimeInput(at) !== canonical) return NaN;
  // 秒までの入力なので、次秒未満を上限にしてミリ秒未満のmtimeも含める。
  return end ? at + 1000 : at;
}
export function timeRangeError(since, until) {
  if (since != null && !Number.isFinite(since)) return '開始日時を正しく入力してください。';
  if (until != null && !Number.isFinite(until)) return '終了日時を正しく入力してください。';
  if (since == null && until != null) return '開始日時を入力してください。';
  if (since != null && until != null && since >= until) return '終了日時は開始日時以降にしてください。';
  return '';
}
export function inTimeRange(mtime, since, until = null) {
  return Number.isFinite(mtime) && Number.isFinite(since)
    && (until == null || Number.isFinite(until) && since < until)
    && mtime >= since && (until == null || mtime < until);
}
