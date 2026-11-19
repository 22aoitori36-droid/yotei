import {
  CATEGORIES, SINGLE_CATS, WEEKLY_CATS, DOW_JA, DEFAULT_SETTINGS,
  ymd, parseYmd, addDays, today, uid, displayTitle, fmtDate, daysLabel, esc, normHm,
} from './util.js';
import { db } from './db.js';
import { occurrences, byDate, zemiRuleOn, ruleActiveOn } from './occur.js';
import { buildIcs } from './ics.js';
import { parseImport, buildBackup, IMPORT_SAMPLE } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const now = new Date();
const S = {
  items: [],
  settings: { ...DEFAULT_SETTINGS },
  view: 'month',
  y: now.getFullYear(),
  m: now.getMonth(),
  sel: today(),
  persisted: null,
};
const col = (cat) => CATEGORIES[cat]?.color || '#888';
const byUid = (u) => S.items.find((i) => i.uid === u);

// ---------- 起動 ----------
async function init() {
  S.items = await db.all();
  const st = await db.getKv('settings');
  if (st) Object.assign(S.settings, st);
  bindGlobal();
  render();
  // データを消えにくくする（描画を待たせない）
  if (navigator.storage?.persist) {
    navigator.storage.persisted()
      .then((p) => p || navigator.storage.persist())
      .then((p) => { S.persisted = p; if (S.view === 'settings') render(); })
      .catch(() => {});
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function reload() {
  S.items = await db.all();
  render();
}

// ---------- 共通UI ----------
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.tid);
  toast.tid = setTimeout(() => { t.hidden = true; }, ms);
}

