// iCalendar (.ics) 生成
import { CATEGORIES, DOW_ICS, addDays, dow, pad, parseYmd, displayTitle } from './util.js';
import { presentationDates, ruleActiveOn } from './occur.js';

const TZ = 'Asia/Tokyo';
const UID_DOMAIN = 'yotei.pwa';
const DURATION_MIN = 60; // 時刻あり予定の長さ（既定1時間）

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tokyo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const d8 = (s) => s.replace(/-/g, '');
const hm6 = (t) => t.replace(':', '') + '00';
const hmMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function escText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 75オクテットで折り返し（UTF-8の文字境界を守る） */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', len = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > limit) { parts.push(cur); cur = ''; len = 0; limit = 74; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** 分 → iCalendar の期間表記（負なら前） */
export function fmtDuration(min) {
  const sign = min < 0 ? '-' : '';
  let a = Math.abs(min);
  const D = Math.floor(a / 1440); a -= D * 1440;
  const H = Math.floor(a / 60); const M = a - H * 60;
  let s = 'P' + (D ? D + 'D' : '');
  if (H || M || !D) s += 'T' + (H ? H + 'H' : '') + (M || !H ? M + 'M' : '');
  return sign + s;
}

/** 予定ごとの通知オフセット（分, 予定開始からの相対）。通知なしなら null */
export function alarmOffset(item, settings) {
  const cat = CATEGORIES[item.category];
  if (!cat || cat.notify === 'never') return null;
  if (cat.notify === 'optional' && !item.notify) return null;
  if (item.category === '誕生日') {
    // 終日予定は当日0:00が基準。前日23:55 → -5分
    return hmMin(settings.bdayTime) - settings.bdayDaysBefore * 1440;
  }
  if (item.time) return -settings.timedMinutesBefore;
  return hmMin(settings.allDayTime) - settings.allDayDaysBefore * 1440;
}

function endOf(date, time) {
  const d = parseYmd(date);
  d.setMinutes(hmMin(time) + DURATION_MIN);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function stampNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function dtLines(date, time) {
  if (!time) {
    return [`DTSTART;VALUE=DATE:${d8(date)}`, `DTEND;VALUE=DATE:${d8(addDays(date, 1))}`];
  }
  const e = endOf(date, time);
  return [`DTSTART;TZID=${TZ}:${d8(date)}T${hm6(time)}`, `DTEND;TZID=${TZ}:${d8(e.date)}T${hm6(e.time)}`];
}

function alarmLines(item, settings, title) {
  const off = alarmOffset(item, settings);
  if (off === null) return [];
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(title)}`, `TRIGGER:${fmtDuration(off)}`, 'END:VALARM'];
}

function veventSingle(item, settings, stamp) {
  const title = displayTitle(item);
  const time = CATEGORIES[item.category]?.allDayOnly ? null : item.time;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${item.uid}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${item.rev || 0}`,
    `SUMMARY:${escText(title)}`,
    `CATEGORIES:${escText(item.category)}`,
    ...dtLines(item.date, time),
  ];
  if (item.category === '誕生日') lines.push('RRULE:FREQ=YEARLY', 'TRANSP:TRANSPARENT');
  lines.push(...alarmLines({ ...item, time }, settings, title), 'END:VEVENT');
  return lines;
}

function veventWeekly(rule, settings, stamp, pres) {
  if (!rule.days.length) return [];
  // DTSTART は最初の該当曜日にそろえる
  let first = rule.start;
  for (let i = 0; i < 7 && !rule.days.includes(dow(first)); i++) first = addDays(first, 1);
  if (rule.end && first > rule.end) return [];
  const title = displayTitle(rule);
  const time = CATEGORIES[rule.category]?.allDayOnly ? null : rule.time;
  const byday = [...rule.days].sort().map((d) => DOW_ICS[d]).join(',');
  let rr = `RRULE:FREQ=WEEKLY;BYDAY=${byday}`;
  if (rule.end) {
    // 時刻ありは UTC で指定（終了日 23:59:59 JST = 14:59:59Z）
    rr += time ? `;UNTIL=${d8(rule.end)}T145959Z` : `;UNTIL=${d8(rule.end)}`;
  }
  const ex = new Set((rule.skips || []).filter((d) => ruleActiveOn(rule, d)));
  if (rule.category === 'ゼミ') for (const d of pres) if (ruleActiveOn(rule, d)) ex.add(d);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${rule.uid}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${rule.rev || 0}`,
    `SUMMARY:${escText(title)}`,
    `CATEGORIES:${escText(rule.category)}`,
    ...dtLines(first, time),
    rr,
  ];
  for (const d of [...ex].sort()) {
    lines.push(time ? `EXDATE;TZID=${TZ}:${d8(d)}T${hm6(time)}` : `EXDATE;VALUE=DATE:${d8(d)}`);
  }
  lines.push(...alarmLines({ ...rule, time }, settings, title), 'END:VEVENT');
  return lines;
}

/**
 * items: 書き出す予定, allItems: ゼミ発表の判定用に全予定
 */
export function buildIcs(items, allItems, settings) {
  const stamp = stampNow();
  const pres = presentationDates(allItems);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yotei-pwa//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
  ];
  for (const it of items) {
    if (it.type === 'single') lines.push(...veventSingle(it, settings, stamp));
    else if (it.type === 'weekly') lines.push(...veventWeekly(it, settings, stamp, pres));
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
