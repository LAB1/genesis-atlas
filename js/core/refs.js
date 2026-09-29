/* Global reference numbering, shared by the app (Sources chips) and references.html.
 * Identical references in different chambers (same text after normalisation) share one number;
 * numbers follow catalog order, so both pages always agree. */
(function () {
  'use strict';

  function strip(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* order: catalog entries [{id, ...}]; scenes: id -> impl with .refs. Sets impl._refNums; returns the list. */
  function build(order, scenes) {
    var byKey = {}, list = [];
    order.forEach(function (m) {
      var impl = scenes[m.id];
      if (!impl) return;
      impl._refNums = [];
      (impl.refs || []).forEach(function (r) {
        var key = strip(r).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        var e = byKey[key];
        if (!e) {
          e = { n: list.length + 1, html: r, text: strip(r), scenes: [] };
          byKey[key] = e; list.push(e);
        }
        if (e.scenes.indexOf(m.id) < 0) e.scenes.push(m.id);
        impl._refNums.push(e.n);
      });
    });
    return list;
  }

  function scholarUrl(e) {
    var m = /<i>(.*?)<\/i>/i.exec(e.html);
    var q = m ? strip(m[1]) : e.text.slice(0, 110);
    return 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q);
  }

  window.AtlasRefs = { build: build, strip: strip, scholarUrl: scholarUrl };
})();
