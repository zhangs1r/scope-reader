/* Paper Echo — SCoPE 论文跟读 App */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const els = {
  list: $('#sentList'),
  bar: $('#progressBar i'),
  ptext: $('#progressText'),
  curPos: $('#curPos'),
  playAll: $('#playAllBtn'),
  speed: $('#speedBtn'),
  shuffle: $('#shuffleBtn'),
  mode: $('#modeBtn'),
  theme: $('#themeBtn'),
  prev: $('#prevBtn'),
  next: $('#nextBtn'),
  wordMask: $('#wordMask'),
  wordModal: $('#wordModal'),
  wmWord: $('#wmWord'),
  wmPhonetic: $('#wmPhonetic'),
  wmSay: $('#wmSay'),
  wmClose: $('#wmClose'),
  wmBody: $('#wmBody'),
  reviewMask: $('#reviewMask'),
  reviewModal: $('#reviewModal'),
  rvBody: $('#rvBody'),
  rvExport: $('#rvExport'),
  rvClose: $('#rvClose'),
  reviewBtn: $('#reviewBtn'),
};

let sents = [], words = [], trans = {}, notes = {}, wordMap = {};  // word -> 详解
let current = 0;          // 当前句 index
let audio = null;         // 当前 Audio
let playingId = null;     // 正在播放的句子 id
let loopId = null;        // 单句循环的句子 id
let speed = 1.0;
let recState = { mediaRecorder: null, chunks: [], blob: null, id: null };

const LS_KEY = 'paperEcho_v1';

/* ---------- 数据 ---------- */
async function loadData() {
  const [s, w, t, n] = await Promise.all([
    fetch('data/sentences.json').then(r => r.json()),
    fetch('data/words.json').then(r => r.json()),
    fetch('data/translations.json').then(r => r.json()).catch(() => []),
    fetch('data/notes.json').then(r => r.json()).catch(() => ({})),
  ]);
  sents = s;
  words = w;
  words.forEach(x => { wordMap[x.word.toLowerCase()] = x; });
  (t || []).forEach(x => { trans[x.id] = x.cn; });
  notes = n || {};
  // 单词词形变体（用于高亮匹配）
  words.forEach(x => {
    x.forms = formsOf(x.word);
  });
}

function formsOf(w) {
  const lw = w.toLowerCase();
  const forms = [lw];
  const add = (f) => { if (f.length > 2 && !forms.includes(f)) forms.push(f); };
  add(lw + 's'); add(lw + 'es');
  if (lw.endsWith('y')) add(lw.slice(0, -1) + 'ies');
  add(lw + 'ed'); add(lw + 'd'); add(lw + 'ing');
  if (lw.endsWith('e')) add(lw.slice(0, -1) + 'ing');
  return forms;
}

/* ---------- 渲染 ---------- */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(text) {
  let out = esc(text);
  for (const w of words) {
    for (const f of w.forms) {
      const re = new RegExp(`(?<![A-Za-z])${f}(?![A-Za-z])`, 'gi');
      if (re.test(out)) {
        out = out.replace(re, (m) => `<span class="tap-word" data-word="${esc(w.word)}">${m}</span>`);
        break; // 一个词只标一次（用第一个变体）
      }
    }
  }
  return out;
}

function sectionOf(id) {
  if (id <= 3) return 'I. Introduction';
  if (id <= 8) return 'A. Datasets';
  if (id <= 15) return 'B. Model Selection';
  if (id <= 20) return 'C. Prompt Design Strategy';
  if (id <= 40) return 'D. Hybrid Evaluation Metric System';
  if (id <= 45) return 'III. Results';
  return 'IV. Conclusion';
}