function openSheet(title, html, handlers = {}) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sh-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="閉じる">✕</button></div>${html}`;
  sh.onclick = (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    handlers.click?.(e);
  };
  sh.oninput = handlers.input || null;
  sh.onchange = handlers.change || null;
  $('#backdrop').hidden = false;
  sh.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#backdrop').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
}

function setMonthTo(date) {
  const d = parseYmd(date);
  S.y = d.getFullYear();
  S.m = d.getMonth();
  S.sel = date;
}
function shiftMonth(n) {
  const d = new Date(S.y, S.m + n, 1);
  S.y = d.getFullYear();
  S.m = d.getMonth();
  const t = today();
  S.sel = t.startsWith(`${S.y}-${String(S.m + 1).padStart(2, '0')}`) ? t : ymd(d);
  render();
}

function bindGlobal() {
  $('#prev').onclick = () => shiftMonth(-1);
  $('#next').onclick = () => shiftMonth(1);
  $('#goToday').onclick = () => { setMonthTo(today()); render(); };
  $('#tabs').onclick = (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    S.view = b.dataset.view;
    render();
    window.scrollTo(0, 0);
    if (S.view === 'list') document.getElementById('list-today')?.scrollIntoView({ block: 'start' });
  };
  $('#fab').onclick = () => (S.view === 'rules' ? openRuleForm({}) : openCategoryPicker(S.sel));
  $('#backdrop').onclick = (e) => { if (e.target.id === 'backdrop') closeSheet(); };
  $('#view').onclick = onViewClick;
  $('#view').onchange = onViewChange;

  // 月表示の左右スワイプ
  let sx = 0, sy = 0;
  $('#view').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#view').addEventListener('touchend', (e) => {
    if (S.view !== 'month' && S.view !== 'list') return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- 描画 ----------
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  const top = $('#top');
  const monthly = S.view === 'month' || S.view === 'list';
  top.classList.toggle('plain', !monthly);
  $('#title').textContent = monthly ? `${S.y}年${S.m + 1}月` : S.view === 'rules' ? '毎週ルール' : '設定';
  $('#fab').hidden = S.view === 'settings';
  const v = $('#view');
  if (S.view === 'month') v.innerHTML = monthHtml();
  else if (S.view === 'list') v.innerHTML = listHtml();
  else if (S.view === 'rules') v.innerHTML = rulesHtml();
  else v.innerHTML = settingsHtml();
}

function monthRange() {
  const first = new Date(S.y, S.m, 1);
  const days = new Date(S.y, S.m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + days) / 7);
  const start = addDays(ymd(first), -first.getDay());
  return { start, end: addDays(start, weeks * 7 - 1) };
}

const visible = (o) => !o.hidden && !o.skipped;

function monthHtml() {
  const { start, end } = monthRange();
  const map = byDate(occurrences(S.items, start, end));
  const t = today();
  const mPrefix = `${S.y}-${String(S.m + 1).padStart(2, '0')}`;
  let cells = '';
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const occs = (map.get(d) || []).filter(visible);
    const pres = occs.some((o) => o.item.category === 'ゼミ発表');
    const wd = parseYmd(d).getDay();
    const cls = ['cell',
      d.startsWith(mPrefix) ? '' : 'out', wd === 0 ? 'sun' : wd === 6 ? 'sat' : '',
      d === t ? 'today' : '', d === S.sel ? 'sel' : '', pres ? 'pres' : ''].filter(Boolean).join(' ');
    const dots = occs.slice(0, 6).map((o) => `<i class="dot" style="background:${col(o.item.category)}"></i>`).join('');
    cells += `<button class="${cls}" data-date="${d}"><span class="num">${parseYmd(d).getDate()}</span>${pres ? '<span class="star">★</span>' : ''}<span class="dots">${dots}</span></button>`;
  }
  const legend = Object.keys(CATEGORIES).map((c) => `<span style="--c:${col(c)}">${c === 'ゼミ発表' ? '★' : ''}${c}</span>`).join('');
  return `<div class="dow-row">${DOW_JA.map((w) => `<div>${w}</div>`).join('')}</div>
    <div class="grid">${cells}</div>
    <div class="legend">${legend}</div>
    ${dayHtml(S.sel)}`;
}

function occHtml(o, showSkip = true) {
  const it = o.item;
  const cls = ['occ', o.skipped ? 'skipped' : '', it.category === 'ゼミ発表' ? 'pres' : ''].join(' ');
  const sub = o.kind === 'weekly' ? `毎週${o.skipped ? '・休み' : ''}` : o.kind === 'yearly' ? '毎年' : '';
  const bell = (it.type === 'single' && (it.notify || it.category === '誕生日')) ? ' 🔔' : '';
  return `<button class="${cls}" style="--c:${col(it.category)}" data-occ="${esc(it.uid)}" data-date="${o.date}">
    <span class="t">${o.time || '終日'}</span>
    <span class="n">${esc(displayTitle(it))}${bell}</span>
    <span class="c">${[displayTitle(it) !== it.category ? esc(it.category) : '', sub].filter(Boolean).join('<br>')}</span></button>`;
}

function dayHtml(date) {
  const occs = occurrences(S.items, date, date).filter((o) => !o.hidden);
  const list = occs.length ? occs.map((o) => occHtml(o)).join('') : '<div class="empty">予定なし</div>';
  const quick = SINGLE_CATS.map((c) => `<button style="--c:${col(c)}" data-quick="${c}">${c}</button>`).join('');
  return `<section class="day"><h2>${fmtDate(date)}</h2>${list}
    <div class="quick">${quick}<button style="--c:#999" data-quick="__weekly">毎週ルール</button></div></section>`;
}

function listHtml() {
  const first = `${S.y}-${String(S.m + 1).padStart(2, '0')}-01`;
  const last = ymd(new Date(S.y, S.m + 1, 0));
  const map = byDate(occurrences(S.items, first, last).filter(visible));
  if (!map.size) return '<div class="empty">この月の予定はありません</div>';
  const t = today();
  let html = '';
  for (const [d, occs] of map) {
    html += `<div class="lgroup ${d === t ? 'today' : ''}" ${d === t ? 'id="list-today"' : ''}><h3>${fmtDate(d)}${d === t ? '（今日）' : ''}</h3>${occs.map((o) => occHtml(o)).join('')}</div>`;
  }
  return html;
}

function ruleDesc(r) {
  const time = r.time || '終日';
  const period = `${fmtDate(r.start, true)} 〜 ${r.end ? fmtDate(r.end, true) : '終了日なし'}`;
  const sk = (r.skips || []).length ? `<br>休み ${r.skips.length}日` : '';
  return `毎週 ${daysLabel(r.days)}・${time}<br>${period}${sk}`;
}

function rulesHtml() {
  const rules = S.items.filter((i) => i.type === 'weekly')
    .sort((a, b) => a.category.localeCompare(b.category) || b.start.localeCompare(a.start));
  const t = today();
  const card = (r) => `<div class="rule ${r.end && r.end < t ? 'ended' : ''}" style="--c:${col(r.category)}">
      <div class="rn">${esc(displayTitle(r))}</div>
      <div class="rd">${ruleDesc(r)}</div>
      <div class="rb">
        <button class="btn small" data-redit="${esc(r.uid)}">編集</button>
        <button class="btn small" data-rdup="${esc(r.uid)}">複製</button>
      </div></div>`;
  const active = rules.filter((r) => !r.end || r.end >= t);
  const ended = rules.filter((r) => r.end && r.end < t);
  return `<button class="btn primary" data-act="new-rule" style="margin-top:4px">＋ 毎週ルールを追加</button>
    <h2 class="sec">有効なルール</h2>${active.map(card).join('') || '<div class="empty">なし</div>'}
    ${ended.length ? `<h2 class="sec">終了したルール</h2>${ended.map(card).join('')}` : ''}
    <p class="note">前期・後期で曜日が変わるときは「複製」→ 曜日と開始日を変えて保存。元のルールには自動で終了日が入り、過去の予定は残ります。</p>`;
}

function daysBeforeOpts(sel, list = [0, 1, 2, 3, 7]) {
  return list.map((n) => `<option value="${n}" ${n === +sel ? 'selected' : ''}>${n === 0 ? '当日' : n === 1 ? '前日' : n + '日前'}</option>`).join('');
}

function settingsHtml() {
  const st = S.settings;
  const mins = [0, 5, 10, 15, 30, 60, 120, 180, 1440];
  const minOpts = mins.map((n) => `<option value="${n}" ${n === +st.timedMinutesBefore ? 'selected' : ''}>${n === 0 ? '開始時刻' : n < 60 ? n + '分前' : n < 1440 ? n / 60 + '時間前' : '1日前'}</option>`).join('');
  const singles = S.items.filter((i) => i.type === 'single').length;
  const rules = S.items.length - singles;
  const pers = S.persisted === true ? '有効（消えにくい設定）' : S.persisted === false ? '未許可（ホーム画面から開くと許可されやすくなります）' : '非対応';
  return `
  <h2 class="sec">通知の時刻</h2>
  <div class="field"><span class="lbl">誕生日（毎年）</span>
    <div class="inline"><select data-set="bdayDaysBefore">${daysBeforeOpts(st.bdayDaysBefore)}</select>
    <input type="time" data-set="bdayTime" value="${st.bdayTime}"></div></div>
  <div class="field"><span class="lbl">時刻ありの予定（通知オンのもの）</span>
    <select data-set="timedMinutesBefore">${minOpts}</select></div>
  <div class="field"><span class="lbl">終日の予定（通知オンのもの）</span>
    <div class="inline"><select data-set="allDayDaysBefore">${daysBeforeOpts(st.allDayDaysBefore)}</select>
    <input type="time" data-set="allDayTime" value="${st.allDayTime}"></div></div>
  <p class="note">通知はiPhoneの標準カレンダーに登録した予定から届きます。設定を変えたら、もう一度カレンダーへ書き出してください（同じ予定は上書きされます）。バイト・ゼミは通知なし。</p>

  <h2 class="sec">iPhoneのカレンダーに登録</h2>
  <button class="btn primary" data-act="ics-share">📅 全予定をカレンダーへ（共有）</button>
  <button class="btn" data-act="ics-dl">.ics をダウンロード</button>
  <p class="note">共有シートで「カレンダー」を選ぶか、ダウンロードした .ics を開いて「すべてを追加」。予定ごとにUIDが付いているので、何度登録しても同じ予定は重複しません。</p>

  <h2 class="sec">バックアップ</h2>
  <button class="btn" data-act="json-share">JSONで書き出す</button>
  <button class="btn" data-act="import">JSONを読み込む（貼り付け）</button>

  <h2 class="sec">データ</h2>
  <div class="card note" style="margin:0">保存先: この端末のみ（IndexedDB）<br>データ保護: ${pers}<br>単発 ${singles}件 / 毎週ルール ${rules}件</div>`;
}

// ---------- 画面のクリック ----------
function onViewClick(e) {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.classList.contains('cell')) {
    const d = el.dataset.date;
    if (el.classList.contains('out')) setMonthTo(d); else S.sel = d;
    render();
    return;
  }
  if (el.dataset.occ) return onOccTap(el.dataset.occ, el.dataset.date);
  if (el.dataset.quick) {
    if (el.dataset.quick === '__weekly') return openRuleForm({ start: S.sel });
    return openSingleForm({ category: el.dataset.quick, date: S.sel });
  }
  if (el.dataset.redit) return openRuleForm({ rule: byUid(el.dataset.redit) });
  if (el.dataset.rdup) return openRuleForm({ dupFrom: byUid(el.dataset.rdup) });
  const act = el.dataset.act;
  if (act === 'new-rule') openRuleForm({});
  else if (act === 'ics-share') exportIcs(S.items, 'yotei.ics', true);
  else if (act === 'ics-dl') exportIcs(S.items, 'yotei.ics', false);
  else if (act === 'json-share') exportJson();
  else if (act === 'import') openImport();
}

async function onViewChange(e) {
  const k = e.target.dataset.set;
  if (!k) return;
  let v = e.target.value;
  if (k.endsWith('Time')) { v = normHm(v); if (!v) return; } else v = Number(v);
  S.settings[k] = v;
  await db.setKv('settings', S.settings);
  toast('通知設定を保存しました');
}

function onOccTap(u, date) {
  const it = byUid(u);
  if (!it) return;
  if (it.type === 'single') return openSingleForm({ item: it });
  // 毎週ルールの1日分
  const skipped = (it.skips || []).includes(date);
  openSheet(`${displayTitle(it)}　${fmtDate(date)}`, `
    <div class="card note" style="margin:0 0 12px">${ruleDesc(it)}</div>
    <button class="btn ${skipped ? '' : 'danger'}" data-a="skip">${skipped ? '休みを取り消す' : 'この日だけ休みにする'}</button>
    <button class="btn" data-a="extra">この日に臨時の${esc(it.category)}を追加</button>
    <button class="btn" data-a="edit">ルールを編集</button>`, {
    click: async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'skip') {
        const skips = new Set(it.skips || []);
        skipped ? skips.delete(date) : skips.add(date);
        await db.put({ ...it, skips: [...skips].sort(), rev: (it.rev || 0) + 1, updatedAt: Date.now() });
        closeSheet();
        toast(skipped ? '休みを取り消しました' : 'この日を休みにしました');
        reload();
      } else if (a === 'edit') openRuleForm({ rule: it });
      else if (a === 'extra') openSingleForm({ category: it.category, date: addDays(date, 0), time: it.time });
    },
  });
}

// ---------- カテゴリ選択 ----------
function openCategoryPicker(date) {
  const btns = SINGLE_CATS.map((c) => `<button style="--c:${col(c)}" data-c="${c}">${c === 'ゼミ発表' ? '★ ' : ''}${c}</button>`).join('');
  openSheet('何の予定？', `<div class="catgrid">${btns}<button class="wide" style="--c:#999" data-c="__weekly">🔁 毎週ルール（バイト・ゼミ）</button></div>`, {
    click: (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      if (c === '__weekly') openRuleForm({ start: date });
      else openSingleForm({ category: c, date });
    },
  });
}

// ---------- 単発フォーム ----------
function openSingleForm({ item, category, date, time }) {
  const isEdit = !!item;
  const f = item ? { ...item } : {
    uid: uid(), type: 'single', category, title: '', date: date || today(),
    time: time ?? null, notify: false,
  };
  f.timeTouched = isEdit;
  if (!isEdit && f.category === 'ゼミ発表') inheritZemi(f);

  const draw = () => {
    const cat = CATEGORIES[f.category];
    const chips = SINGLE_CATS.map((c) => `<button class="chip ${c === f.category ? 'on' : ''}" style="--c:${col(c)}" data-cat="${c}">${c}</button>`).join('');
    let timeField = '';
    if (!cat.allDayOnly) {
      let hint = '';
      if (f.category === 'ゼミ発表') {
        const zr = zemiRuleOn(S.items, f.date);
        hint = zr
          ? `<div class="hint">この日の通常ゼミ（${zr.time || '終日'}）の時刻を引き継ぎます。通常ゼミは自動で非表示になります。</div>`
          : '<div class="hint warn">この日は通常ゼミのルールがありません。時刻は手入力できます。</div>';
      }
      timeField = `<div class="field"><label>時刻（空なら終日）</label>
        <div class="inline"><input type="time" id="f-time" value="${f.time || ''}"><button class="clear" data-a="allday">終日</button></div>${hint}</div>`;
    }
    let notifyField = '';
    if (cat.notify === 'optional') {
      notifyField = `<div class="field switch"><span>通知</span><input type="checkbox" id="f-notify" ${f.notify ? 'checked' : ''}></div>`;
    } else if (cat.notify === 'always') {
      const st = S.settings;
      const when = `${st.bdayDaysBefore == 0 ? '当日' : st.bdayDaysBefore == 1 ? '前日' : st.bdayDaysBefore + '日前'}の${st.bdayTime}`;
      notifyField = `<p class="note">毎年くり返し・${when}に通知（設定で変更可）</p>`;
    } else {
      notifyField = `<p class="note">${f.category}は${cat.allDayOnly ? '終日・' : ''}通知なし</p>`;
    }
    const html = `
      <div class="field"><span class="lbl">カテゴリ</span><div class="chips">${chips}</div></div>
      <div class="field"><label>${f.category === '誕生日' ? '日付（毎年この日）' : '日付'}</label><input type="date" id="f-date" value="${f.date}" required></div>
      ${timeField}
      <div class="field"><label>タイトル（任意）</label><input type="text" id="f-title" value="${esc(f.title)}" placeholder="${esc(f.category)}" enterkeyhint="done"></div>
      ${notifyField}
      <button class="btn primary" data-a="save">保存</button>
      ${isEdit ? `<button class="btn" data-a="ics">📅 この予定をカレンダーへ</button><button class="btn danger" data-a="del">削除</button>` : ''}`;
    openSheet(isEdit ? '予定を編集' : '予定を追加', html, { click, input, change: input });
  };

  const input = (e) => {
    const id = e.target.id;
    if (id === 'f-title') f.title = e.target.value;
    else if (id === 'f-notify') f.notify = e.target.checked;
    else if (id === 'f-time') { f.time = normHm(e.target.value); f.timeTouched = true; }
    else if (id === 'f-date' && e.target.value) {
      const changed = f.date !== e.target.value;
      f.date = e.target.value;
      if (changed && f.category === 'ゼミ発表') {
        if (!f.timeTouched) inheritZemi(f);
        draw();
      }
    }
  };

  const click = async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      f.category = chip.dataset.cat;
      if (f.category === 'ゼミ発表' && !f.timeTouched) inheritZemi(f);
      draw();
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'allday') { f.time = null; f.timeTouched = true; draw(); }
    else if (a === 'save') {
      const d = $('#f-date').value;
      if (!d) return toast('日付を選んでください');
      f.date = d;
      await saveSingle(f, item);
      closeSheet();
      setMonthTo(f.date);
      toast(isEdit ? '保存しました' : `${fmtDate(f.date)} に追加しました`);
      reload();
    } else if (a === 'del') {
      if (!confirm(`「${displayTitle(item)}」を削除しますか？`)) return;
      await db.del(item.uid);
      if (item.category === 'ゼミ発表') await db.putMany(bumpZemi([item.date]));
      closeSheet();
      toast('削除しました（iPhoneカレンダーに登録済みなら、そちらでも削除してください）', 3500);
      reload();
    } else if (a === 'ics') {
      exportIcs([item], `${displayTitle(item)}.ics`, true);
    }
  };
  draw();
}

function inheritZemi(f) {
  const zr = zemiRuleOn(S.items, f.date);
  f.time = zr?.time || null;
}

/** ゼミ発表の追加・移動で EXDATE が変わるゼミのルールの SEQUENCE を上げる */
function bumpZemi(dates) {
  return S.items.filter((r) => r.type === 'weekly' && r.category === 'ゼミ' && dates.some((d) => d && ruleActiveOn(r, d)))
    .map((r) => ({ ...r, rev: (r.rev || 0) + 1, updatedAt: Date.now() }));
}

async function saveSingle(f, old) {
  const cat = CATEGORIES[f.category];
  const rec = {
    uid: f.uid, type: 'single', category: f.category, title: (f.title || '').trim(), date: f.date,
    time: cat.allDayOnly ? null : (f.time || null),
    notify: cat.notify === 'always' ? true : cat.notify === 'never' ? false : !!f.notify,
    rev: old ? (old.rev || 0) + 1 : 0,
    updatedAt: Date.now(),
  };
  const touched = [];
  if (rec.category === 'ゼミ発表') touched.push(rec.date);
  if (old?.category === 'ゼミ発表' && old.date !== rec.date) touched.push(old.date);
  if (old?.category === 'ゼミ発表' && rec.category !== 'ゼミ発表') touched.push(old.date);
  await db.putMany([rec, ...bumpZemi(touched)]);
}

// ---------- 毎週ルールフォーム ----------
function openRuleForm({ rule, dupFrom, start }) {
  const isEdit = !!rule;
  const t = today();
  let f;
  if (rule) f = { ...rule, days: [...rule.days], skips: [...(rule.skips || [])] };
  else if (dupFrom) {
    f = {
      ...dupFrom, uid: uid(), days: [...dupFrom.days], skips: [], rev: 0,
      start: dupFrom.end ? addDays(dupFrom.end, 1) : (t > dupFrom.start ? t : addDays(dupFrom.start, 1)),
      end: null,
    };
    f.endOld = true;
  } else {
    f = { uid: uid(), type: 'weekly', category: 'バイト', title: '', days: [], time: null, start: start || t, end: null, skips: [] };
  }

  const draw = () => {
    const cat = CATEGORIES[f.category];
    const chips = WEEKLY_CATS.map((c) => `<button class="chip ${c === f.category ? 'on' : ''}" style="--c:${col(c)}" data-cat="${c}">${c}</button>`).join('');
    const days = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="chip ${f.days.includes(d) ? 'on' : ''}" data-day="${d}">${DOW_JA[d]}</button>`).join('');
    const timeField = cat.allDayOnly
      ? `<p class="note">${f.category}は終日・通知なし</p>`
      : `<div class="field"><label>時刻（空なら終日）</label>
          <div class="inline"><input type="time" id="r-time" value="${f.time || ''}"><button class="clear" data-a="allday">終日</button></div>
          <div class="hint">通知なし</div></div>`;
    const dupNote = dupFrom ? `<div class="field switch"><span style="font-size:15px">元のルールを開始日の前日で終了する<br><small style="color:var(--sub)">（${esc(daysLabel(dupFrom.days))}・${fmtDate(dupFrom.start, true)}〜）過去の予定は残ります</small></span><input type="checkbox" id="r-endold" ${f.endOld ? 'checked' : ''}></div>` : '';
    const skips = isEdit && f.skips.length
      ? `<div class="field"><span class="lbl">休みの日（タップで取り消し）</span><div class="skiplist">${f.skips.map((d) => `<button data-unskip="${d}">${fmtDate(d)} ✕</button>`).join('')}</div></div>`
      : '';
    const html = `
      <div class="field"><span class="lbl">種類</span><div class="chips">${chips}</div></div>
      <div class="field"><span class="lbl">曜日（複数選べます）</span><div class="days">${days}</div></div>
      ${timeField}
      <div class="field"><label>開始日</label><input type="date" id="r-start" value="${f.start}"></div>
      <div class="field"><label>終了日（任意）</label>
        <div class="inline"><input type="date" id="r-end" value="${f.end || ''}"><button class="clear" data-a="noend">なし</button></div></div>
      <div class="field"><label>タイトル（任意）</label><input type="text" id="r-title" value="${esc(f.title)}" placeholder="${esc(f.category)}"></div>
      ${dupNote}${skips}
      <button class="btn primary" data-a="save">保存</button>
      ${isEdit ? `<div class="row2" style="margin-top:8px"><button class="btn" data-a="dup">複製</button><button class="btn" data-a="ics">📅 カレンダーへ</button></div>
      <button class="btn danger" data-a="del">削除</button>` : ''}`;
    openSheet(isEdit ? 'ルールを編集' : dupFrom ? 'ルールを複製' : '毎週ルールを追加', html, { click, input, change: input });
  };

  const input = (e) => {
    const id = e.target.id;
    if (id === 'r-title') f.title = e.target.value;
    else if (id === 'r-time') f.time = normHm(e.target.value);
    else if (id === 'r-start') f.start = e.target.value;
    else if (id === 'r-end') f.end = e.target.value || null;
    else if (id === 'r-endold') f.endOld = e.target.checked;
  };

  const click = async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      f.category = chip.dataset.cat;
      if (CATEGORIES[f.category].allDayOnly) f.time = null;
      return draw();
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      const d = +day.dataset.day;
      f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort();
      day.classList.toggle('on');
      return;
    }
    const un = e.target.closest('[data-unskip]');
    if (un) { f.skips = f.skips.filter((d) => d !== un.dataset.unskip); return draw(); }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'allday') { f.time = null; draw(); }
    else if (a === 'noend') { f.end = null; draw(); }
    else if (a === 'save') {
      if (!f.days.length) return toast('曜日を選んでください');
      if (!f.start) return toast('開始日を選んでください');
      if (f.end && f.end < f.start) return toast('終了日が開始日より前です');
      const rec = {
        uid: f.uid, type: 'weekly', category: f.category, title: (f.title || '').trim(),
        days: [...f.days].sort(), time: CATEGORIES[f.category].allDayOnly ? null : (f.time || null),
        start: f.start, end: f.end || null, skips: f.skips.filter((d) => d >= f.start && (!f.end || d <= f.end)),
        rev: rule ? (rule.rev || 0) + 1 : 0, updatedAt: Date.now(),
      };
      const puts = [rec];
      if (dupFrom && f.endOld) {
        const newEnd = addDays(f.start, -1);
        if (newEnd < dupFrom.start) return toast('開始日が元のルールの開始日より前です');
        if (!dupFrom.end || dupFrom.end > newEnd) {
          puts.push({ ...dupFrom, end: newEnd, skips: (dupFrom.skips || []).filter((d) => d <= newEnd), rev: (dupFrom.rev || 0) + 1, updatedAt: Date.now() });
        }
      }
      await db.putMany(puts);
      closeSheet();
      toast(puts.length > 1 ? '新しいルールを追加し、元のルールを終了しました' : '保存しました', 3000);
      reload();
    } else if (a === 'dup') openRuleForm({ dupFrom: rule });
    else if (a === 'ics') exportIcs([rule], `${displayTitle(rule)}.ics`, true);
    else if (a === 'del') {
      if (!confirm('このルールを削除すると、過去の分も含めて全部消えます。\n期間を終わらせたいだけなら「終了日」を入れてください。\n\n削除しますか？')) return;
      await db.del(rule.uid);
      closeSheet();
      toast('削除しました');
      reload();
    }
  };
  draw();
}

