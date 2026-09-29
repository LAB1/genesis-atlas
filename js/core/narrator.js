/* English narration via the Web Speech API, with sentence-level subtitles.
 * Speech is chunked per sentence (Chrome truncates long utterances).
 * When muted, the narrator still "plays" on a reading-speed clock so autoplay pacing and
 * subtitle highlighting stay identical. */
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

  function Narrator() {
    this.enabled = true;
    this.rate = 1.0;
    this.voice = null;
    this.supported = typeof window.speechSynthesis !== 'undefined';
    this._token = 0;
    this._timer = null;
    this.onSentence = null; /* (index, sentences) */
    var self = this;
    if (this.supported) {
      var pick = function () {
        var vs = window.speechSynthesis.getVoices() || [];
        var en = vs.filter(function (v) { return /^en[-_]/i.test(v.lang); });
        var prefs = [/Aria.*Natural/i, /Jenny.*Natural/i, /Guy.*Natural/i, /Natural/i, /Google US English/i, /Samantha/i, /Daniel/i, /Google UK English Male/i, /Zira/i, /David/i];
        for (var i = 0; i < prefs.length; i++) {
          for (var j = 0; j < en.length; j++) if (prefs[i].test(en[j].name)) { self.voice = en[j]; return; }
        }
        self.voice = en[0] || null;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  Narrator.prototype.stop = function () {
    this._token++;
    clearTimeout(this._timer);
    if (this.supported) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  };

  /* Speak `text`; resolves when finished (or when stopped/superseded). */
  Narrator.prototype.speak = function (text) {
    this.stop();
    var token = this._token;
    var self = this;
    var sentences = splitSentences(text);
    return new Promise(function (resolve) {
      var i = 0;
      function next() {
        if (token !== self._token) { resolve(false); return; }
        if (i >= sentences.length) { resolve(true); return; }
        var s = sentences[i];
        if (self.onSentence) self.onSentence(i, sentences);
        var idx = i; i++;
        var words = s.split(' ').length;
        var readMs = Math.max(1200, (words / (2.55 * self.rate)) * 1000);
        if (self.enabled && self.supported && self.voice !== undefined) {
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
        return idx;
      }
      next();
    });
  };

  window.AtlasNarrator = new Narrator();
  window.AtlasNarrator.splitSentences = splitSentences;
})();