function render() {
  els.list.innerHTML = sents.map((s, i) => {
    const wl = s.words || [];
    return `
    <div class="sent-card" id="sent-${s.id}" data-id="${s.id}">
      <div class="sent-head">
        <span class="sent-num">#${s.id}</span>
        <span class="sent-section">${sectionOf(s.id)}</span>
      </div>
      <div class="sent-text">${highlight(s.text)}</div>
      ${trans[s.id] ? `<div class="sent-cn">${esc(trans[s.id])}</div>` : ''}
      ${notes[s.id] ? `<div class="sent-note">
        <div class="note-head"><span class="note-badge">💡 精讲</span>
          <button class="mini-btn" data-ncopy="${s.id}" title="复制讲解">⧉ 复制</button>
        </div>
        <div class="note-text">${esc(notes[s.id])}</div>
      </div>` : ''}
      ${wl.length ? `<div class="sent-words">${wl.map(w => `<span class="word-chip" data-word="${esc(w)}">${esc(w)}</span>`).join('')}</div>` : ''}
      <div class="sent-actions">
        <button class="play-btn" data-play="${s.id}">🔊 跟读</button>
        <button class="mini-btn" data-cn="${s.id}">中</button>
        <button class="mini-btn" data-rec="${s.id}">🎙 对比</button>
        <button class="mini-btn" data-loop="${s.id}">🔁 循环</button>
      </div>
      <div class="rec-compare" id="rec-${s.id}">
        <span class="lbl">🎙 你的录音：</span>
        <button class="mini-btn" data-pp="${s.id}">▶ 播放</button>
        <button class="mini-btn" data-del="${s.id}">✕ 删除</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------- 播放 ---------- */
function stopPlay() {
  if (audio) { audio.pause(); audio = null; }
  if (playingId) {
    const btn = els.list.querySelector(`.play-btn[data-play="${playingId}"]`);
    if (btn) { btn.textContent = '🔊 跟读'; btn.classList.remove('playing'); }
    playingId = null;
  }
}

function playSent(id, opts = {}) {
  stopPlay();
  playingId = id;
  const btn = els.list.querySelector(`.play-btn[data-play="${id}"]`);
  if (btn) { btn.textContent = '⏸ 播放中…'; btn.classList.add('playing'); }
  audio = new Audio(`audio/sent/s${String(id).padStart(3, '0')}.mp3`);
  audio.playbackRate = opts.rate || speed;
  audio.onended = () => {
    if (playingId === id) {
      if (loopId === id) { playSent(id, { rate: speed }); return; }
      stopPlay();
    }
  };
  audio.onerror = () => { stopPlay(); alert(`音频缺失：s${String(id).padStart(3, '0')}.mp3（还在生成中？）`); };
  audio.play().catch(() => {});
}

function playAll() {
  if (els.playAll.classList.contains('active')) {
    stopPlay(); loopId = null;
    els.playAll.classList.remove('active'); els.playAll.textContent = '▶ 连播';
    return;
  }
  els.playAll.classList.add('active'); els.playAll.textContent = '⏹ 停止';
  playFrom(current);
}

function playFrom(i) {
  if (i >= sents.length) {
    stopPlay(); loopId = null;
    els.playAll.classList.remove('active'); els.playAll.textContent = '▶ 连播';
    return;
  }
  current = i; scrollToSent();
  const id = sents[i].id;
  stopPlay();
  playingId = id;
  audio = new Audio(`audio/sent/s${String(id).padStart(3, '0')}.mp3`);
  audio.playbackRate = speed;
  audio.onended = () => {
    if (playingId === id && els.playAll.classList.contains('active')) {
      playFrom(i + 1);
    } else { stopPlay(); }
  };
  audio.play().catch(() => {});
}

/* ---------- 录音对比 ---------- */
async function toggleRec(id) {
  const btn = els.list.querySelector(`.mini-btn[data-rec="${id}"]`);
  const box = $('#rec-' + id);
  if (recState.mediaRecorder && recState.mediaRecorder.state === 'recording' && recState.id === id) {
    recState.mediaRecorder.stop();
    btn.textContent = '🎙 对比'; btn.classList.remove('recording');
    return;
  }
  if (recState.mediaRecorder) { recState.mediaRecorder.stop(); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recState.mediaRecorder = new MediaRecorder(stream);
    recState.chunks = [];
    recState.id = id;
    recState.mediaRecorder.ondataavailable = e => recState.chunks.push(e.data);
    recState.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      recState.blob = new Blob(recState.chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(recState.blob);
      const pp = box.querySelector(`[data-pp="${id}"]`);
      pp.dataset.url = url;
      box.classList.add('show');
    };
    recState.mediaRecorder.start();
    btn.textContent = '⏹ 录音中…'; btn.classList.add('recording');
  } catch (e) {
    alert('无法使用麦克风（需要 HTTPS 环境）');
  }
}

/* ---------- 单词详解 ---------- */
function showWord(word) {
  const w = wordMap[word.toLowerCase()];
  if (!w) return;
  els.wmWord.textContent = w.word;
  els.wmPhonetic.textContent = w.phonetic || '';
  els.wmSay.dataset.word = w.word;
  els.wmBody.innerHTML = `
    ${w.pos ? `<div class="row"><span class="k">词性</span><span class="def">${esc(w.pos)} ${esc(w.meaning)}</span></div>` : ''}
    ${w.cefr ? `<div class="row"><span class="k">难度</span><span class="tag">CEFR ${esc(w.cefr)}</span></div>` : ''}
    ${w.usage ? `<div class="row"><span class="k">搭配</span><span class="en">${esc(w.usage)}</span></div>` : ''}
    ${w.example ? `<div class="row"><span class="k">例句</span><span class="en">${esc(w.example)}</span></div>` : ''}
    ${w.family ? `<div class="row"><span class="k">词族</span><span class="en">${esc(w.family)}</span></div>` : ''}
    ${w.note ? `<div class="row"><span class="k">记</span>${esc(w.note)}</div>` : ''}
    <div class="row" style="display:flex;gap:8px;margin-top:14px;">
      <button class="mini-btn" data-kn="${esc(w.word)}">✓ 认识</button>
      <button class="mini-btn" data-unk="${esc(w.word)}">✗ 不认识</button>
    </div>`;
  els.wordMask.classList.add('show');
  els.wordModal.classList.add('show');
}

function playWord(word) {
  const a = new Audio(`audio/word/${word.toLowerCase().replace(/'/g, '')}.mp3`);
  a.playbackRate = speed;
  a.play().catch(() => alert('单词音频缺失（生成中？）'));
}

/* ---------- 论文精讲 ---------- */
function copyText(txt) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).catch(fallback);
  } else fallback();
}

/* ---------- 复习本 ---------- */
function getReview() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{"read":[],"known":{},"unknown":{}}'); } catch { return { read: [], known: {}, unknown: {} }; }
}
function saveReview(r) { localStorage.setItem(LS_KEY, JSON.stringify(r)); }

