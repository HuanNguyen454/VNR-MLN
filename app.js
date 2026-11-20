(function () {
  const DATA = { VNR202: window.VNR202, MLN131: window.MLN131 };
  const NAMES = { VNR202: 'VNR202 · Lịch sử Đảng Cộng sản Việt Nam', MLN131: 'MLN131 · Chủ nghĩa xã hội khoa học' };
  const CHUNK = 50;
  const $ = (id) => document.getElementById(id);

  // ---------- storage (an toàn khi bị chặn) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- theme ----------
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  $('themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; store.set('theme', t);
  };

  // ---------- chuẩn bị dữ liệu ----------
  for (const k in DATA) {
    const d = DATA[k];
    d.cards.forEach((c) => { c.id = c.g + '-' + c.n; });
    // nhóm hiển thị: Phần I lớn -> chia nhỏ 50 câu
    d.views = [{ label: 'Tất cả (' + d.cards.length + ' câu)', filter: () => true }];
    d.groups.forEach((g, gi) => {
      const list = d.cards.filter((c) => c.g === gi);
      const partName = 'Phần ' + g.part.replace(/^PHẦN ([IVX]+)\..*$/, '$1');
      if (!g.chap) {
        d.views.push({ label: partName + ' · toàn bộ (' + list.length + ' câu)', filter: (c) => c.g === gi });
        for (let i = 0; i < list.length; i += CHUNK) {
          const a = list[i].n, b = list[Math.min(i + CHUNK, list.length) - 1].n;
          d.views.push({ label: ' ' + partName + ' · Câu ' + a + '–' + b, filter: (c) => c.g === gi && c.n >= a && c.n <= b });
        }
      } else {
        d.views.push({ label: partName + ' · ' + g.chap + ' (' + list.length + ')', filter: (c) => c.g === gi });
      }
    });
    const m = $('meta' + k);
    if (m) m.textContent = d.cards.length + ' câu hỏi trắc nghiệm';
  }

  // ---------- state ----------
  let subj = null, deck = [], pos = 0, flipped = false, marks = {};
  let quizSel = new Set(), quizDone = false;
  // Lưu toàn bộ trạng thái học (bộ lọc, chế độ, thứ tự xáo trộn, câu đang xem) để tải lại trang vẫn học tiếp đúng chỗ
  let shuffled = false;
  const prefs = () => Object.assign({ view: 0, filter: 'all', mode: 'flash', search: '', order: null, cur: null, pos: 0 },
    store.get('prefs-' + subj, {}));
  function savePrefs() {
    if (!subj) return;
    store.set('prefs-' + subj, {
      view: +$('groupSel').value, filter: $('filterSel').value, mode: $('modeSel').value,
      search: $('searchBox').value,
      order: shuffled ? deck.map((c) => c.id) : null,
      cur: deck[pos] ? deck[pos].id : null, pos: pos
    });
    store.set('lastSubj', subj);
  }

  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    document.querySelectorAll('.top nav a').forEach((a) => a.classList.toggle('active', a.dataset.subj === h));
    if (!DATA[h]) { $('home').hidden = false; $('study').hidden = true; subj = null; return; }
    subj = h; $('home').hidden = true; $('study').hidden = false;
    $('subjTitle').textContent = NAMES[h];
    marks = store.get('marks-' + subj, {});
    const d = DATA[subj];
    $('groupSel').innerHTML = d.views.map((v, i) => '<option value="' + i + '">' + esc(v.label) + '</option>').join('');
    const p = prefs();
    $('groupSel').value = Math.min(p.view, d.views.length - 1);
    $('filterSel').value = p.filter; $('modeSel').value = p.mode;
    $('searchBox').value = p.search || '';
    build(false, p);
  }

  function build(shuffle, restore) {
    const d = DATA[subj];
    const view = d.views[+$('groupSel').value] || d.views[0];
    const f = $('filterSel').value;
    const q = norm($('searchBox').value.trim());
    deck = d.cards.filter((c) => {
      if (!view.filter(c)) return false;
      const m = marks[c.id];
      if (f === 'known' && m !== 1) return false;
      if (f === 'unknown' && m !== 0) return false;
      if (f === 'new' && m !== undefined) return false;
      if (q && !norm(c.q + ' ' + c.o.map((o) => o[1]).join(' ')).includes(q)) return false;
      return true;
    });
    pos = 0;
    if (shuffle) {
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      shuffled = true;
    } else if (restore) {
      shuffled = false;
      if (restore.order) {
        const idx = {}; restore.order.forEach((id, i) => { idx[id] = i; });
        deck.sort((a, b) => (idx[a.id] ?? 1e9) - (idx[b.id] ?? 1e9));
        shuffled = true;
      }
      const i = restore.cur ? deck.findIndex((c) => c.id === restore.cur) : -1;
      pos = i >= 0 ? i : Math.max(0, Math.min(restore.pos || 0, deck.length - 1));
    } else {
      shuffled = false;
    }
    render();
  }

  function render() {
    flipped = false; quizSel = new Set(); quizDone = false;
    const area = $('cardArea');
    updateStats();
    savePrefs();
    if (!deck.length) {
      area.innerHTML = '<div class="empty">Không có thẻ nào phù hợp với bộ lọc hiện tại.</div>';
      $('pos').textContent = '0 / 0'; return;
    }
    const c = deck[pos];
    $('pos').textContent = (pos + 1) + ' / ' + deck.length;
    const g = DATA[subj].groups[c.g];
    const tag = esc((g.chap || 'Phần ' + g.part.replace(/^PHẦN ([IVX]+)\..*$/, '$1')) + ' · Câu ' + c.n);
    const m = marks[c.id];
    const st = m === 1 ? '<span class="status known">Đã thuộc</span>' : m === 0 ? '<span class="status unknown">Chưa thuộc</span>' : '';
    const multi = c.a.length > 1 ? '<div class="multi">(Chọn ' + c.a.length + ' đáp án)</div>' : '';

    if ($('modeSel').value === 'flash') {
      const opts = c.o.map((o) => '<li><b>' + o[0] + '.</b>' + esc(o[1]) + '</li>').join('');
      const backOpts = c.o.map((o) => '<li class="' + (c.a.includes(o[0]) ? 'right' : 'dim') + '"><b>' + o[0] + '.</b>' + esc(o[1]) + '</li>').join('');
      area.innerHTML =
        '<div class="card" id="card"><div class="card-inner">' +
        '<div class="face front"><span class="tag">' + tag + '</span>' + st + '<p class="q">' + esc(c.q) + '</p>' + multi + '<ul class="opts">' + opts + '</ul></div>' +
        '<div class="face back"><span class="tag">' + tag + '</span>' + st + '<div class="ans-label">Đáp án: ' + c.a.join(', ') + '</div><p class="q">' + esc(c.q) + '</p><ul class="opts">' + backOpts + '</ul>' +
        (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') + '</div>' +
        '</div></div><div class="flip-hint">Bấm vào thẻ hoặc nhấn Space để lật</div>';
      $('card').onclick = flip;
    } else {
      const opts = c.o.map((o) => '<li data-k="' + o[0] + '"><b>' + o[0] + '.</b>' + esc(o[1]) + '</li>').join('');
      area.innerHTML = '<div class="quiz" id="quiz"><span class="tag">' + tag + '</span>' + st + '<p class="q">' + esc(c.q) + '</p>' + multi +
        '<ul class="opts">' + opts + '</ul>' +
        (c.a.length > 1 ? '<button class="check" id="checkBtn">Kiểm tra</button>' : '') +
        '<div id="result"></div></div>';
      area.querySelectorAll('.opts li').forEach((li) => { li.onclick = () => pick(li.dataset.k); });
      if ($('checkBtn')) $('checkBtn').onclick = checkQuiz;
    }
  }


  function flip() { const c = $('card'); if (!c) return; flipped = !flipped; c.classList.toggle('flipped', flipped); }

  function pick(k) {
    if (quizDone) return;
    const c = deck[pos];
    if (!c.o.some((o) => o[0] === k)) return;
    if (c.a.length > 1) {
      quizSel.has(k) ? quizSel.delete(k) : quizSel.add(k);
      document.querySelectorAll('#quiz .opts li').forEach((li) => li.classList.toggle('dim', !quizSel.has(li.dataset.k) && quizSel.size > 0));
      return;
    }
    quizSel = new Set([k]); checkQuiz();
  }

  function checkQuiz() {
    const c = deck[pos]; if (quizDone || !quizSel.size) return;
    quizDone = true; $('quiz').classList.add('done');
    const ok = quizSel.size === c.a.length && c.a.every((a) => quizSel.has(a));
    document.querySelectorAll('#quiz .opts li').forEach((li) => {
      const k = li.dataset.k; li.classList.remove('dim');
      if (c.a.includes(k)) li.classList.add('right');
      else if (quizSel.has(k)) li.classList.add('wrong');
      else li.classList.add('dim');
    });
    $('result').innerHTML = '<div class="result ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓ Chính xác!' : '✗ Sai rồi. Đáp án đúng: ' + c.a.join(', ')) + '</div>' +
      (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '');
    setMark(ok ? 1 : 0, false);
  }

  function setMark(v, advance) {
    if (!deck.length) return;
    const c = deck[pos]; marks[c.id] = v; store.set('marks-' + subj, marks);
    updateStats();
    if (advance) go(1);
  }

  function go(d) { if (!deck.length) return; pos = (pos + d + deck.length) % deck.length; render(); }

  function updateStats() {
    const all = DATA[subj].cards;
    let k = 0, u = 0;
    all.forEach((c) => { if (marks[c.id] === 1) k++; else if (marks[c.id] === 0) u++; });
    let dk = 0; deck.forEach((c) => { if (marks[c.id] === 1) dk++; });
    $('progBar').style.width = (deck.length ? (dk / deck.length) * 100 : 0) + '%';
    $('stats').textContent = 'Bộ hiện tại: đã thuộc ' + dk + '/' + deck.length + ' · Toàn môn: ' + k + ' đã thuộc, ' + u + ' chưa thuộc, ' + (all.length - k - u) + ' chưa học';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }

  // ---------- events ----------
  $('groupSel').onchange = () => { savePrefs(); build(false); };
  $('filterSel').onchange = () => { savePrefs(); build(false); };
  $('modeSel').onchange = () => { savePrefs(); render(); };
  let t; $('searchBox').oninput = () => { clearTimeout(t); t = setTimeout(() => build(false), 200); };
  $('shuffleBtn').onclick = () => build(true);
  $('resetBtn').onclick = () => { if (confirm('Xóa toàn bộ tiến độ của môn ' + subj + '?')) { marks = {}; store.set('marks-' + subj, marks); build(false); } };
  $('prevBtn').onclick = () => go(-1);
  $('nextBtn').onclick = () => go(1);
  $('goodBtn').onclick = () => setMark(1, true);
  $('badBtn').onclick = () => setMark(0, true);

  document.addEventListener('keydown', (e) => {
    if (!subj || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight') go(1);
    else if (k === 'ArrowLeft') go(-1);
    else if (k === ' ' && $('modeSel').value === 'flash') { e.preventDefault(); flip(); }
    else if (k === '1') setMark(0, true);
    else if (k === '2') setMark(1, true);
    else if (k === 'Enter' && $('modeSel').value === 'quiz') { if (quizDone) go(1); else checkQuiz(); }
    else if (/^[a-fA-F]$/.test(k) && $('modeSel').value === 'quiz') pick(k.toUpperCase());
  });

  window.addEventListener('hashchange', route);
  // Mở trang không kèm môn -> tự vào lại môn học gần nhất
  const last = store.get('lastSubj', null);
  if (!location.hash && DATA[last]) history.replaceState(null, '', '#' + last);
  route();
})();
