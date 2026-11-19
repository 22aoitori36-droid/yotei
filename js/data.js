// JSON バックアップ / 読み込み
import { CATEGORIES, DOW_JA, DOW_ICS, isYmd, normHm, today, uid } from './util.js';

const DOW_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDays(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v.map((x) => typeof x === 'string' ? x.replace(/曜日?/g, '') : x)
    : String(v).replace(/曜日?/g, '').split(/[\s,、・/]+|(?=[日月火水木金土])/u);
  const out = new Set();
  for (let x of arr) {
    if (typeof x === 'number' && x >= 0 && x <= 6) { out.add(x); continue; }
    x = String(x).trim();
    if (!x) continue;
    if (/^[0-6]$/.test(x)) { out.add(+x); continue; }
    let i = DOW_JA.indexOf(x[0]);
    if (i < 0) i = DOW_ICS.indexOf(x.slice(0, 2).toUpperCase());
    if (i < 0) i = DOW_EN.indexOf(x.slice(0, 3).toLowerCase());
    if (i >= 0) out.add(i);
  }
  return [...out].sort();
}

/** 外部（チャット等）から来た1件を内部形式へ。失敗時は文字列で理由を投げる */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') throw '形式が不正';
  let type = raw.type;
  if (['weekly', 'rule', '毎週', '毎週ルール'].includes(type)) type = 'weekly';
  else if (['single', 'once', '単発'].includes(type)) type = 'single';
  else type = raw.days != null ? 'weekly' : 'single';

  let category = raw.category ?? raw.カテゴリ;
  if (!CATEGORIES[category]) category = 'その他';
  const cat = CATEGORIES[category];
  const title = String(raw.title ?? raw.タイトル ?? '').trim();
  let time = raw.allDay ? null : normHm(raw.time ?? raw.時刻 ?? '');
  if (cat.allDayOnly) time = null;
  const base = {
    uid: raw.uid ? String(raw.uid) : uid(),
    category, title, time,
    rev: Number.isInteger(raw.rev) ? raw.rev : 0,
    updatedAt: Date.now(),
  };

  if (type === 'weekly') {
    if (!cat.weekly) throw `「${category}」は毎週ルールにできません`;
    const days = parseDays(raw.days ?? raw.曜日);
    if (!days.length) throw '曜日がありません';
    const start = raw.start ?? raw.startDate ?? today();
    const end = raw.end ?? raw.endDate ?? null;
    if (!isYmd(start)) throw `開始日が不正: ${start}`;
    if (end != null && !isYmd(end)) throw `終了日が不正: ${end}`;
    const skips = (raw.skips || raw.skip || []).filter(isYmd);
    return { ...base, type, days, start, end: end || null, skips };
  }
  const date = raw.date ?? raw.日付;
  if (!isYmd(date)) throw `日付が不正: ${date}`;
  const notify = cat.notify === 'always' ? true : cat.notify === 'never' ? false : !!raw.notify;
  return { ...base, type, date, notify };
}

/** 貼り付けテキスト → {items, errors} */
export function parseImport(text) {
  let s = text.trim();
  // ```json ... ``` で囲まれていても読めるように
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  let data;
  try { data = JSON.parse(s); } catch (e) { throw new Error('JSONとして読めません: ' + e.message); }
  let list;
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data.items)) list = data.items;
  else if (data.events || data.rules) list = [...(data.events || []), ...(data.rules || [])];
  else list = [data];
  const items = [], errors = [];
  list.forEach((raw, i) => {
    try { items.push(normalizeItem(raw)); } catch (e) { errors.push(`${i + 1}件目: ${e}`); }
  });
  return { items, errors, settings: data && !Array.isArray(data) ? data.settings : undefined };
}

export function buildBackup(items, settings) {
  return JSON.stringify({ app: 'yotei', version: 1, exportedAt: new Date().toISOString(), settings, items }, null, 2);
}

export const IMPORT_SAMPLE = `{
  "items": [
    { "type": "single", "category": "映画", "title": "〇〇を観る", "date": "2026-12-05", "time": "18:30", "notify": true },
    { "type": "single", "category": "誕生日", "title": "母の誕生日", "date": "2026-03-14" },
    { "type": "single", "category": "ゼミ発表", "date": "2026-12-10" },
    { "type": "weekly", "category": "バイト", "days": ["月", "水", "金"], "start": "2026-12-01", "end": "2027-03-31" },
    { "type": "weekly", "category": "ゼミ", "days": ["木"], "time": "13:00", "start": "2026-10-01", "end": "2027-01-31" }
  ]
}`;
