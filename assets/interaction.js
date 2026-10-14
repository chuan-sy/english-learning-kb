/* ============================================================
   英语学习知识库 · 交互引擎 interaction.js
   支撑 5 种练习组件：
     .ex-choice  单选题（点击选项，即时判定 + 解析）
     .ex-sort    拖拽分类（把卡片拖进正确的筐里）
     .ex-match   连线配对（左右两列点击配对）
     .ex-order   排序（拖拽把词块排成正确顺序）
     .ex-reveal  刮刮卡式揭示（先想，再点开看答案）
   另外：
     .ex-hint    悬停/点击展开的详解气泡
   全部不依赖外部库，支持鼠标与触摸。
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 通用：给元素加反馈状态 ---------- */
  function mark(el, state) {
    el.classList.remove('is-right', 'is-wrong', 'is-picked');
    el.classList.add(state);
  }

  /* ---------- 通用：读取 data-* ---------- */
  function data(el, key, fallback) {
    var v = el.getAttribute('data-' + key);
    return v === null ? (fallback === undefined ? '' : fallback) : v;
  }

  /* ============================================================
     1) 单选题 .ex-choice
     <div class="ex-choice" data-answer="b">
       <p class="ex-q">题干</p>
       <button class="ex-opt" data-key="a">选项A</button>
       <button class="ex-opt" data-key="b">选项B</button>
       <div class="ex-exp">解析…</div>
     </div>
     ============================================================ */
  function initChoice(root) {
    var answer = data(root, 'answer');
    var opts = [].slice.call(root.querySelectorAll('.ex-opt'));
    var exp = root.querySelector('.ex-exp');
    var done = false;

    opts.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (done) return;
        var key = data(btn, 'key');
        if (key === answer) {
          done = true;
          mark(btn, 'is-right');
          root.classList.add('solved');
          opts.forEach(function (o) { o.disabled = true; });
          if (exp) exp.classList.add('show');
        } else {
          mark(btn, 'is-wrong');
          btn.disabled = true;
          root.classList.add('tried-wrong');
          // 第一次错的时候提示，但不说答案
          var tip = root.querySelector('.ex-tip');
          if (tip) tip.classList.add('show');
        }
      });
    });
  }

  /* ============================================================
     2) 拖拽分类 .ex-sort
     <div class="ex-sort">
       <div class="ex-pool">
         <span class="ex-card" data-bin="a">卡片1</span>
         ...
       </div>
       <div class="ex-bins">
         <div class="ex-bin" data-bin="a"><h5>筐A</h5><div class="ex-drop"></div></div>
         <div class="ex-bin" data-bin="b"><h5>筐B</h5><div class="ex-drop"></div></div>
       </div>
     </div>
     ============================================================ */
  function initSort(root) {
    var cards = [].slice.call(root.querySelectorAll('.ex-card'));
    var drops = [].slice.call(root.querySelectorAll('.ex-drop'));
    var reset = root.querySelector('.ex-reset');
    var check = root.querySelector('.ex-check');
    var scoreEl = root.querySelector('.ex-score');

    /* --- 指针拖拽（鼠标 + 触摸统一） --- */
    var dragging = null, ghost = null, offsetX = 0, offsetY = 0;

    function pointerDown(e) {
      if (root.classList.contains('locked')) return;
      var card = e.target.closest('.ex-card');
      if (!card) return;
      e.preventDefault();
      dragging = card;
      var r = card.getBoundingClientRect();
      var p = e.touches ? e.touches[0] : e;
      offsetX = p.clientX - r.left;
      offsetY = p.clientY - r.top;

      ghost = card.cloneNode(true);
      ghost.classList.add('ex-ghost');
      ghost.style.width = r.width + 'px';
      ghost.style.height = r.height + 'px';
      document.body.appendChild(ghost);
      moveGhost(p.clientX, p.clientY);

      card.classList.add('ex-dragging');
      document.addEventListener('mousemove', pointerMove);
      document.addEventListener('mouseup', pointerUp);
      document.addEventListener('touchmove', pointerMove, { passive: false });
      document.addEventListener('touchend', pointerUp);
    }

    function moveGhost(x, y) {
      if (!ghost) return;
      ghost.style.left = (x - offsetX) + 'px';
      ghost.style.top = (y - offsetY) + 'px';
    }

    function pointerMove(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      var p = e.touches ? e.touches[0] : e;
      moveGhost(p.clientX, p.clientY);
      var bin = binUnder(p.clientX, p.clientY);
      drops.forEach(function (d) {
        d.parentElement.classList.toggle('ex-over', d === bin);
      });
    }

    function binUnder(x, y) {
      for (var i = 0; i < drops.length; i++) {
        var r = drops[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return drops[i];
      }
      return null;
    }

    function pointerUp(e) {
      document.removeEventListener('mousemove', pointerMove);
      document.removeEventListener('mouseup', pointerUp);
      document.removeEventListener('touchmove', pointerMove);
      document.removeEventListener('touchend', pointerUp);
      if (!dragging) return;
      var p = e.changedTouches ? e.changedTouches[0] : e;
      var bin = binUnder(p.clientX, p.clientY);
      if (bin) {
        bin.appendChild(dragging);
        dragging.classList.remove('is-right', 'is-wrong');
      }
      dragging.classList.remove('ex-dragging');
      if (ghost) { ghost.remove(); ghost = null; }
      drops.forEach(function (d) { d.parentElement.classList.remove('ex-over'); });
      dragging = null;
      autoCheck();
    }

    cards.forEach(function (c) { c.addEventListener('mousedown', pointerDown); c.addEventListener('touchstart', pointerDown, { passive: false }); });

    /* --- 点击也能放：先点卡片选中，再点筐 --- */
    var selected = null;
    root.addEventListener('click', function (e) {
      if (root.classList.contains('locked')) return;
      var card = e.target.closest('.ex-card');
      var bin = e.target.closest('.ex-bin');
      if (card) {
        // 不管是池子里还是筐里的卡片，点一下都能选中
        if (selected === card) { card.classList.remove('ex-selected'); selected = null; }
        else {
          if (selected) selected.classList.remove('ex-selected');
          selected = card; card.classList.add('ex-selected');
        }
        return;
      }
      if (bin && selected) {
        var drop = bin.querySelector('.ex-drop');
        drop.appendChild(selected);
        selected.classList.remove('ex-selected', 'is-right', 'is-wrong');
        selected = null;
        autoCheck();
      }
    });

    function autoCheck() {
      // 每一次放置都重新算分：池空了就直接锁定，没放完也实时更新成绩
      var pool = root.querySelector('.ex-pool');
      if (!pool) return;
      var allPlaced = !pool.querySelector('.ex-card');
      var rightBefore = root.querySelectorAll('.ex-card.is-right').length;
      evaluate();
      if (!allPlaced) {
        // 还没放完：只在从「有错」变「无错」或成绩有变化时提示，不锁定
        var rightNow = root.querySelectorAll('.ex-card.is-right').length;
        if (rightNow === rightBefore) return;
      }
    }

    function evaluate() {
      var right = 0, total = cards.length;
      cards.forEach(function (c) {
        var want = data(c, 'bin');
        var parent = c.closest('.ex-bin') || c.closest('.ex-pool');
        var got = parent ? data(parent, 'bin', 'pool') : 'pool';
        c.classList.remove('is-right', 'is-wrong');
        if (got === want) { c.classList.add('is-right'); right++; }
        else { c.classList.add('is-wrong'); }
      });
      if (scoreEl) {
        scoreEl.textContent = right + ' / ' + total + ' 放对了';
        scoreEl.className = 'ex-score ' + (right === total ? 'all-right' : 'partial');
      }
      if (right === total) {
        root.classList.add('locked', 'solved');
        root.querySelector('.ex-exp') && root.querySelector('.ex-exp').classList.add('show');
      }
      return right;
    }

    if (check) check.addEventListener('click', evaluate);

    if (reset) reset.addEventListener('click', function () {
      var pool = root.querySelector('.ex-pool');
      cards.forEach(function (c) {
        c.classList.remove('is-right', 'is-wrong', 'ex-selected');
        pool.appendChild(c);
      });
      root.classList.remove('locked', 'solved');
      if (scoreEl) { scoreEl.textContent = ''; scoreEl.className = 'ex-score'; }
      var exp = root.querySelector('.ex-exp');
      if (exp) exp.classList.remove('show');
    });
  }

  /* ============================================================
     3) 连线配对 .ex-match
     <div class="ex-match">
       <div class="ex-col ex-left">
         <button class="ex-item" data-k="1">左侧1</button>
       </div>
       <div class="ex-col ex-right">
         <button class="ex-item" data-k="1">右侧1</button>
       </div>
     </div>
     左右 data-k 相同的为一对。
     ============================================================ */
  function initMatch(root) {
    var items = [].slice.call(root.querySelectorAll('.ex-item'));
    var pickedLeft = null, matched = 0;
    var totalPairs = items.filter(function (i) { return i.closest('.ex-left'); }).length;
    var scoreEl = root.querySelector('.ex-score');
    var wrongCount = 0;

    items.forEach(function (it) {
      it.addEventListener('click', function () {
        if (it.classList.contains('is-right')) return;
        var isLeft = !!it.closest('.ex-left');
        if (isLeft) {
          if (pickedLeft) pickedLeft.classList.remove('ex-selected');
          pickedLeft = it;
          it.classList.add('ex-selected');
          return;
        }
        // 点了右边
        if (!pickedLeft) {
          it.classList.add('ex-wrong');
          setTimeout(function () { it.classList.remove('ex-wrong'); }, 600);
          return;
        }
        if (data(pickedLeft, 'k') === data(it, 'k')) {
          pickedLeft.classList.remove('ex-selected');
          mark(pickedLeft, 'is-right');
          mark(it, 'is-right');
          pickedLeft.disabled = true; it.disabled = true;
          matched++;
          pickedLeft = null;
          if (scoreEl) scoreEl.textContent = matched + ' / ' + totalPairs + ' 配对成功';
          if (matched === totalPairs) {
            root.classList.add('solved');
            var exp = root.querySelector('.ex-exp');
            if (exp) exp.classList.add('show');
          }
        } else {
          wrongCount++;
          mark(it, 'is-wrong');
          pickedLeft.classList.add('ex-shake');
          var l = pickedLeft;
          setTimeout(function () {
            it.classList.remove('is-wrong');
            l.classList.remove('ex-shake');
          }, 600);
          pickedLeft.classList.remove('ex-selected');
          pickedLeft = null;
        }
      });
    });
  }

  /* ============================================================
     4) 排序 .ex-order
     <div class="ex-order" data-answer="The|rabbit|ate|a|carrot">
       <div class="ex-pool">
         <span class="ex-card" data-w="rabbit">rabbit</span>
         ...
       </div>
       <div class="ex-line"></div>
     </div>
     判定：按 .ex-line 里卡片顺序拼出的字符串是否等于 data-answer。
     ============================================================ */
  function initOrder(root) {
    var answer = data(root, 'answer').split('|');
    var pool = root.querySelector('.ex-pool');
    var line = root.querySelector('.ex-line');
    var cards = [].slice.call(root.querySelectorAll('.ex-card'));
    var check = root.querySelector('.ex-check');
    var reset = root.querySelector('.ex-reset');
    var scoreEl = root.querySelector('.ex-score');

    // 点击移动 + 拖拽（复用 sort 的指针逻辑：卡片在 pool / line 之间搬运）
    var dragging = null, ghost = null;

    function down(e) {
      if (root.classList.contains('locked')) return;
      var card = e.target.closest('.ex-card');
      if (!card) return;
      e.preventDefault();
      var r = card.getBoundingClientRect();
      var p = e.touches ? e.touches[0] : e;
      var ox = p.clientX - r.left, oy = p.clientY - r.top;
      dragging = card;
      ghost = card.cloneNode(true);
      ghost.classList.add('ex-ghost');
      ghost.style.width = r.width + 'px';
      document.body.appendChild(ghost);
      var mv = function (ev) {
        if (ev.cancelable) ev.preventDefault();
        var q = ev.touches ? ev.touches[0] : ev;
        ghost.style.left = (q.clientX - ox) + 'px';
        ghost.style.top = (q.clientY - oy) + 'px';
        var rl = line.getBoundingClientRect();
        line.classList.toggle('ex-over', q.clientX >= rl.left && q.clientX <= rl.right && q.clientY >= rl.top - 30 && q.clientY <= rl.bottom + 30);
      };
      var up = function (ev) {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', mv);
        document.removeEventListener('touchend', up);
        var q = ev.changedTouches ? ev.changedTouches[0] : ev;
        var rl = line.getBoundingClientRect();
        if (q.clientX >= rl.left && q.clientX <= rl.right && q.clientY >= rl.top - 30 && q.clientY <= rl.bottom + 30) {
          line.appendChild(dragging);
        } else if (line.contains(dragging)) {
          pool.appendChild(dragging);
        }
        dragging.classList.remove('ex-dragging');
        line.classList.remove('ex-over');
        if (ghost) { ghost.remove(); ghost = null; }
        dragging = null;
      };
      card.classList.add('ex-dragging');
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', mv, { passive: false });
      document.addEventListener('touchend', up);
    }
    cards.forEach(function (c) { c.addEventListener('mousedown', down); c.addEventListener('touchstart', down, { passive: false }); });

    // 点击：pool → line（追加到末尾）；line → pool
    root.addEventListener('click', function (e) {
      if (root.classList.contains('locked')) return;
      var card = e.target.closest('.ex-card');
      if (!card || card.classList.contains('ex-dragging')) return;
      if (pool.contains(card)) line.appendChild(card);
      else pool.appendChild(card);
      card.classList.remove('is-right', 'is-wrong');
    });

    function evaluate() {
      var got = [].slice.call(line.querySelectorAll('.ex-card')).map(function (c) { return c.textContent.trim(); });
      var ok = got.length === answer.length && got.every(function (w, i) { return w === answer[i]; });
      cards.forEach(function (c) { c.classList.remove('is-right', 'is-wrong'); });
      line.querySelectorAll('.ex-card').forEach(function (c) {
        var idx = got.indexOf(c.textContent.trim());
        c.classList.add(ok ? 'is-right' : 'is-wrong');
      });
      if (scoreEl) {
        scoreEl.textContent = ok ? '✓ 完全正确' : '还不对，再调调顺序';
        scoreEl.className = 'ex-score ' + (ok ? 'all-right' : 'partial');
      }
      if (ok) {
        root.classList.add('locked', 'solved');
        var exp = root.querySelector('.ex-exp');
        if (exp) exp.classList.add('show');
      }
      return ok;
    }
    if (check) check.addEventListener('click', evaluate);
    if (reset) reset.addEventListener('click', function () {
      cards.forEach(function (c) { c.classList.remove('is-right', 'is-wrong'); pool.appendChild(c); });
      root.classList.remove('locked', 'solved');
      if (scoreEl) { scoreEl.textContent = ''; scoreEl.className = 'ex-score'; }
      var exp = root.querySelector('.ex-exp');
      if (exp) exp.classList.remove('show');
    });
  }

  /* ============================================================
     5) 揭示卡 .ex-reveal
     <div class="ex-reveal">
       <button class="ex-cover">先自己想一想，点开对答案</button>
       <div class="ex-body">…答案内容…</div>
     </div>
     ============================================================ */
  function initReveal(root) {
    var cover = root.querySelector('.ex-cover');
    if (!cover) return;
    cover.addEventListener('click', function () {
      root.classList.toggle('open');
      cover.textContent = root.classList.contains('open') ? '收起答案' : (data(cover, 'label') || '先自己想一想，点开对答案');
    });
  }

  /* ============================================================
     6) 悬停详解 .ex-hint —— 点一下展开（触屏也能用）
     ============================================================ */
  function initHint(root) {
    var trig = root.querySelector('.ex-hint-trigger') || root;
    trig.addEventListener('click', function (e) {
      e.preventDefault();
      root.classList.toggle('open');
    });
  }

  /* ============================================================
     7) 互动演示器：虚拟语气「退一格」
     ============================================================ */
  function initTenseSlider(root) {
    var range = root.querySelector('input[type=range]');
    if (!range) return;
    var steps = [].slice.call(root.querySelectorAll('.td-step'));
    var sentEl = root.querySelector('.td-sent');
    var zhEl = root.querySelector('.td-zh');
    var whyEl = root.querySelector('.td-why');
    var out = root.querySelector('.td-value');

    var DATA = [
      { label: '现在 —— 这是真的',
        sent: 'I <span class="td-sub">am</span> a rabbit.',
        zh: '我是一只兔子。（在陈述一个事实）',
        why: '时态待在「现在」，说明说话人认为这件事<strong>就是真的</strong>。' },
      { label: '过去 —— 退一格，标记「不是真的」',
        sent: 'If I <span class="td-back">were</span> a rabbit, I would eat all the carrots.',
        zh: '如果我是一只兔子，我会把胡萝卜全吃了。（可我并不是）',
        why: '本来该用 am，现在<strong>退到 were</strong>——这一退，就是在说「我知道我不是」。这就是虚拟语气的全部秘密。' },
      { label: '过去完成 —— 再退一格，标记「过去也没发生」',
        sent: 'If I <span class="td-back">had studied</span> harder, I would have passed the exam.',
        zh: '如果我当时学得更努力，我就通过考试了。（当时并没有）',
        why: '现在退到过去不够用了——这件事本来就发生在过去。<strong>过去没法再退，就用 had + 过去分词</strong>。退回得越深，越说明「我知道这不可能」。' },
      { label: 'were to —— 退到未来，标记「将来也不太可能」',
        sent: 'If I <span class="td-back">were to see</span> the wolf tomorrow, I would run away.',
        zh: '万一我明天见到那只狼，我就跑。（可能性很小）',
        why: '将来还没发生，本来无从「退」。所以英语借用了 were to / should 这种形式，<strong>把「不太可能」的感觉也标记出来</strong>。' }
    ];

    function render() {
      var v = parseInt(range.value, 10);
      if (!DATA[v]) v = 0;
      steps.forEach(function (s, i) { s.classList.toggle('active', i === v); });
      if (sentEl) sentEl.innerHTML = '当前：' + DATA[v].sent;
      if (zhEl) zhEl.textContent = DATA[v].zh;
      if (out) out.textContent = DATA[v].label;
      if (whyEl) {
        whyEl.innerHTML = '<strong>为什么：</strong>' + DATA[v].why;
      }
    }
    range.addEventListener('input', render);
    steps.forEach(function (s, i) {
      s.addEventListener('click', function () { range.value = i; render(); });
    });
    render();
  }

  /* ============================================================
     8) 音标点读：点音标 → 浏览器朗读该音标的示例词
     ============================================================ */
  function initPhonics(root) {
    var canSpeak = 'speechSynthesis' in window;
    var cells = [].slice.call(root.querySelectorAll('.ph-cell'));
    var status = root.querySelector('.ph-status');

    function speak(word) {
      if (!canSpeak || !word) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(word);
        u.lang = 'en-US';
        u.rate = 0.72;
        var vs = window.speechSynthesis.getVoices();
        var en = vs.filter(function (v) { return /^en[-_]/i.test(v.lang); });
        if (en.length) {
          var us = en.filter(function (v) { return /US|United States/i.test(v.lang + v.name); });
          u.voice = us[0] || en[0];
        }
        window.speechSynthesis.speak(u);
      } catch (e) { /* 静默失败 */ }
    }

    cells.forEach(function (cell) {
      cell.addEventListener('click', function () {
        cells.forEach(function (c) { c.classList.remove('playing'); });
        cell.classList.add('playing');
        var w1 = data(cell, 'word', '');
        var w2 = data(cell, 'word2', '');
        if (status) {
          status.textContent = '🔊 ' + (data(cell, 'ipa', '') + '  ' + w1 + (w2 ? ' / ' + w2 : ''));
        }
        speak(w1);
      });
    });

    // 语音列表异步加载，预热一下
    if (canSpeak && window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
    }

    var all = root.querySelector('.ph-all');
    if (all) {
      all.addEventListener('click', function () {
        if (!canSpeak) return;
        var list = cells.map(function (c) { return data(c, 'word', ''); }).filter(Boolean);
        window.speechSynthesis.cancel();
        list.slice(0, 20).forEach(function (w) {
          var u = new SpeechSynthesisUtterance(w);
          u.lang = 'en-US'; u.rate = 0.8;
          window.speechSynthesis.speak(u);
        });
        if (status) status.textContent = '🔊 正在依次朗读前 20 个…';
      });
    }
  }

  /* ============================================================
     9) 节奏打击器：点音节，感受重音等时性
     ============================================================ */
  function initRhythm(root) {
    var btns = [].slice.call(root.querySelectorAll('.ry-syl'));
    var out = root.querySelector('.ry-out');
    var last = 0;
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () {
        b.classList.add('hit');
        setTimeout(function () { b.classList.remove('hit'); }, 180);
        var now = performance.now();
        var gap = last ? Math.round(now - last) : null;
        last = now;
        if (out) {
          var stressed = b.classList.contains('stressed');
          var msg = stressed ? '重读音节' : '轻读音节';
          out.textContent = gap === null
            ? '开始计时…再点下一个音节'
            : ('两次点击间隔 ' + gap + ' 毫秒（' + msg + '）' + (stressed ? ' ← 重音之间本该差不多等长' : ''));
        }
      });
    });
    var reset = root.querySelector('.ry-reset');
    if (reset) reset.addEventListener('click', function () {
      last = 0;
      btns.forEach(function (b) { b.classList.remove('hit'); });
      if (out) out.textContent = '';
    });
  }

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    document.querySelectorAll('.ex-choice').forEach(initChoice);
    document.querySelectorAll('.ex-sort').forEach(initSort);
    document.querySelectorAll('.ex-match').forEach(initMatch);
    document.querySelectorAll('.ex-order').forEach(initOrder);
    document.querySelectorAll('.ex-reveal').forEach(initReveal);
    document.querySelectorAll('.ex-hint').forEach(initHint);
    document.querySelectorAll('.tense-demo').forEach(initTenseSlider);
    document.querySelectorAll('.phonics').forEach(initPhonics);
    document.querySelectorAll('.rhythm').forEach(initRhythm);
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 暴露给调试
  window.__kbInteractions = { initChoice: initChoice, initSort: initSort, initMatch: initMatch, initOrder: initOrder, initReveal: initReveal, initTenseSlider: initTenseSlider, initPhonics: initPhonics, initRhythm: initRhythm };
})();

  /* ============================================================
     5) 行详解卡 .row-detail
        —— 表格行数多时，把解释折起来；点标题展开
     ============================================================ */
  function initRowDetail(root) {
    var rows = [].slice.call(root.querySelectorAll('.rd-row'));
    if (!rows.length) return;

    rows.forEach(function (row) {
      var head = row.querySelector('.rd-head');
      var body = row.querySelector('.rd-body');
      if (!head || !body) return;

      head.setAttribute('aria-expanded', 'false');
      body.setAttribute('role', 'region');

      head.addEventListener('click', function () {
        var open = row.classList.toggle('open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    /* 键盘：上下箭头在行之间移动，Enter/Space 由 button 原生处理 */
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var head = e.target.closest('.rd-head');
      if (!head) return;
      var i = rows.indexOf(head.closest('.rd-row'));
      if (i < 0) return;
      var next = rows[e.key === 'ArrowDown' ? i + 1 : i - 1];
      if (!next) return;
      e.preventDefault();
      next.querySelector('.rd-head').focus();
    });
  }

  document.querySelectorAll('.row-detail').forEach(initRowDetail);
