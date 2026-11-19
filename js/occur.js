// 予定データ → 日ごとの「発生」へ展開する
import { addDays, dow, parseYmd, pad } from './util.js';

/** ゼミ発表がある日付の集合 */
export function presentationDates(items) {
  return new Set(items.filter((i) => i.type === 'single' && i.category === 'ゼミ発表').map((i) => i.date));
}

export function ruleActiveOn(rule, date) {
  return date >= rule.start && (!rule.end || date <= rule.end) && rule.days.includes(dow(date));
}

/** その日の通常ゼミのルール（時刻の引き継ぎ用） */
export function zemiRuleOn(items, date) {
  const rules = items.filter((i) => i.type === 'weekly' && i.category === 'ゼミ' && ruleActiveOn(i, date));
  return rules.find((r) => !(r.skips || []).includes(date)) || rules[0] || null;
}

/**
 * from〜to（両端含む, 'YYYY-MM-DD'）の発生一覧
 * 戻り値: {date, time, item, kind:'single'|'yearly'|'weekly', skipped, hidden}
 *   skipped: 毎週ルールのスキップ日 / hidden: ゼミ発表がある日の通常ゼミ
 */
export function occurrences(items, from, to) {
  const out = [];
  const pres = presentationDates(items);
  for (const it of items) {
    if (it.type === 'single') {
      if (it.category === '誕生日') {
        const [by, bm, bd] = it.date.split('-').map(Number);
        const y0 = Math.max(by, parseYmd(from).getFullYear());
        const y1 = parseYmd(to).getFullYear();
        for (let y = y0; y <= y1; y++) {
          const d = `${y}-${pad(bm)}-${pad(bd)}`;
          // 2/29 は閏年のみ
          if (parseYmd(d).getMonth() + 1 !== bm) continue;
          if (d >= from && d <= to) out.push({ date: d, time: null, item: it, kind: 'yearly' });
        }
      } else if (it.date >= from && it.date <= to) {
        out.push({ date: it.date, time: it.time || null, item: it, kind: 'single' });
      }
    } else if (it.type === 'weekly') {
      let d = it.start > from ? it.start : from;
      const last = it.end && it.end < to ? it.end : to;
      for (; d <= last; d = addDays(d, 1)) {
        if (!it.days.includes(dow(d))) continue;
        out.push({
          date: d, time: it.time || null, item: it, kind: 'weekly',
          skipped: (it.skips || []).includes(d),
          hidden: it.category === 'ゼミ' && pres.has(d),
        });
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date)
    || (a.time ? 1 : 0) - (b.time ? 1 : 0)
    || (a.time || '').localeCompare(b.time || ''));
  return out;
}

/** 日付 → 発生配列 のマップ */
export function byDate(occs) {
  const m = new Map();
  for (const o of occs) {
    if (!m.has(o.date)) m.set(o.date, []);
    m.get(o.date).push(o);
  }
  return m;
}
