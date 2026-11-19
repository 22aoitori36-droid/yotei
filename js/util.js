// 日付・カテゴリなどの共通ヘルパー

export const CATEGORIES = {
  'バイト':   { color: '#2e9d5b', mark: '●', allDayOnly: true,  timed: false, notify: 'never',  weekly: true },
  '誕生日':   { color: '#e0508a', mark: '🎂', allDayOnly: true,  timed: false, notify: 'always', yearly: true },
  'ゼミ':     { color: '#2f6fd6', mark: '●', allDayOnly: false, timed: true,  notify: 'never',  weekly: true },
  'ゼミ発表': { color: '#e8410c', mark: '★', allDayOnly: false, timed: true,  notify: 'optional' },
  '映画':     { color: '#8a4fd0', mark: '●', allDayOnly: false, timed: false, notify: 'optional' },
  '遊び':     { color: '#f0a020', mark: '●', allDayOnly: false, timed: false, notify: 'optional' },
  'その他':   { color: '#7a8590', mark: '●', allDayOnly: false, timed: false, notify: 'optional' },
};
// 単発追加で選べるカテゴリの並び
export const SINGLE_CATS = ['映画', '遊び', 'その他', '誕生日', 'ゼミ発表', 'バイト', 'ゼミ'];
export const WEEKLY_CATS = ['バイト', 'ゼミ'];

export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
export const DOW_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD'（ローカル時刻） */
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 'YYYY-MM-DD' -> Date（ローカル0時） */
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function dow(s) { return parseYmd(s).getDay(); }
export function today() { return ymd(new Date()); }
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s));
export const isHm = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
export function normHm(s) {
  if (!isHm(s)) return null;
  const [h, m] = s.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function uid() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Date.now().toString(36) + '-' + [...r].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function displayTitle(item) {
  return (item.title && item.title.trim()) || item.category;
}

export function fmtDate(s, withYear = false) {
  const d = parseYmd(s);
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日(${DOW_JA[d.getDay()]})`;
}

export function daysLabel(days) {
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DOW_JA[d]).join('・');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const DEFAULT_SETTINGS = {
  // 誕生日: 何日前の何時に通知するか（既定: 前日23:55）
  bdayDaysBefore: 1,
  bdayTime: '23:55',
  // 映画/遊び/その他 で通知オンのとき
  timedMinutesBefore: 30, // 時刻あり: 何分前
  allDayDaysBefore: 0,    // 終日: 何日前の
  allDayTime: '09:00',    // 何時
};
