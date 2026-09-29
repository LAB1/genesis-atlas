/* English narration. Two voices:
 *   studio  — pre-rendered neural-TTS clips (audio/manifest.js, built by tools/gen_audio.py), played with
 *             <audio>; sentence timings drive the subtitle highlight; speed via playbackRate (pitch kept).
 *   browser — the Web Speech API, chunked per sentence.
 * A clip is used only if its stored text hash matches the current narration text, so edited narration
 * silently falls back to the browser voice until the audio is regenerated.
 * When narration is off the narrator still "plays" on a reading-speed clock so pacing and subtitle
 * highlighting behave identically. */
(function () {
  'use strict';

  /* Sentence split for TTS chunks and subtitles. A sentence ends at . ! ? ; (plus closing quotes /
   * brackets) only when followed by whitespace or the end, so "Qwen2.5-VL" or "0.5 s" stay intact. */
  function splitSentences(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    var out = [], re = /[.!?;]+["')\]]*(?=\s|$)/g, last = 0, m;
    while ((m = re.exec(s)) !== null) {
      var end = m.index + m[0].length;
      out.push(s.slice(last, end));
      last = end;
    }
    if (last < s.length) out.push(s.slice(last));
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* FNV-1a (32 bit) over the UTF-8 bytes of the whitespace-normalised text. tools/gen_audio.py uses the
   * identical function, so hashes match across the two. */
  function hashText(text) {
    var s = unescape(encodeURIComponent(String(text || '').replace(/\s+/g, ' ').trim()));
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function Narrator() {
    this.enabled = true;
    this.mode = 'studio';         /* 'studio' | 'browser' | 'off' (enabled=false) */
    this.rate = 1.0;
    this.voice = null;
    this.supported = typeof window.speechSynthesis !== 'undefined';
    this._token = 0;
    this._timer = null;
    this._audio = null;
    this._preloaded = {};
    this.onSentence = null; /* (index, sentences) */
    var self = this;
    if (this.supported) {
      var pick = function () {
        if (self.pinned) { self.setVoiceByName(self.pinned); if (self.voice && self.voice.name === self.pinned) return; }
        var vs = window.speechSynthesis.getVoices() || [];
        var en = vs.filter(function (v) { return /^en[-_]/i.test(v.lang); });
        var prefs = [/Ava.*(Online|Natural)/i, /Aria.*(Online|Natural)/i, /Jenny.*(Online|Natural)/i, /Andrew.*(Online|Natural)/i, /Emma.*(Online|Natural)/i, /Guy.*(Online|Natural)/i, /Brian.*(Online|Natural)/i, /Natural/i, /Neural/i, /Google US English/i, /Samantha/i, /Daniel/i, /Google UK English Male/i, /Zira/i, /David/i];
        for (var i = 0; i < prefs.length; i++) {
          for (var j = 0; j < en.length; j++) if (prefs[i].test(en[j].name)) { self.voice = en[j]; return; }
        }
        self.voice = en[0] || null;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  /* English voices available in this browser (for the settings picker) */
  Narrator.prototype.voices = function () {
    if (!this.supported) return [];
    return (window.speechSynthesis.getVoices() || []).filter(function (v) { return /^en[-_]/i.test(v.lang); });
  };
  Narrator.prototype.setVoiceByName = function (name) {
    var v = this.voices().filter(function (x) { return x.name === name; })[0];
    if (v) { this.voice = v; this.pinned = name; }
  };

  /* pre-rendered clip for this narration text, or null */
  Narrator.prototype.clip = function (key, text) {
    var A = window.ATLAS_AUDIO;
    if (!A || !key) return null;
    var e = A[key];
    return e && e.h === hashText(text) ? e : null;
  };
  Narrator.prototype.hasStudio = function () { return !!window.ATLAS_AUDIO && Object.keys(window.ATLAS_AUDIO).length > 0; };

  /* warm the cache for an upcoming clip */
  Narrator.prototype.preload = function (key, text) {
    var c = this.clip(key, text);
    if (!c || this._preloaded[c.f]) return;
    try { var a = new Audio(); a.preload = 'auto'; a.src = c.f; this._preloaded[c.f] = a; } catch (e) { /* ignore */ }
  };

  Narrator.prototype.stop = function () {
    this._token++;
    clearTimeout(this._timer);
    if (this._audio) { try { this._audio.pause(); } catch (e) { /* ignore */ } this._audio.onended = this._audio.onerror = this._audio.ontimeupdate = null; }
    if (this.supported) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  };

  /* Speak `text`; resolves true when finished, false when stopped/superseded.
   * opts.key selects a pre-rendered clip ('scene/step/beat'). */
  Narrator.prototype.speak = function (text, opts) {
    this.stop();
    var token = this._token;
    var self = this;
    var sentences = splitSentences(text);
    var clip = (this.enabled && this.mode === 'studio') ? this.clip(opts && opts.key, text) : null;
    return new Promise(function (resolve) {
      if (clip) { playClip(self, clip, sentences, token, resolve, function () { speakSentences(self, sentences, token, resolve); }); return; }
      speakSentences(self, sentences, token, resolve);
    });
  };

  function playClip(self, clip, sentences, token, resolve, fallback) {
    var a = self._audio || (self._audio = new Audio());
    a.onended = a.onerror = a.ontimeupdate = null;
    var cached = self._preloaded[clip.f];
    a.src = cached ? cached.src : clip.f;
    try { a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true; } catch (e) { /* ignore */ }
    a.playbackRate = self.rate;
    var starts = clip.s && clip.s.length ? clip.s : [0];
    var lastIdx = -1, done = false, wd;
    function finish(ok) { if (done) return; done = true; clearTimeout(wd); a.onended = a.onerror = a.ontimeupdate = null; if (ok === 'fallback') fallback(); else resolve(ok); }
    a.ontimeupdate = function () {
      if (token !== self._token) return;
      var t = a.currentTime, idx = 0;
      for (var i = 0; i < starts.length; i++) if (t + 0.05 >= starts[i]) idx = i;
      if (idx !== lastIdx) { lastIdx = idx; if (self.onSentence) self.onSentence(Math.min(idx, sentences.length - 1), sentences); }
    };
    a.onended = function () { finish(token === self._token); };
    a.onerror = function () { finish(token === self._token ? 'fallback' : false); };
    wd = setTimeout(function () { finish(token === self._token ? true : false); }, (clip.d / Math.max(0.3, self.rate)) * 1000 + 4000);
    if (self.onSentence) self.onSentence(0, sentences);
    var p;
    try { p = a.play(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(function () { finish(token === self._token ? 'fallback' : false); });
  }

  function speakSentences(self, sentences, token, resolve) {
    var i = 0;
    function next() {
      if (token !== self._token) { resolve(false); return; }
      if (i >= sentences.length) { resolve(true); return; }
      var s = sentences[i];
      if (self.onSentence) self.onSentence(i, sentences);
      i++;
      var words = s.split(' ').length;
      var readMs = Math.max(1200, (words / (2.55 * self.rate)) * 1000);
      if (self.enabled && self.supported) {
        var u = new SpeechSynthesisUtterance(s);
        if (self.voice) u.voice = self.voice;
        u.lang = (self.voice && self.voice.lang) || 'en-US';
        u.rate = self.rate;
        u.pitch = 1.0;
        var finished = false;
        var done = function () { if (finished) return; finished = true; clearTimeout(self._timer); next(); };
        u.onend = done;
        u.onerror = done;
        /* watchdog: some engines never fire onend */
        self._timer = setTimeout(done, readMs * 2.2 + 2500);
        try { window.speechSynthesis.speak(u); } catch (e) { done(); }
      } else {
        self._timer = setTimeout(next, readMs);
      }
    }
    next();
  }

  window.AtlasNarrator = new Narrator();
  window.AtlasNarrator.splitSentences = splitSentences;
  window.AtlasNarrator.hashText = hashText;
})();