function markWord(word, known) {
  const r = getReview();
  delete r.known[word.toLowerCase()];
  delete r.unknown[word.toLowerCase()];
  r[known ? 'known' : 'unknown'][word.toLowerCase()] = true;
  saveReview(r);
  toast(known ? '已标记认识 ✓' : '已加入复习本 📒');
}

function renderReview() {
  const r = getReview();
  const unk = Object.keys(r.unknown);
  els.rvBody.innerHTML = unk.length
    ? unk.map(w => {
        const info = wordMap[w];
        return `<div class="rv-item">
          <span class="w tap-word" data-word="${esc(info ? info.word : w)}">${esc(info ? info.word : w)}</span>
          <span class="m">${info ? esc(info.meaning) : ''}</span>
          <div class="rv-btns">
            <button data-rvsay="${esc(info ? info.word : w)}">🔊</button>
            <button data-rvkn="${esc(w)}">认识</button>
            <button data-rvdel="${esc(w)}">✕</button>
          </div>
        </div>`;
      }).join('')
    : '<p style="color:var(--muted);text-align:center;padding:30px 0;">还没有不认识的词～读到生词点"✗ 不认识"就会收进来</p>';
}

function exportReview() {
  const r = getReview();
  const unk = Object.keys(r.unknown);
  const lines = unk.map(w => {
    const info = wordMap[w];
    return info ? `${info.word}\t${info.phonetic || ''}\t${info.pos || ''} ${info.meaning || ''}` : w;
  });
  const blob = new Blob(['单词\t音标\t释义\n' + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'scope-生词表.txt';
  a.click();
}

/* ---------- 工具 ---------- */
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);color:#fff;padding:12px 22px;border-radius:12px;z-index:120;font-size:14px;pointer-events:none;transition:opacity .3s;'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._tm); t._tm = setTimeout(() => t.style.opacity = '0', 1600);
}

function scrollToSent() {
  const el = $('#sent-' + sents[current].id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.list.querySelectorAll('.sent-card.current').forEach(x => x.classList.remove('current'));
    el.classList.add('current');
  }
}

function updateProgress() {
  const r = getReview();
  const read = r.read.length;
  els.bar.style.width = (read / sents.length * 100) + '%';
  els.ptext.textContent = `${read} / ${sents.length} 已读`;
  els.curPos.textContent = `${current + 1} / ${sents.length}`;
}

function markRead(id) {
  const r = getReview();
  if (!r.read.includes(id)) { r.read.push(id); saveReview(r); updateProgress(); }
}

