const KEY = 'breakping_manual_restbank_v1';
const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const dateKey = (t = now()) => new Date(t).toLocaleDateString('sv-SE');
const pad = (n) => String(n).padStart(2, '0');

function fmtHM(ms) {
  const min = Math.max(0, Math.round((ms || 0) / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

function defaultState() {
  return {
    settings: { dailyRestGoal: 4, challengeDays: 21, timelineRange: '07:00-18:00' },
    days: {},
    cheques: [],
    mode: 'stopped',
    currentStartedAt: null
  };
}

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaultState(), ...saved, settings: { ...defaultState().settings, ...(saved.settings || {}) } };
  } catch {
    return defaultState();
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function day(key = dateKey()) {
  if (!state.days[key]) state.days[key] = { date: key, segments: [], events: [] };
  return state.days[key];
}

function addEvent(type) {
  day().events.push({ type, at: now() });
}

function closeSegment(end = now()) {
  if (state.mode === 'work' || state.mode === 'rest') {
    const start = state.currentStartedAt || end;
    if (end > start) day().segments.push({ type: state.mode, start, end });
  }
  state.currentStartedAt = null;
}

function startMode(mode) {
  closeSegment();
  state.mode = mode;
  state.currentStartedAt = now();
  addEvent(mode === 'work' ? 'start_work' : 'start_rest');
  save();
  render();
}

function stopSession() {
  closeSegment();
  state.mode = 'stopped';
  addEvent('stop');
  save();
  render();
}

function metricsForDay(d, live = true) {
  const segs = [...(d.segments || [])];
  if (live && d.date === dateKey() && (state.mode === 'work' || state.mode === 'rest') && state.currentStartedAt) {
    segs.push({ type: state.mode, start: state.currentStartedAt, end: now(), live: true });
  }
  let work = 0;
  let rest = 0;
  let restCount = 0;
  for (const s of segs) {
    const span = Math.max(0, s.end - s.start);
    if (s.type === 'work') work += span;
    if (s.type === 'rest') rest += span;
  }
  for (const s of d.segments || []) {
    if (s.type === 'rest') restCount += 1;
  }
  if (d.date === dateKey() && state.mode === 'rest' && state.currentStartedAt) restCount += 1;
  return { work, rest, restCount, qualified: restCount >= state.settings.dailyRestGoal, segments: segs };
}

function allQualifiedDates() {
  return Object.values(state.days)
    .filter((d) => metricsForDay(d, d.date === dateKey()).qualified)
    .map((d) => d.date)
    .sort();
}

function currentStreak() {
  let count = 0;
  const qualified = new Set(allQualifiedDates());
  const cursor = new Date(dateKey());
  while (qualified.has(cursor.toLocaleDateString('sv-SE'))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function updateCheques() {
  const target = Math.max(1, state.settings.challengeDays || 21);
  const q = allQualifiedDates().length;
  const expected = Math.floor(q / target);
  while (state.cheques.length < expected) {
    const n = state.cheques.length + 1;
    state.cheques.push({
      number: n,
      code: `BP-CHEQUE-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`,
      issuedAt: new Date().toISOString(),
      qualifiedDaysAtIssue: q,
      benefit: 'Future app annual pass / lifetime discount concept',
      status: 'available'
    });
  }
}

function parseRange(value) {
  const match = String(value || '07:00-18:00').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  const toMin = (h, m) => Number(h) * 60 + Number(m);
  if (!match) return [7 * 60, 18 * 60];
  let start = toMin(match[1], match[2]);
  let end = toMin(match[3], match[4]);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

function minOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function renderTimeline() {
  const container = $('timeline');
  const d = day();
  const m = metricsForDay(d, true);
  const [startMin, endMin] = parseRange(state.settings.timelineRange);
  const range = endMin - startMin;
  container.innerHTML = '';

  for (let t = Math.floor(startMin / 30) * 30; t <= endMin; t += 30) {
    if (t < startMin) continue;
    const left = ((t - startMin) / range) * 100;
    const tick = document.createElement('i');
    tick.className = 'tick' + (t % 60 ? ' half' : '');
    tick.style.left = `${left}%`;
    container.appendChild(tick);
    if (t % 60 === 0) {
      const label = document.createElement('span');
      label.className = 'tick-label';
      label.style.left = `${left}%`;
      label.textContent = `${pad(Math.floor((t % 1440) / 60))}:00`;
      container.appendChild(label);
    }
  }

  for (const s of m.segments) {
    let a = minOfDay(s.start);
    let b = minOfDay(s.end);
    if (b < a) b += 1440;
    const clippedA = Math.max(a, startMin);
    const clippedB = Math.min(b, endMin);
    if (clippedB <= clippedA) continue;
    const seg = document.createElement('i');
    seg.className = `seg ${s.type}`;
    seg.style.left = `${((clippedA - startMin) / range) * 100}%`;
    seg.style.width = `${Math.max(.3, ((clippedB - clippedA) / range) * 100)}%`;
    container.appendChild(seg);
  }

  for (const e of d.events || []) {
    const a = minOfDay(e.at);
    if (a < startMin || a > endMin) continue;
    const marker = document.createElement('i');
    marker.className = 'marker';
    marker.style.left = `${((a - startMin) / range) * 100}%`;
    container.appendChild(marker);
  }
  $('timeline-legend').textContent = `${state.settings.timelineRange}｜整點與半小時刻度`;
}

function renderPassbook() {
  const list = $('passbook-list');
  const days = Object.values(state.days).sort((a, b) => b.date.localeCompare(a.date));
  list.innerHTML = days.length ? '' : '<p>尚無紀錄。按「開始工作」開始建立休息存摺。</p>';
  for (const d of days) {
    const m = metricsForDay(d, d.date === dateKey());
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div><strong>${d.date}</strong><br><small>休息 ${fmtHM(m.rest)}｜工作 ${fmtHM(m.work)}</small></div><div><strong>${m.restCount}/${state.settings.dailyRestGoal}</strong><br><small>${m.qualified ? '達標日 +1' : '未達標'}</small></div>`;
    list.appendChild(row);
  }
}

function renderCheques() {
  const list = $('cheque-list');
  list.innerHTML = state.cheques.length ? '' : '<p>累積達標日後會發出 Rest Cheque。可作為未來 App 免年費 / 折抵券概念。</p>';
  for (const c of [...state.cheques].reverse()) {
    const row = document.createElement('div');
    row.className = 'row cheque';
    row.innerHTML = `<div><strong>${c.code}</strong><br><small>${new Date(c.issuedAt).toLocaleString()}｜${c.benefit}</small></div><span class="status-pill">${c.status}</span>`;
    list.appendChild(row);
  }
}

function render() {
  updateCheques();
  const d = day();
  const m = metricsForDay(d, true);
  const qualified = allQualifiedDates().length;
  const target = Math.max(1, state.settings.challengeDays || 21);
  const pct = Math.min(100, Math.round((qualified / target) * 100));

  $('qualified-days').textContent = qualified;
  $('target-days-hero').textContent = target;
  $('goal-label').textContent = `${qualified} / ${target} days`;
  $('goal-percent').textContent = `${pct}%`;
  $('goal-progress').style.width = `${pct}%`;
  $('cheque-status').textContent = state.cheques.length ? `${state.cheques.length} issued` : 'Locked';
  $('mode-label').textContent = state.mode === 'work' ? 'Working' : state.mode === 'rest' ? 'Resting' : 'Stopped';
  $('today-work').textContent = fmtHM(m.work);
  $('today-rest').textContent = fmtHM(m.rest);
  $('today-rest-count').textContent = String(m.restCount);
  $('streak-days').textContent = String(currentStreak());
  $('daily-rest-goal').value = state.settings.dailyRestGoal;
  $('challenge-days').value = state.settings.challengeDays;
  $('timeline-range').value = state.settings.timelineRange;
  $('start-work').disabled = state.mode === 'work';
  $('start-rest').disabled = state.mode === 'rest';
  $('end-rest').disabled = state.mode !== 'rest';

  renderTimeline();
  renderPassbook();
  renderCheques();
  save();
}

function exportCsv() {
  const rows = [['date','work_minutes','rest_minutes','rest_count','qualified']];
  Object.values(state.days).sort((a, b) => a.date.localeCompare(b.date)).forEach((d) => {
    const m = metricsForDay(d, d.date === dateKey());
    rows.push([d.date, Math.round(m.work / 60000), Math.round(m.rest / 60000), m.restCount, m.qualified ? 'yes' : 'no']);
  });
  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  download(csv, `breakping-passbook-${dateKey()}.csv`, 'text/csv');
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadSample() {
  const today = new Date();
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('sv-SE');
    const start = new Date(`${key}T09:00:00`).getTime();
    state.days[key] = {
      date: key,
      events: [],
      segments: [
        { type: 'work', start, end: start + 50 * 60000 },
        { type: 'rest', start: start + 50 * 60000, end: start + 55 * 60000 },
        { type: 'work', start: start + 55 * 60000, end: start + 120 * 60000 },
        { type: 'rest', start: start + 120 * 60000, end: start + 126 * 60000 },
        { type: 'rest', start: start + 180 * 60000, end: start + 186 * 60000 },
        { type: 'rest', start: start + 240 * 60000, end: start + 246 * 60000 }
      ]
    };
  }
  save();
  render();
}

$('start-work').addEventListener('click', () => startMode('work'));
$('start-rest').addEventListener('click', () => startMode('rest'));
$('end-rest').addEventListener('click', () => startMode('work'));
$('stop-session').addEventListener('click', stopSession);
$('daily-rest-goal').addEventListener('change', (e) => { state.settings.dailyRestGoal = Number(e.target.value) || 4; render(); });
$('challenge-days').addEventListener('change', (e) => { state.settings.challengeDays = Number(e.target.value) || 21; render(); });
$('timeline-range').addEventListener('change', (e) => { state.settings.timelineRange = e.target.value || '07:00-18:00'; render(); });
$('export-csv').addEventListener('click', exportCsv);
$('backup-json').addEventListener('click', () => download(JSON.stringify(state, null, 2), `breakping-backup-${dateKey()}.json`, 'application/json'));
$('restore-json').addEventListener('click', () => $('restore-file').click());
$('restore-file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  state = JSON.parse(await f.text());
  save();
  render();
});
$('clear-data').addEventListener('click', () => {
  if (confirm('Clear all local records?')) {
    state = defaultState();
    save();
    render();
  }
});
$('sample-data').addEventListener('click', loadSample);

setInterval(render, 1000);
render();
