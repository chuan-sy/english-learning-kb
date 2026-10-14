/* ============================================================
   英语学习知识库 · Vue 3 应用
   SPA 路由 + 4 套主题实时切换 + 搜索 + 阅读进度 + 本页目录
   内容来自 assets/data.js（window.KB_DATA）
   互动练习与发音按钮沿用 interaction.js / audio.js，
   每次内容渲染后用 window.__kbInteractions / window.KBAudio 重新挂载。
   ============================================================ */
(function () {
  'use strict';

  var DATA = window.KB_DATA;
  if (!DATA) { document.getElementById('app').innerHTML = '<p style="padding:40px">内容数据加载失败。</p>'; return; }

  /* ---------- 索引：把章节拍平，便于按 key 取 ---------- */
  var byKey = {};
  var order = [];
  var realChapters = [];
  DATA.chapters.forEach(function (c) {
    if (c.id === 'route' || !c.topics || !c.topics.length) return;
    realChapters.push(c);
    c.topics.forEach(function (t) {
      byKey[t.id] = { topic: t, chapter: c };
      order.push(t.id);
    });
  });

  /* ---------- 已读记录 ---------- */
  var READ_KEY = 'en-kb-read';
  function loadRead() {
    try {
      var v = JSON.parse(localStorage.getItem(READ_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveRead(v) {
    try { localStorage.setItem(READ_KEY, JSON.stringify(v)); } catch (e) {}
  }

  var THEMES = [
    { id: 'navy', name: '藏青松绿', sw: ['#1e3a8a', '#0f766e'], desc: '稳重书房感，白天长时间阅读' },
    { id: 'ink',  name: '宣纸朱红', sw: ['#9a3412', '#3f6212'], desc: '米白纸底 + 墨色字，仿线装书，最省眼' },
    { id: 'teal', name: '松绿琥珀', sw: ['#0f766e', '#b45309'], desc: '清爽亮眼，对比强' },
    { id: 'plum', name: '夜间紫檀', sw: ['#a78bfa', '#5eead4'], desc: '深色底，晚上关灯看不刺眼' }
  ];

  var THEME_KEY = 'en-kb-theme';
  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'teal'; } catch (e) { return 'teal'; }
  }
  function saveTheme(v) {
    try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
  }

  /* ---------- 折叠状态 ---------- */
  var openMap = {};
  DATA.chapters.forEach(function (c) { openMap[c.id] = true; });

  /* ---------- 抽屉宽度兜底 ----------
     CSS 用固定 var(--side-w)。有些窄屏（<340px，少见的老手机/分屏）
     300px 会占太满，这里用 JS 收窄到视口的 88%。 */
  function fitSidebar() {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var want = Math.min(300, Math.round(vw * 0.88));
    sb.style.setProperty('--side-w', want + 'px');
  }

  /* ---------- 路由：hash -> key ---------- */
  function keyFromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return 'intro';
    if (h === 'intro' || h === 'route') return h;
    if (byKey[h]) return h;
    return null;
  }

  var app = Vue.createApp({
    data: function () {
      return {
        chapters: DATA.chapters,
        realChapters: realChapters,
        themes: THEMES,
        theme: loadTheme(),
        q: '',
        open: openMap,
        sideOpen: false,
        curKey: keyFromHash() || 'intro',
        pct: 0,
        pageToc: [],
        activeSec: '',
        hits: [],
        read: loadRead(),
        totalTopics: realChapters.reduce(function (s, c) { return s + c.topics.length; }, 0)
      };
    },

    computed: {
      cur: function () {
        var k = this.curKey;
        if (k === 'intro') return { key: 'intro', chapter: null, html: '', isIntro: true };
        if (k === 'route') return { key: 'route', chapter: null, html: '', isRoute: true };
        var e = byKey[k];
        if (!e) return { key: k, chapter: null, html: '', missing: true };
        return { key: k, chapter: e.chapter.id, html: e.topic.html, topic: e.topic };
      },
      flatTopics: function () {
        var out = [];
        this.realChapters.forEach(function (c) {
          c.topics.forEach(function (t) { out.push({ topic: t, chapter: c }); });
        });
        return out;
      },
      readCount: function () {
        return this.read.length;
      }
    },

    watch: {
      theme: function (v) {
        document.documentElement.setAttribute('data-theme', v);
        saveTheme(v);
      },
      sideOpen: function (v) {
        document.body.classList.toggle('side-open', !!v);
      },
      curKey: function () {
        var self = this;
        this.pageToc = [];
        this.activeSec = '';
        this.pct = 0;
        // 读到当前节 → 记入已读
        var k = this.curKey;
        if (byKey[k] && this.read.indexOf(k) < 0) {
          this.read.push(k);
          saveRead(this.read);
        }
        this.$nextTick(function () {
          self.mountContent();
          window.scrollTo({ top: 0 });
          // 内容变了再量一次高度（图片/表格会改变）
          setTimeout(self.measure, 120);
        });
      },
      q: function () {
        this.runSearch();
      }
    },

    mounted: function () {
      document.documentElement.setAttribute('data-theme', this.theme);
      var self = this;

      window.addEventListener('hashchange', function () {
        var k = keyFromHash();
        if (k && k !== self.curKey) self.curKey = k;
      });

      /* 兜底：个别内嵌 WebView 改 location.hash 不派发 hashchange，
         这里低频轮询一次，保证地址栏和内容不会脱节。 */
      var lastHash = location.hash;
      setInterval(function () {
        if (location.hash !== lastHash) {
          lastHash = location.hash;
          var k = keyFromHash();
          if (k && k !== self.curKey) self.curKey = k;
        }
      }, 400);

      // 抽屉打开时点遮罩 / 按 Esc 关闭
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.sideOpen) self.sideOpen = false;
      });
      document.addEventListener('click', function (e) {
        if (!self.sideOpen) return;
        var sb = document.getElementById('sidebar');
        var mb = document.getElementById('menuBtn');
        if (sb && sb.contains(e.target)) return;
        if (mb && mb.contains(e.target)) return;
        self.sideOpen = false;
      });

      // '/' 聚焦搜索
      document.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        if (e.key === '/') {
          e.preventDefault();
          var el = document.getElementById('search');
          if (el) el.focus();
        }
      });

      this.mountContent();
      setTimeout(this.measure, 150);

      // 滚动：进度 + 本页目录高亮
      /* 注意：某些内嵌 WebView / 自动化环境里 requestAnimationFrame 不回调，
         导致纯 rAF 节流会让进度条和右栏高亮永远不更新。
         这里 rAF + setTimeout 双注册，谁先跑谁算，用 done 标记去重。 */
      var sched = null, schedDone = false;
      function schedule() {
        if (schedDone) return;
        try {
          requestAnimationFrame(function () {
            if (schedDone) return;
            schedDone = true; self.measure();
          });
        } catch (e) {}
        setTimeout(function () {
          if (schedDone) return;
          schedDone = true; self.measure();
        }, 60);
      }
      window.addEventListener('scroll', function () {
        if (sched) return;
        schedDone = false;
        schedule();
        sched = setTimeout(function () { sched = null; }, 60);
      }, { passive: true });
      window.addEventListener('resize', function () { self.measure(); fitSidebar(); });
      fitSidebar();
      // 首屏也量一次（不等 scroll）
      setTimeout(function(){ self.measure(); }, 200);
    },

    methods: {
      chapterOf: function (key) {
        var e = byKey[key];
        return e ? e.chapter : null;
      },

      go: function (o) {
        this.curKey = o.key;
        this.sideOpen = false;
        if (location.hash !== '#' + o.key) {
          history.replaceState(null, '', '#' + o.key);
        }
      },

      /* 抽屉：开时给 body 加 class 锁背景滚动（≤980 才有效，见 style.css） */
      openSide: function () { this.sideOpen = true; },
      closeSide: function () { this.sideOpen = false; },
      toggleSide: function () { this.sideOpen = !this.sideOpen; },

      setTheme: function (id) { this.theme = id; },
      toggleChapter: function (id) { this.open[id] = !this.open[id]; },

      /* 侧边栏：章节序号（跳过空的 route 章） */
      chapterIdx: function (c) {
        var i = this.realChapters.indexOf(c);
        return i < 0 ? '' : (c.id === 'appendix' ? '附' : String(i));
      },
      isRead: function (id) { return this.read.indexOf(id) >= 0; },
      chapterProgress: function (c) {
        var n = 0;
        c.topics.forEach(function (t) { if (this.read.indexOf(t.id) >= 0) n++; }, this);
        return c.topics.length ? Math.round((n / c.topics.length) * 100) : 0;
      },
      isChapterDone: function (c) { return this.chapterProgress(c) >= 100; },
      resetRead: function () {
        this.read = [];
        saveRead([]);
      },

      /* 内容渲染后：重新挂互动练习 + 发音按钮 + 生成本页目录 */
      mountContent: function () {
        var art = document.querySelector('article.topic');
        if (!art) return;

        // 1) 互动练习
        try {
          var I = window.__kbInteractions;
          if (I) {
            ['.ex-choice', '.ex-sort', '.ex-match', '.ex-order', '.ex-reveal', '.ex-hint',
             '.tense-demo', '.phonics', '.rhythm'].forEach(function (sel) {
              art.querySelectorAll(sel).forEach(function (el) {
                var fn = sel === '.ex-choice' ? I.initChoice
                  : sel === '.ex-sort' ? I.initSort
                  : sel === '.ex-match' ? I.initMatch
                  : sel === '.ex-order' ? I.initOrder
                  : sel === '.ex-reveal' ? I.initReveal
                  : sel === '.ex-hint' ? I.initHint
                  : sel === '.tense-demo' ? I.initTenseSlider
                  : sel === '.phonics' ? I.initPhonics
                  : I.initRhythm;
                if (fn) fn(el);
              });
            });
          }
        } catch (e) { console.warn('interaction remount:', e); }

        // 2) 发音按钮
        try {
          if (window.KBAudio && window.KBAudio.redocorate) window.KBAudio.redocorate();
        } catch (e) { console.warn('audio remount:', e); }

        // 3) 本页目录（右栏）
        var heads = art.querySelectorAll('h4.sub, h4, h5');
        var out = [];
        heads.forEach(function (h, i) {
          if (!h.id) h.id = art.id + '-h' + (i + 1);
          out.push({ id: h.id, text: (h.textContent || '').trim() });
        });
        this.pageToc = out;
      },

      jump: function (id) {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },

      /* 进度 + 当前小节高亮 */
      measure: function () {
        var doc = document.documentElement;
        var total = doc.scrollHeight - window.innerHeight;
        var p = total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 0;
        this.pct = Math.round(p);

        var y = window.scrollY + 140;
        var links = this.pageToc;
        if (!links.length) { this.activeSec = ''; return; }
        var cur = links[0].id;
        for (var i = 0; i < links.length; i++) {
          var el = document.getElementById(links[i].id);
          if (el && el.getBoundingClientRect().top + window.scrollY <= y) cur = links[i].id;
        }
        this.activeSec = cur;
      },

      /* 搜索：标题命中 + 正文命中 */
      runSearch: function () {
        var q = this.q.trim().toLowerCase();
        if (!q) { this.hits = []; return; }
        var hits = [];
        var esc = function (s) {
          return s.replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
          });
        };
        var flat = this.flatTopics;
        for (var i = 0; i < flat.length && hits.length < 60; i++) {
          var e = flat[i], t = e.topic, c = e.chapter;
          var titleHit = t.title.toLowerCase().indexOf(q) >= 0
                      || t.short.toLowerCase().indexOf(q) >= 0;
          var idx = t.html.toLowerCase().indexOf(q);
          if (titleHit || idx >= 0) {
            var where = (c.label || '') + ' ' + (t.num || '');
            var mark;
            if (titleHit && idx < 0) {
              mark = '<mark>' + esc(t.title) + '</mark>';
            } else {
              var s = Math.max(0, idx - 30);
              var seg = t.html.slice(s, idx + q.length + 60).replace(/<[^>]+>/g, '');
              var at = seg.toLowerCase().indexOf(q);
              if (at < 0) at = 0;
              mark = esc(seg.slice(0, at)) + '<mark>' + esc(seg.slice(at, at + q.length)) + '</mark>'
                   + esc(seg.slice(at + q.length));
            }
            hits.push({ key: t.id, chapter: c.id, where: where.trim(), mark: mark });
          }
        }
        this.hits = hits;
      }
    }
  });

  app.mount('#app');
})();