// ---------- 書き出し ----------
function downloadText(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function shareOrDownload(name, text, mime, preferShare) {
  if (preferShare && navigator.canShare) {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
  }
  downloadText(name, text, mime);
}

function exportIcs(items, name, share) {
  if (!items.length) return toast('予定がありません');
  const ics = buildIcs(items, S.items, S.settings);
  shareOrDownload(name.replace(/[\\/:*?"<>|]/g, '_'), ics, 'text/calendar', share);
}

function exportJson() {
  const name = `yotei-backup-${today()}.json`;
  shareOrDownload(name, buildBackup(S.items, S.settings), 'application/json', true);
}

// ---------- 読み込み ----------
function openImport() {
  const html = `
    <p class="note" style="margin-top:0">バックアップのJSONや、チャットで作った予定のJSONを貼り付けて取り込みます。既存の予定は消えません（同じUIDの予定は上書き）。</p>
    <textarea class="paste" id="imp-text" placeholder="ここにJSONを貼り付け" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
    <div class="row2" style="margin:8px 0">
      <button class="btn small" data-a="clip">📋 クリップボードから貼り付け</button>
      <button class="btn small" data-a="file">ファイルを選ぶ</button>
    </div>
    <input type="file" id="imp-file" accept=".json,application/json,text/plain" hidden>
    <button class="btn primary" data-a="go">取り込む</button>
    <div class="result card" id="imp-result" hidden></div>
    <h2 class="sec">チャットで予定を作るときの書式</h2>
    <p class="note">下の書式をチャットに渡して「この形式で予定を作って」と頼み、返ってきたJSONを上に貼り付けます。</p>
    <button class="btn" data-a="copy">書式をコピー</button>
    <pre class="sample">${esc(IMPORT_SAMPLE)}</pre>
    <p class="note">category: バイト / 誕生日 / ゼミ / ゼミ発表 / 映画 / 遊び / その他<br>
    type: "single"（単発, date必須）または "weekly"（毎週, days・start必須, endは任意）<br>
    time: "HH:MM"（省略で終日）, notify: true/false（映画・遊び・その他・ゼミ発表のみ）<br>
    ゼミ発表は時刻を省略すると、その日の通常ゼミの時刻を引き継ぎます。</p>`;
  openSheet('JSONを読み込む', html, {
    click: async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const ta = $('#imp-text');
      if (a === 'clip') {
        try {
          ta.value = await navigator.clipboard.readText();
          if (!ta.value) toast('クリップボードが空です');
        } catch {
          toast('読み取れませんでした。欄を長押しして「ペースト」してください', 3500);
          ta.focus();
        }
      } else if (a === 'file') {
        const inp = $('#imp-file');
        inp.onchange = async () => { if (inp.files[0]) ta.value = await inp.files[0].text(); };
        inp.click();
      } else if (a === 'go') {
        await doImport(ta.value);
      } else if (a === 'copy') {
        const text = `次の形式のJSONだけで予定を出力してください（説明文は不要）。\n` +
          `category は バイト/誕生日/ゼミ/ゼミ発表/映画/遊び/その他 のどれか。type は single（単発）か weekly（毎週）。` +
          `日付は YYYY-MM-DD、時刻は HH:MM（終日なら time を省略）。days は 日〜土 の漢字1文字の配列。\n\n${IMPORT_SAMPLE}`;
        try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
      }
    },
  });
}

async function doImport(text) {
  const out = $('#imp-result');
  const show = (msg) => { out.hidden = false; out.textContent = msg; };
  if (!text.trim()) return toast('JSONを貼り付けてください');
  let res;
  try { res = parseImport(text); } catch (e) { return show(e.message); }
  const { items, errors } = res;
  if (!items.length) return show(['取り込める予定がありません', ...errors].join('\n'));
  const existing = new Set(S.items.map((i) => i.uid));
  const upd = items.filter((i) => existing.has(i.uid)).length;
  const msg = `新規 ${items.length - upd}件・上書き ${upd}件を取り込みます。${errors.length ? `\n（読めなかった ${errors.length}件はスキップ）` : ''}`;
  if (!confirm(msg)) return;
  // ゼミ発表で時刻なし → 通常ゼミの時刻を引き継ぐ（取り込むルールも考慮）
  const merged = [...S.items.filter((i) => !items.some((n) => n.uid === i.uid)), ...items];
  for (const it of items) {
    if (it.type === 'single' && it.category === 'ゼミ発表' && !it.time) it.time = zemiRuleOn(merged, it.date)?.time || null;
    const old = S.items.find((o) => o.uid === it.uid);
    if (old) it.rev = Math.max(it.rev || 0, (old.rev || 0) + 1);
  }
  await db.putMany(items);
  if (res.settings && typeof res.settings === 'object' && confirm('バックアップに含まれる通知設定も読み込みますか？')) {
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (res.settings[k] != null) S.settings[k] = res.settings[k];
    await db.setKv('settings', S.settings);
  }
  await reload();
  show(`取り込みました（新規 ${items.length - upd}件・上書き ${upd}件）${errors.length ? '\n\nスキップ:\n' + errors.join('\n') : ''}`);
  toast('取り込みました');
}

init();
