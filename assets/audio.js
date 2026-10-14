/* ==========================================================================
   audio.js — 发音播放器
   为页面中所有英文单词 / 例句 / 音标提供「点一下就能听」的能力。

   音频来源（三级回退，保证一定有声音）：
     1. audio/<key>.mp3  —— 预先用 Piper 真人音色离线生成（首选，最快）
     2. Web Speech API   —— 浏览器/系统自带语音（兜底）
   音色可在页面顶部切换（美音 Lessac / 英音 Alba）。
   ========================================================================== */
(function () {
    'use strict';

    var INDEX_URL = 'audio/index.json';
    var manifest = {};          // key -> {text,label,kind,file,speak,name}
    var byText = {};            // text(lower) -> key
    var ready = false;
    var audio = new Audio();
    var currentBtn = null;
    var preload = {};
    var voiceMode = 'us';       // 'us' | 'gb'
    var slowMode = false;

    try { voiceMode = localStorage.getItem('en-kb-voice') || 'us'; } catch (e) {}
    try { slowMode = localStorage.getItem('en-kb-slow') === '1'; } catch (e) {}

    /* ---------- 图标 ---------- */
    var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 9v6h4l5 4V5L8 9H4z"/>' +
        '<path d="M16.5 8.5a5 5 0 0 1 0 7v-7z" opacity=".55"/>' +
        '</svg>';
    var ICON_LG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M3 9v6h4l5 4V5L8 9H3z"/>' +
        '<path d="M16 8a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M18.8 5.2a9.5 9.5 0 0 1 0 13.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".7"/>' +
        '</svg>';

    /* ---------- 文本归一化与查找 ---------- */
    function norm(s) {
        return (s || '')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function hashKey(kind, text) {
        // 与 Python 端 hashlib.md5 不同 —— 这里只用于运行时兜底，不参与文件名映射
        var h = 5381, i;
        for (i = 0; i < text.length; i++) { h = ((h << 5) + h + text.charCodeAt(i)) | 0; }
        return kind + '-' + (h >>> 0).toString(16);
    }

    /* ---------- 播放 ---------- */
    function stop() {
        if (currentBtn) { currentBtn.classList.remove('playing'); currentBtn = null; }
        try { audio.pause(); } catch (e) {}
        if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    }

    function speakFallback(text, btn) {
        if (!window.speechSynthesis) { flash(btn, false); return; }
        var u = new SpeechSynthesisUtterance(text);
        u.lang = voiceMode === 'gb' ? 'en-GB' : 'en-US';
        u.rate = slowMode ? 0.7 : 0.95;
        var vs = window.speechSynthesis.getVoices() || [];
        var want = voiceMode === 'gb' ? 'en-GB' : 'en-US';
        var pick = null, i;
        for (i = 0; i < vs.length; i++) { if (vs[i].lang === want) { pick = vs[i]; break; } }
        if (!pick) { for (i = 0; i < vs.length; i++) { if (/^en/i.test(vs[i].lang)) { pick = vs[i]; break; } } }
        if (pick) u.voice = pick;
        u.onend = function () { if (currentBtn === btn) { btn.classList.remove('playing'); currentBtn = null; } };
        u.onerror = function () { if (currentBtn === btn) { btn.classList.remove('playing'); currentBtn = null; } };
        window.speechSynthesis.speak(u);
    }

    function playKey(key, btn, text) {
        var item = manifest[key];
        if (currentBtn === btn) { stop(); return; }
        stop();
        if (btn) { btn.classList.add('playing'); currentBtn = btn; }

        var done = function () { if (currentBtn === btn) { btn.classList.remove('playing'); currentBtn = null; } };

        if (item && item.file) {
            audio.src = item.file;
            audio.playbackRate = slowMode ? 0.72 : 1;
            var p = audio.play();
            if (p && p.catch) { p.catch(function () { speakFallback(item.speak || item.text, btn); }); }
            audio.onended = done;
            audio.onerror = function () { speakFallback(item.speak || item.text, btn); };
        } else {
            speakFallback(text || '', btn);
        }
    }

    function flash(btn, ok) {
        if (!btn) return;
        btn.classList.add(ok ? 'playing' : 'loading');
        setTimeout(function () { btn.classList.remove('playing'); btn.classList.remove('loading'); }, 500);
    }

    /* ---------- 按文本找一个可用的 key ---------- */
    function keyFor(text, kind) {
        var n = norm(text);
        if (!n) return null;
        if (kind && byText[kind + '|' + n]) return byText[kind + '|' + n];
        if (byText['|' + n]) return byText['|' + n];
        // 去标点再试
        var stripped = n.replace(/[.,!?;:"'()\[\]…]+$/g, '').replace(/^[.,!?;:"'()\[\]…]+/g, '').trim();
        if (stripped !== n && byText['|' + stripped]) return byText['|' + stripped];
        return null;
    }

    /* ---------- 取元素里真正该朗读的那段英文 ----------
       .quote-en / .demo 里常常既有英文原文，又有中文翻译或来源标题。
       直接 textContent 会把中文一起吞进来，结果一个字都匹配不到音频。
       策略：① data-say 属性 ② 纯英文的直接子节点 ③ 截断到第一个汉字之前。 */
    function englishOf(el) {
        var explicit = el.getAttribute('data-say');
        if (explicit) return explicit.trim();

        var marked = el.querySelector('.en, [lang="en"], .quote-en-text');
        if (marked) {
            var mt = marked.textContent.replace(/\s+/g, ' ').trim();
            if (/[A-Za-z]{3}/.test(mt)) return mt;
        }
        var kids = el.childNodes, i;
        for (i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k.nodeType === 3) {
                var tx = k.textContent.replace(/\s+/g, ' ').trim();
                if (tx && /[A-Za-z]{3}/.test(tx) && !/[\u4e00-\u9fff]/.test(tx)) return tx;
            } else if (k.nodeType === 1) {
                if (k.classList && (k.classList.contains('spk') || k.classList.contains('say'))) continue;
                var t2 = k.textContent.replace(/\s+/g, ' ').trim();
                if (t2 && /[A-Za-z]{3}/.test(t2) && !/[\u4e00-\u9fff]/.test(t2)) return t2;
            }
        }
        var full = el.textContent.replace(/\s+/g, ' ').trim();
        var cut = full.search(/[\u4e00-\u9fff]/);
        if (cut > 8) full = full.slice(0, cut).trim();
        return full;
    }

    /* ---------- 按钮工厂 ---------- */
    function mkBtn(key, text, big) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'spk' + (big ? ' spk-lg' : '');
        b.innerHTML = big ? ICON_LG : ICON;
        b.setAttribute('data-key', key || '');
        b.setAttribute('data-text', text || '');
        b.title = '点击发音' + (big ? '' : '：' + (text || '').slice(0, 30));
        b.setAttribute('aria-label', '朗读 ' + (text || '').slice(0, 40));
        b.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var k = b.getAttribute('data-key') || keyFor(b.getAttribute('data-text'));
            if (k && manifest[k]) { b.setAttribute('data-key', k); }
            playKey(k, b, b.getAttribute('data-text'));
        });
        return b;
    }

    /* ---------- 装饰：mono 单元格 ---------- */
    var SKIP_MONO = /^[\s\d.,:%()\-–—+/\\]+$/;
    function decorateMono() {
        var els = document.querySelectorAll('.mono, .bad-block, .good-block');
        var i;
        for (i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.getAttribute('data-spk-done') === '1') continue;
            if (el.querySelector('.spk')) continue;
            var raw = el.textContent.replace(/\s+/g, ' ').trim();
            if (!raw || raw.length > 110) continue;
            if (SKIP_MONO.test(raw)) continue;
            if (!/[A-Za-z]/.test(raw) && !/[\u026A\u028A\u0259\u025C\u0254\u00E6\u0251\u0252\u028C\u0283\u0292\u03B8\u00F0\u014B]/.test(raw)) continue;
            var key = keyFor(raw);
            if (!key) continue;
            el.setAttribute('data-spk-done', '1');
            el.appendChild(mkBtn(key, raw, false));
        }
    }

    /* ---------- 装饰：quote-en 整句 ---------- */
    function decorateQuotes() {
        var els = document.querySelectorAll('.quote-en, .quote-big');
        var i;
        for (i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.getAttribute('data-spk-done') === '1') continue;
            if (el.querySelector('.spk')) continue;
            var raw = englishOf(el);
            if (!raw || raw.length > 220) continue;
            if (!/[A-Za-z]{3}/.test(raw)) continue;
            var k = keyFor(raw) || keyFor(raw, 'sentence') || keyFor(raw, 'phrase');
            if (!k) continue;
            el.setAttribute('data-spk-done', '1');
            var wrap = document.createElement('span');
            wrap.className = 'say';
            wrap.appendChild(mkBtn(k, raw, true));
            el.insertBefore(wrap, el.firstChild);
        }
    }

    /* ---------- 装饰：demo 里的英文行 ---------- */
    function decorateDemos() {
        var demos = document.querySelectorAll('.demo');
        var i, j;
        for (i = 0; i < demos.length; i++) {
            var d = demos[i];
            if (d.getAttribute('data-spk-done') === '1') continue;
            d.setAttribute('data-spk-done', '1');
            var ps = d.querySelectorAll('p, li, .demo-label');
            for (j = 0; j < ps.length; j++) {
                var p = ps[j];
                if (p.querySelector('.spk')) continue;
                var raw = englishOf(p);
                if (!raw || raw.length > 170) continue;
                var cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
                if (cjk > 2) continue;                      // 中文行不加
                if (!/[A-Za-z]{3}/.test(raw)) continue;
                var k = keyFor(raw);
                if (!k) continue;
                p.appendChild(mkBtn(k, raw, false));
            }
        }
    }

    /* ---------- 装饰：表格里的英文例句 ---------- */
    var EQ = /[A-Za-z]{2,}/;
    function decorateTables() {
        var cells = document.querySelectorAll('.tbl td, .tbl th');
        var i;
        for (i = 0; i < cells.length; i++) {
            var td = cells[i];
            if (td.getAttribute('data-spk-done') === '1') continue;
            if (td.querySelector('.spk')) continue;
            var raw = td.textContent.replace(/\s+/g, ' ').trim();
            if (!raw || raw.length > 140) continue;
            var cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
            var lat = (raw.match(/[A-Za-z]/g) || []).length;
            if (lat < 3 || cjk > 6) continue;
            if (!EQ.test(raw)) continue;
            var k = keyFor(raw);
            if (!k) continue;
            td.setAttribute('data-spk-done', '1');
            td.appendChild(mkBtn(k, raw, false));
        }
    }

    /* ---------- 装饰：err-list / bullet 里的英文 ---------- */
    function decorateLists() {
        var lis = document.querySelectorAll('.ex-q, .quiz-q, .callout p, .insight p, .principle p');
        var i;
        for (i = 0; i < lis.length; i++) {
            var el = lis[i];
            if (el.getAttribute('data-spk-done') === '1') continue;
            if (el.querySelector('.spk')) continue;
            var raw = el.textContent.replace(/\s+/g, ' ').trim();
            var cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
            if (cjk > 0) continue;
            if (!/^[A-Za-z]/.test(raw)) continue;
            if (raw.length > 150 || raw.length < 8) continue;
            if (!/[A-Za-z]{3}\s+[A-Za-z]{2}/.test(raw)) continue;
            var k = keyFor(raw);
            if (!k) continue;
            el.setAttribute('data-spk-done', '1');
            el.appendChild(mkBtn(k, raw, true));
        }
    }

    /* ---------- 音标芯片条 ----------
       每个音标芯片点一下会依次播放两段：
         ① 音标本身的发音（来自 IPA 官方图表的独立录音，已离线打包）
         ② 一个含该音的示范单词（Piper 合成）
       这样你既能听见"这个音到底是什么"，也能听见"它在单词里长什么样"。
       如果是元音组合（双元音）—— 图表上没有单独的录音 —— 就只放示范词。 */
    var ipaSounds = {};         // phoneme -> 'audio/ipa-sound-xx.mp3'
    var ipaSoundLoaded = false;

    function loadIpaSounds(cb) {
        if (ipaSoundLoaded) { if (cb) cb(); return; }
        fetch('audio/ipa-sounds.json')
            .then(function (r) { return r.ok ? r.json() : {}; })
            .catch(function () { return {}; })
            .then(function (j) {
                ipaSounds = j || {};
                ipaSoundLoaded = true;
                if (cb) cb();
            });
    }

    // 依次播放若干段音频；每段结束后自动接下一段
    function playSeq(list, btn, onDone) {
        var idx = 0;
        function next() {
            if (idx >= list.length) {
                if (onDone) onDone();
                return;
            }
            var cur = list[idx++];
            audio.src = cur.src;
            audio.playbackRate = 1;
            var p = audio.play();
            if (p && p.catch) {
                p.catch(function () { next(); });
            }
            audio.onended = next;
            audio.onerror = next;
        }
        next();
    }

    function playIpaChip(chip, ipa) {
        var wordKey = chip.getAttribute('data-key');
        var wordSrc = (manifest[wordKey] && manifest[wordKey].file) || null;
        var sndSrc = ipaSounds[ipa] || ipaSounds[ipa.replace(/\//g, '')] || null;

        var seq = [];
        if (sndSrc) seq.push({ src: sndSrc });
        if (wordSrc) seq.push({ src: wordSrc });

        if (!seq.length) {
            speakFallback(ipa, chip);
            return;
        }
        chip.classList.add('playing');
        currentBtn = chip;
        playSeq(seq, chip, function () {
            if (currentBtn === chip) {
                chip.classList.remove('playing');
                currentBtn = null;
            }
        });
    }

    function decorateIpa() {
        var chips = document.querySelectorAll('.ipa-chip[data-ipa], .ipa-sym[data-ipa]');
        var i;
        for (i = 0; i < chips.length; i++) {
            var c = chips[i];
            if (c.getAttribute('data-spk-done') === '1') continue;
            c.setAttribute('data-spk-done', '1');
            var ipa = c.getAttribute('data-ipa');
            var k = keyFor(ipa, 'ipa') || keyFor('/' + ipa + '/');
            c.setAttribute('data-key', k || '');
            // 有独立录音的，标一个记号，并提示点一下会"先音后词"
            if (ipaSounds[ipa] || ipaSounds[ipa.replace(/\//g, '')]) {
                c.classList.add('has-sound');
                c.setAttribute('title', '点一下：先听这个音的本身，再听示范词');
            } else {
                c.setAttribute('title', '点一下听示范词（这个音是组合音，图表没有单独录音）');
            }
            c.addEventListener('click', function (ev) {
                ev.preventDefault();
                if (currentBtn === this) { stop(); return; }
                stop();
                playIpaChip(this, this.getAttribute('data-ipa'));
            });
            c.style.cursor = 'pointer';
        }
    }

    /* ---------- 音色切换栏 ---------- */
    function buildVoiceBar() {
        var main = document.getElementById('main');
        if (!main || document.getElementById('voiceBar')) return;
        var host = main.querySelector('.topic');
        if (!host) return;

        var bar = document.createElement('div');
        bar.className = 'voice-bar';
        bar.id = 'voiceBar';
        bar.innerHTML =
            '<span class="vb-label">发音音色</span>' +
            '<span class="voice-seg" id="voiceSeg">' +
            '<button type="button" data-v="us">🇺🇸 美音 Lessac</button>' +
            '<button type="button" data-v="gb">🇬🇧 英音 Alba</button>' +
            '</span>' +
            '<button type="button" class="spk-slow" id="slowToggle">慢速</button>' +
            '<button type="button" class="spk-slow" id="stopAll">停止</button>' +
            '<span class="vb-hint">所有英文都能点 🔊 —— 单词、例句、音标</span>';

        var seg = bar.querySelector('#voiceSeg');
        function sync() {
            var bs = seg.querySelectorAll('button'), i;
            for (i = 0; i < bs.length; i++) {
                bs[i].classList.toggle('on', bs[i].getAttribute('data-v') === voiceMode);
            }
            var st = document.getElementById('slowToggle');
            if (st) st.classList.toggle('on', slowMode);
        }
        seg.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button') : null;
            if (!b) return;
            voiceMode = b.getAttribute('data-v');
            try { localStorage.setItem('en-kb-voice', voiceMode); } catch (e) {}
            sync();
            // 试听
            var demo = manifest['voice-demo-' + voiceMode];
            if (demo) { playKey('voice-demo-' + voiceMode, null, null); }
        });
        bar.querySelector('#slowToggle').addEventListener('click', function () {
            slowMode = !slowMode;
            try { localStorage.setItem('en-kb-slow', slowMode ? '1' : '0'); } catch (e) {}
            sync();
        });
        bar.querySelector('#stopAll').addEventListener('click', stop);

        host.appendChild(bar);
        sync();
    }

    /* ---------- 初始化 ---------- */
    function buildMaps() {
        var k;
        for (k in manifest) {
            if (!Object.prototype.hasOwnProperty.call(manifest, k)) continue;
            var it = manifest[k];
            var n = norm(it.text);
            if (!byText['|' + n]) byText['|' + n] = k;
            var nk = it.kind + '|' + n;
            if (!byText[nk]) byText[nk] = k;
            if (it.label) {
                var ln = norm(it.label);
                if (!byText['|' + ln]) byText['|' + ln] = k;
            }
        }
    }

    function decorateAll() {
        if (!ready) return;
        try { buildVoiceBar(); } catch (e) {}
        try { decorateIpa(); } catch (e) {}
        try { decorateMono(); } catch (e) {}
        try { decorateQuotes(); } catch (e) {}
        try { decorateDemos(); } catch (e) {}
        try { decorateTables(); } catch (e) {}
        try { decorateLists(); } catch (e) {}
        if (window.__kbAudioCount !== undefined) {
            window.__kbAudioCount = document.querySelectorAll('.spk').length;
        }
    }

    function loadIndex() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', INDEX_URL, true);
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    manifest = JSON.parse(xhr.responseText);
                } catch (e) { manifest = {}; }
            }
            ready = true;
            buildMaps();
            // 音标独立录音是单独一份小清单，先拿到再挂芯片（拿不到也照样能用示范词）
            loadIpaSounds(function () { decorateAll(); });
        };
        xhr.onerror = function () {
            ready = true;
            loadIpaSounds(function () { decorateAll(); });
        };
        try { xhr.send(); } catch (e) {
            ready = true;
            loadIpaSounds(function () { decorateAll(); });
        }
    }

    // 滚动/搜索后新增的内容也要挂上按钮
    var timer = null;
    function reDecorate() {
        if (!ready) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(decorateAll, 220);
    }

    window.KBAudio = {
        play: function (text, kind) { playKey(keyFor(text, kind), null, text); },
        stop: stop,
        redocorate: decorateAll,
        count: function () { return Object.keys(manifest).length; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadIndex);
    } else {
        loadIndex();
    }
    // 语音列表是异步的
    if (window.speechSynthesis) {
        try { window.speechSynthesis.getVoices(); } catch (e) {}
    }
})();
