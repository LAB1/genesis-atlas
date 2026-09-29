/* English narration through the browser's Web Speech API, chunked per sentence (Chrome truncates long
 * utterances). Supports pause / resume (the sentence in progress restarts from its beginning, which is the
 * only behaviour that works the same in every engine). When narration is off the narrator still "plays" on a
 * reading-speed clock so pacing and captions behave identically. */
(function () {
  'use strict';

  /* Sentence split for TTS chunks and captions. A sentence ends at . ! ? ; (plus closing quotes /
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

  function Narrator() {
    this.enabled = true;
    this.rate = 0.9;
    this.voice = null;
    this.supported = typeof window.speechSynthesis !== 'undefined';
    this.active = false;          /* a speak() promise is unresolved */
    this.paused = false;
    this._token = 0;
    this._timer = null;
    this._resumeFn = null;
    this._pauseHook = null;
    this.onSentence = null;       /* (index, sentences) */
    this.onState = null;          /* () => void, whenever active / paused changes */
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

  Narrator.prototype._state = function () { if (this.onState) { try { this.onState(); } catch (e) { /* ignore */ } } };

  /* English voices available in this browser (for the settings picker) */
  Narrator.prototype.voices = function () {
    if (!this.supported) return [];
    return (window.speechSynthesis.getVoices() || []).filter(function (v) { return /^en[-_]/i.test(v.lang); });
  };
  Narrator.prototype.setVoiceByName = function (name) {
    var v = this.voices().filter(function (x) { return x.name === name; })[0];
    if (v) { this.voice = v; this.pinned = name; }
  };

  Narrator.prototype.stop = function () {
    this._token++;
    clearTimeout(this._timer);
    this._resumeFn = null; this._pauseHook = null;
    var was = this.active || this.paused;
    this.active = false; this.paused = false;
    if (this.supported) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    if (was) this._state();
  };

  /* Switch between spoken and silent (reading-clock) narration without losing the place:
   * the sentence in progress restarts in the new mode. */
  Narrator.prototype.setEnabled = function (on) {
    on = !!on;
    if (this.enabled === on) return;
    var live = this.active && !this.paused;
    if (live) this.pause();
    this.enabled = on;
    if (live) this.resume();
    this._state();
  };

  /* Freeze narration. The speak() promise stays pending until resume(). */
  Narrator.prototype.pause = function () {
    if (!this.active || this.paused) return;
    this.paused = true;
    clearTimeout(this._timer);
    if (this._pauseHook) this._pauseHook();
    if (this.supported) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    this._state();
  };

  Narrator.prototype.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    var f = this._resumeFn;
    this._resumeFn = null;
    this._state();
    if (f) f();
  };

  /* Speak `text`; resolves true when finished, false when stopped/superseded. */
  Narrator.prototype.speak = function (text) {
    this.stop();
    var token = this._token;
    var self = this;
    var sentences = splitSentences(text);
    this.active = true;
    this._state();
    return new Promise(function (resolve0) {
      function resolve(v) {
        if (token === self._token) { self.active = false; self.paused = false; self._resumeFn = null; self._pauseHook = null; self._state(); }
        resolve0(v);
      }
      speakSentences(self, sentences, token, resolve);
    });
  };

  function speakSentences(self, sentences, token, resolve) {
    var i = 0, cur = null;
    /* pause() calls this synchronously: abandon the sentence in progress so it restarts on resume */
    self._pauseHook = function () {
      if (cur && !cur.finished) { cur.finished = true; i--; }
      cur = null;
      self._resumeFn = next;
    };
    function next() {
      if (token !== self._token) { resolve(false); return; }
      if (self.paused) { self._resumeFn = next; return; }
      if (i >= sentences.length) { resolve(true); return; }
      var s = sentences[i];
      var st = { finished: false };
      cur = st;
      if (self.onSentence) self.onSentence(i, sentences);
      i++;
      var words = s.split(' ').length;
      var readMs = Math.max(1200, (words / (2.55 * self.rate)) * 1000);
      var done = function () { if (st.finished) return; st.finished = true; clearTimeout(self._timer); cur = null; next(); };
      if (self.enabled && self.supported) {
        var u = new SpeechSynthesisUtterance(s);
        if (self.voice) u.voice = self.voice;
        u.lang = (self.voice && self.voice.lang) || 'en-US';
        u.rate = self.rate;
        u.pitch = 1.0;
        u.onend = done;
        u.onerror = done;
        /* watchdog: some engines never fire onend */
        self._timer = setTimeout(done, readMs * 2.2 + 2500);
        try { window.speechSynthesis.speak(u); } catch (e) { done(); }
      } else {
        self._timer = setTimeout(done, readMs);
      }
    }
    next();
  }

  window.AtlasNarrator = new Narrator();
  window.AtlasNarrator.splitSentences = splitSentences;
})();
