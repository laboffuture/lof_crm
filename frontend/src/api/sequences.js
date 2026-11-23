/* Record numbers from server sequences, so ids never collide between users. */
var remaps = [];
function makeSeq(peek) {
  var st = { peek: Object.assign({}, peek), blocks: {} };
  var rc = {};
  Object.keys(peek).forEach(function (k) {
    if (k.indexOf('rc_') === 0) rc[k.slice(3)] = peek[k] - 1;
  });
  var target = { rc: rc };
  return new Proxy(target, {
    get: function (t, k) {
      if (k === 'rc') return t.rc;
      if (EXACT.indexOf(k) >= 0) return st.peek[k] || 1;
      if (BLOCK.indexOf(k) >= 0) {
        var b = st.blocks[k];
        if (!b || b.next >= b.end) {
          var r = xhr('POST', '/seq/block', { name: k, size: 20 });
          b = st.blocks[k] = { next: r.start, end: r.start + r.size };
        }
        return b.next;
      }
      return t[k];
    },
    set: function (t, k, v) {
      if (EXACT.indexOf(k) >= 0) {
        var expect = st.peek[k] || 1;
        var r = xhr('POST', '/seq/claim', { name: k, expect: expect });
        if (!r.ok && FMT[k]) remaps.push({ from: FMT[k](expect), to: FMT[k](r.value) });
        st.peek[k] = r.value + 1;
        return true;
      }
      if (BLOCK.indexOf(k) >= 0) {
        if (st.blocks[k]) st.blocks[k].next++;
        return true;
      }
      t[k] = v;
      return true;
    },
  });
}
/** Another user took the number we showed: rename the new record everywhere before it is saved. */
function applyRemaps() {
  if (!remaps.length) return;
  var list = remaps.splice(0);
  list.forEach(function (m) {
    var re = new RegExp(m.from.replace(/[-]/g, '\\-') + '(?![0-9])', 'g');
    Object.keys(COLL).forEach(function (c) {
      (S[c] || []).forEach(function (d, i) {
        var j = JSON.stringify(d);
        if (j.indexOf(m.from) >= 0) S[c][i] = JSON.parse(j.replace(re, m.to));
      });
    });
    if (S.route && S.route.id === m.from) S.route.id = m.to;
    toast('Number ' + m.from + ' was just taken by a colleague – saved as ' + m.to, 'warn');
  });
}