/* ---------- 事件 ---------- */
function bind() {
  els.list.addEventListener('click', (e) => {
    const t = e.target;
    // 跟读
    const play = t.closest('[data-play]');
    if (play) { const id = +play.dataset.play; markRead(id); playSent(id); return; }
    // 翻译
    const cn = t.closest('[data-cn]');
    if (cn) { const card = cn.closest('.sent-card'); card.classList.toggle('show-cn'); return; }
    // 录音
    const rec = t.closest('[data-rec]');
    if (rec) { toggleRec(+rec.dataset.rec); return; }
    // 循环
    const lp = t.closest('[data-loop]');
    if (lp) {
      const id = +lp.dataset.loop;
      loopId = loopId === id ? null : id;
      lp.classList.toggle('active', loopId === id);
      lp.textContent = loopId === id ? '🔁 循环中' : '🔁 循环';
      if (loopId === id) playSent(id);
      return;
    }
    // 精讲：复制
    const nc = t.closest('[data-ncopy]');
    if (nc) { copyText(notes[+nc.dataset.ncopy] || ''); toast('讲解已复制 ✓'); return; }
    // 录音播放/删除
    const pp = t.closest('[data-pp]');
    if (pp) { const a = new Audio(pp.dataset.url); a.play(); return; }
    const del = t.closest('[data-del]');
    if (del) { const box = $('#rec-' + del.dataset.del); box.classList.remove('show'); recState.blob = null; return; }
    // 生词（句子内/详情内/chips/复习本）
    const w = t.closest('.tap-word[data-word]');
    if (w) { showWord(w.dataset.word); return; }
    const chip = t.closest('.word-chip[data-word]');
    if (chip) { showWord(chip.dataset.word); return; }
    const kn = t.closest('[data-kn]');
    if (kn) { markWord(kn.dataset.kn, true); return; }
    const unk = t.closest('[data-unk]');
    if (unk) { markWord(unk.dataset.unk, false); return; }
    const rvSay = t.closest('[data-rvsay]');
    if (rvSay) { playWord(rvSay.dataset.rvsay); return; }
    const rvKn = t.closest('[data-rvkn]');
    if (rvKn) { markWord(rvKn.dataset.rvkn, true); renderReview(); return; }
    const rvDel = t.closest('[data-rvdel]');
    if (rvDel) {
      const r = getReview(); delete r.unknown[rvDel.dataset.rvdel];
      saveReview(r); renderReview(); return;
    }
  });

  // 弹层
  els.wmClose.onclick = els.wordMask.onclick = () => {
    els.wordMask.classList.remove('show'); els.wordModal.classList.remove('show');
  };
  els.wmSay.onclick = () => playWord(els.wmSay.dataset.word);
  els.rvClose.onclick = els.reviewMask.onclick = () => {
    els.reviewMask.classList.remove('show'); els.reviewModal.classList.remove('show');
  };
  els.reviewBtn.onclick = () => { renderReview(); els.reviewMask.classList.add('show'); els.reviewModal.classList.add('show'); };
  els.rvExport.onclick = exportReview;

  // 工具栏
  els.playAll.onclick = playAll;
  els.speed.onclick = () => {
    speed = speed === 1.0 ? 0.75 : speed === 0.75 ? 1.0 : 1.0;
    els.speed.textContent = `速度 ${speed.toFixed(2)}x`;
  };
  els.shuffle.onclick = () => {
    const i = Math.floor(Math.random() * sents.length);
    current = i; scrollToSent(); markRead(sents[i].id);
    toast(`抽到第 ${sents[i].id} 句`);
  };
  els.mode.onclick = () => {
    document.body.classList.toggle('read-mode');
    els.mode.textContent = document.body.classList.contains('read-mode') ? '学习模式' : '朗读模式';
  };
  els.theme.onclick = () => {
    const dark = document.body.dataset.theme = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', dark);
    els.theme.textContent = dark === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('paperEcho_theme', dark);
  };

  // 上下句
  els.prev.onclick = () => { if (current > 0) { current--; scrollToSent(); } };
  els.next.onclick = () => { if (current < sents.length - 1) { current++; scrollToSent(); } };

  // 滚动计进度 + 更新当前句
  let ticking = false;
  els.list.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const cards = els.list.querySelectorAll('.sent-card');
      let best = 0, bestTop = Infinity;
      cards.forEach(c => {
        const top = Math.abs(c.getBoundingClientRect().top - 150);
        if (top < bestTop) { bestTop = top; best = +c.dataset.id; }
      });
      if (best && best !== sents[current].id) {
        current = sents.findIndex(s => s.id === best);
        markRead(best);
        els.list.querySelectorAll('.sent-card.current').forEach(x => x.classList.remove('current'));
        $('#sent-' + best).classList.add('current');
        updateProgress();
      }
    });
  });
}

/* ---------- 启动 ---------- */
(async function init() {
  const theme = localStorage.getItem('paperEcho_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  els.theme.textContent = theme === 'dark' ? '☀️' : '🌙';
  await loadData();
  // 给每句注入生词列表（用于 chips）
  sents.forEach(s => {
    const found = [];
    words.forEach(w => {
      const re = new RegExp(`(?<![A-Za-z])(${w.forms.join('|')})(?![A-Za-z])`, 'i');
      if (re.test(s.text)) found.push(w.word);
    });
    s.words = found.slice(0, 12);
  });
  render();
  updateProgress();
  bind();
  // 恢复上次位置
  const r = getReview();
  if (r.read.length) {
    const last = Math.max(...r.read);
    current = sents.findIndex(s => s.id === last);
    if (current < 0) current = 0;
    setTimeout(scrollToSent, 100);
  }
})();

})();
