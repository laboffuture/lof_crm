// ------------------------------------------------------------------ page motion (LOF style guide)
// Like the Student Learning Hub: when the page (or a record tab) changes, the blocks of the new page rise into place
// one after another (direction follows the sidebar order), KPI figures count up, and the sidebar highlight glides
// from the old item to the new one. Ordinary re-renders (typing, filters) do not animate. Off with reduced motion.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lastKey = null,
    lastIdx = -1,
    lastTop = null;
  function routeKey() {
    return S && S.route ? JSON.stringify(S.route) + '|' + (S.tab || '') + '|' + (S.stuTab || '') : null;
  }
  function glide(nav, animate) {
    var on = nav.querySelector('a.it.on');
    var ind = document.createElement('div');
    ind.className = 'nav-ind';
    nav.insertBefore(ind, nav.firstChild);
    nav.classList.add('glide');
    if (!on) {
      ind.style.opacity = 0;
      lastTop = null;
      return;
    }
    var top = on.offsetTop,
      h = on.offsetHeight;
    ind.style.height = h + 'px';
    if (animate && lastTop !== null && lastTop !== top) {
      ind.style.transition = 'none';
      ind.style.transform = 'translateY(' + lastTop + 'px)';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          ind.style.transition = '';
          ind.style.transform = 'translateY(' + top + 'px)';
        });
      });
    } else ind.style.transform = 'translateY(' + top + 'px)';
    lastTop = top;
  }
  function countUp(el) {
    var node = [].slice.call(el.childNodes).find(function (n) {
      return n.nodeType === 3 && /\d/.test(n.textContent);
    });
    if (!node) return;
    var raw = node.textContent,
      m = raw.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var target = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(target) || target === 0) return;
    var dec = (m[2].split('.')[1] || '').length,
      start = performance.now(),
      dur = 700;
    (function step(t) {
      if (!document.body.contains(node)) return;
      var p = Math.min((t - start) / dur, 1),
        e = 1 - Math.pow(1 - p, 3),
        v = target * e;
      node.textContent = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-IN')) + m[3];
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = raw;
    })(start);
  }
  var _renderMotion = window.render;
  window.render = function () {
    _renderMotion.apply(this, arguments);
    try {
      var nav = document.querySelector('.shell .nav');
      if (!nav) {
        lastKey = null;
        return;
      }
      var key = routeKey(),
        changed = key !== lastKey && lastKey !== null,
        first = lastKey === null;
      lastKey = key;
      var items = [].slice.call(nav.querySelectorAll('a.it')),
        idx = items.findIndex(function (a) {
          return a.classList.contains('on');
        });
      glide(nav, changed && !reduce);
      if ((!changed && !first) || reduce) {
        lastIdx = idx;
        return;
      }
      var main = document.getElementById('main');
      if (!main) return;
      main.style.setProperty('--dir', idx >= 0 && lastIdx >= 0 && idx < lastIdx ? -1 : 1);
      lastIdx = idx;
      var i = 0;
      main
        .querySelectorAll('.tabs, .ph, .banner, .kpis > *, .grid > *, #main > .card, .content > .card, .tbl tbody tr')
        .forEach(function (el) {
          if (el.closest('.tbl') && i > 14) return; // long tables: only the first rows take part
          el.style.setProperty('--d', Math.min(i++, 14));
          el.classList.add('lof-enter');
        });
      main.querySelectorAll('.kpi .v').forEach(countUp);
    } catch (e) {
      /* motion is decoration only */
    }
  };
})();

// ------------------------------------------------------------------ appreciation (LOF style guide, like the Hub's XP award)
// A short celebration card – rocket lift-off, progress ring, count-up and stardust – when a student is enrolled, and a
// bigger one when a counsellor reaches the monthly enrolment target or a receptionist reaches the monthly collections
// target. Click or wait ~2.5 s to close; a "+1" chip then flies to the user's avatar. Reduced motion: a toast instead.
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = 263.9,
    layer = null,
    queue = [],
    busy = false;
  var ROCKET =
    '<svg class="xc-rocket" viewBox="0 0 60 122" aria-hidden="true"><path d="M30 4C42 16 46 34 46 56v28H14V56C14 34 18 16 30 4z"/><circle cx="30" cy="42" r="7"/><path d="M14 70h32M14 62 4 84v12l10-8M46 62l10 22v12l-10-8M22 84l2 8h12l2-8M26 98l-2 14M30 98v20M34 98l2 14"/></svg>';
  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }
  function countTo(el, from, to, dur, f) {
    var s = performance.now();
    (function step(t) {
      var p = Math.min((t - s) / dur, 1),
        e = 1 - Math.pow(1 - p, 3);
      el.textContent = (f || fmt)(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(s);
  }
  function stardust(canvas, cx, cy, big) {
    var dpr = window.devicePixelRatio || 1,
      ctx = canvas.getContext('2d');
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = ['#D53A28', '#D53A28', '#E8604F', '#3A66C4', '#7BA2EA', '#FFFFFF'];
    var parts = [];
    for (var i = 0; i < (big ? 160 : 90); i++) {
      var a = Math.random() * Math.PI * 2,
        sp = 3 + Math.random() * (big ? 9 : 7);
      parts.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.2,
        r: 1 + Math.random() * 2.2,
        c: colors[i % colors.length],
        streak: Math.random() < 0.35,
        life: 1,
        decay: 0.01 + Math.random() * 0.012,
      });
    }
    (function frame() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      var alive = 0;
      parts.forEach(function (p) {
        if (p.life <= 0) return;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.955;
        p.vy = p.vy * 0.955 + 0.06;
        p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.strokeStyle = ctx.fillStyle = p.c;
        if (p.streak) {
          ctx.lineWidth = p.r * 0.9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }
  // o: { label, num, numFrom, unit, title, sub, from, to (ring %), ringText, big, chip }
  function show(o) {
    if (reduceMotion) {
      toast(o.label + ' – ' + o.title, 'ok');
      next();
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'xc-layer';
      layer.innerHTML =
        '<div class="xc-scrim"></div><canvas class="xc-dust"></canvas><div class="xc-card" role="status" aria-live="polite">' +
        ROCKET +
        '<div class="xc-ring"><svg viewBox="0 0 96 96"><circle class="t" cx="48" cy="48" r="42"/><circle class="f" cx="48" cy="48" r="42"/></svg><b class="xc-pct"></b></div>' +
        '<div class="xc-label"></div><div class="xc-amount"><span class="xc-pre"></span><span class="xc-num">0</span><small class="xc-unit"></small></div><div class="xc-sub"></div></div>';
      document.body.appendChild(layer);
    }
    var L = layer,
      ring = L.querySelector('.f');
    L.classList.toggle('big', !!o.big);
    L.querySelector('.xc-label').textContent = o.label;
    L.querySelector('.xc-pre').textContent = o.pre || '';
    L.querySelector('.xc-unit').textContent = o.unit || '';
    L.querySelector('.xc-sub').innerHTML =
      '<div style="font-weight:600;color:#fff">' +
      esc(o.title) +
      '</div>' +
      (o.sub ? '<div style="margin-top:2px">' + esc(o.sub) + '</div>' : '');
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = C * (1 - o.from / 100);
    var pctEl = L.querySelector('.xc-pct');
    pctEl.textContent = o.ringText ? '' : Math.round(o.from) + '%';
    L.querySelector('.xc-num').textContent = fmt(o.numFrom || 0);
    L.classList.remove('on', 'out');
    void L.offsetWidth;
    L.classList.add('on');
    setTimeout(function () {
      ring.style.transition = '';
      ring.style.strokeDashoffset = C * (1 - Math.min(100, o.to) / 100);
      countTo(L.querySelector('.xc-num'), o.numFrom || 0, o.num, 650);
      if (o.ringText) pctEl.textContent = o.ringText;
      else {
        var s0 = performance.now();
        (function step(t) {
          var p = Math.min((t - s0) / 1200, 1),
            e = 1 - Math.pow(1 - p, 3);
          pctEl.textContent = Math.round(o.from + (Math.min(100, o.to) - o.from) * e) + '%';
          if (p < 1) requestAnimationFrame(step);
        })(s0);
      }
      var r = L.querySelector('.xc-card').getBoundingClientRect();
      stardust(L.querySelector('.xc-dust'), r.left + r.width / 2, r.top + 74, o.big);
      if (o.big)
        setTimeout(function () {
          stardust(L.querySelector('.xc-dust'), r.left + r.width / 2, r.top + 74, true);
        }, 700);
    }, 260);
    var done = false,
      timer;
    function close() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      var av = document.querySelector('.shell .avatar');
      if (av && o.chip) {
        var card = L.querySelector('.xc-card').getBoundingClientRect(),
          to = av.getBoundingClientRect();
        var chip = document.createElement('div');
        chip.className = 'xc-fly';
        chip.textContent = o.chip;
        document.body.appendChild(chip);
        var cw = chip.offsetWidth,
          ch = chip.offsetHeight,
          sx = card.left + card.width / 2 - cw / 2,
          sy = card.top + card.height / 2 - ch / 2,
          ex = to.left + to.width / 2 - cw / 2,
          ey = to.top + to.height / 2 - ch / 2;
        chip.style.left = sx + 'px';
        chip.style.top = sy + 'px';
        chip.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            {
              transform: 'translate(' + (ex - sx) * 0.55 + 'px,' + ((ey - sy) * 0.35 - 40) + 'px) scale(1.05)',
              opacity: 1,
              offset: 0.5,
            },
            { transform: 'translate(' + (ex - sx) + 'px,' + (ey - sy) + 'px) scale(.6)', opacity: 0.2 },
          ],
          { duration: 700, easing: 'cubic-bezier(.5,0,.25,1)' },
        ).onfinish = function () {
          chip.remove();
          av.classList.remove('xc-pulse');
          void av.offsetWidth;
          av.classList.add('xc-pulse');
        };
      }
      L.classList.add('out');
      setTimeout(function () {
        L.classList.remove('on', 'out');
        next();
      }, 420);
    }
    timer = setTimeout(close, o.big ? 3400 : 2600);
    L.onclick = close;
  }
  function next() {
    if (queue.length) {
      busy = true;
      show(queue.shift());
    } else busy = false;
  }
  window.lofCelebrate = function (o) {
    queue.push(o);
    if (!busy) next();
  };

  // ---- reception targets (collections recorded by the receptionist, in their branch currency, excluding cancelled)
  function recFor(c, m) {
    return (S.cfg.recTargets || []).find(function (t) {
      return t.c === c && t.m === m;
    });
  }
  function recAch(c, m) {
    var st = S.staff.find(function (s) {
        return s.id === c;
      }),
      cur = st ? brCur(st.branch) : 'AED';
    return r2(
      S.pay
        .filter(function (p) {
          return p.by === c && p.status !== 'Cancelled' && p.cur === cur && String(p.at).slice(0, 7) === m;
        })
        .reduce(function (a, p) {
          return a + (+p.amt || 0);
        }, 0),
    );
  }
  window.recFor = recFor;
  window.recAch = recAch;
  var _cfgTargets = CFG.targets;
  CFG.targets = function () {
    var html = _cfgTargets.apply(this, arguments);
    var m = S.tgtMonth || curMonth(),
      rs = S.staff.filter(function (s) {
        return s.role === 'Reception' && s.status === 'Active';
      });
    var rows =
      rs
        .map(function (s) {
          var t = recFor(s.id, m),
            a = recAch(s.id, m),
            cur = brCur(s.branch);
          return (
            '<tr><td><b>' +
            esc(s.name) +
            '</b><div class="muted xs">' +
            esc(branchName(s.branch)) +
            '</div></td><td><input name="c_' +
            s.id +
            '" type="number" min="0" step="1" value="' +
            (t ? t.col : '') +
            '" aria-label="Collections target ' +
            esc(s.name) +
            '" style="width:120px"> <span class="muted xs">' +
            cur +
            '</span></td>' +
            '<td class="r num">' +
            money(a, cur) +
            ' ' +
            (t && t.col ? achB(a, t.col) : '') +
            '</td></tr>'
          );
        })
        .join('') || '<tr><td colspan="3" class="muted">No active receptionists</td></tr>';
    return (
      html +
      '<div style="height:14px"></div>' +
      card(
        'Reception targets – ' + esc(monthName(m)),
        cfgForm(
          'recTargets',
          '<input type="hidden" name="m" value="' +
            m +
            '"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Receptionist</th><th>Collections target</th><th class="r">Collected</th></tr></thead><tbody>' +
            rows +
            '</tbody></table></div>' +
            '<p class="muted xs">Achievement: payments the receptionist recorded in the month, in their branch currency (cancelled payments excluded). Reaching the target shows an appreciation on their screen.</p>',
          { ok: 'Save reception targets' },
        ),
      )
    );
  };
  SUB.cfg_recTargets = function (d) {
    var m = d.m,
      T = S.cfg.recTargets || (S.cfg.recTargets = []);
    var rs = S.staff.filter(function (s) {
      return s.role === 'Reception' && s.status === 'Active';
    });
    for (var i = 0; i < rs.length; i++) {
      var v = d['c_' + rs[i].id];
      if (v !== '' && v != null && !(+v >= 0)) {
        toast('Check the collections target for ' + rs[i].name, 'err');
        return;
      }
    }
    rs.forEach(function (s) {
      var v = d['c_' + s.id],
        k = T.findIndex(function (t) {
          return t.m === m && t.c === s.id;
        });
      if (v === '' || v == null) {
        if (k >= 0) T.splice(k, 1);
        return;
      }
      var row = { m: m, c: s.id, col: +v };
      if (k >= 0) T[k] = row;
      else T.push(row);
    });
    cfgSave('Reception targets', monthName(m));
  };

  function progName(id) {
    var p = (S.programs || []).find(function (x) {
      return x.id === id;
    });
    return p ? p.name : '';
  }
  function receptionTargetCheck(before) {
    var u = me();
    if (!u || u.role !== 'Reception') return;
    var m = curMonth(),
      t = recFor(u.id, m);
    if (!t || !t.col) return;
    var after = recAch(u.id, m),
      cur = brCur(u.branch);
    if (before < t.col && after >= t.col)
      lofCelebrate({
        big: 1,
        label: 'Target achieved',
        pre: '',
        num: after,
        numFrom: before,
        unit: ' ' + cur,
        title: 'Collections target reached for ' + monthName(m),
        sub: money(after, cur) + ' of ' + money(t.col, cur) + ' – brilliant work!',
        from: Math.min(100, (before / t.col) * 100),
        to: 100,
        ringText: '100%',
        chip: 'Target!',
      });
  }

  // ---- student enrolled: from "Complete enrolment"
  var _wizFin = SUB.wizFinish;
  SUB.wizFinish = function (d, f) {
    var n0 = S.enr.length,
      u = me(),
      m = curMonth();
    var ct = u && u.role === 'Counsellor' ? tgtFor(u.id, m) : null,
      a0 = ct ? tgtAch(u.id, m).enr : 0;
    var rb = u && u.role === 'Reception' ? recAch(u.id, m) : 0;
    var r = _wizFin.apply(this, arguments);
    try {
      if (S.enr.length > n0) {
        var e = S.enr[S.enr.length - 1],
          s = stuById(e.stu),
          name = s ? s.first + ' ' + s.last : e.stu;
        if (ct && ct.enr) {
          var a1 = tgtAch(u.id, m).enr;
          lofCelebrate({
            label: 'Enrolment complete',
            pre: '+',
            num: 1,
            unit: ' student',
            title: name + ' – ' + progName(e.prog),
            sub: a1 + ' of ' + ct.enr + ' enrolments this month',
            from: Math.min(100, (a0 / ct.enr) * 100),
            to: (a1 / ct.enr) * 100,
            chip: '+1 enrolment',
          });
          if (a0 < ct.enr && a1 >= ct.enr)
            lofCelebrate({
              big: 1,
              label: 'Target achieved',
              num: a1,
              numFrom: a0,
              unit: ' / ' + ct.enr,
              title: 'Enrolment target reached for ' + monthName(m),
              sub: 'Every enquiry, from first call to first class – brilliant work!',
              from: Math.min(100, (a0 / ct.enr) * 100),
              to: 100,
              ringText: '100%',
              chip: 'Target!',
            });
        } else {
          lofCelebrate({
            label: 'Enrolment complete',
            pre: '+',
            num: 1,
            unit: ' student',
            title: name + ' – ' + progName(e.prog),
            sub: 'Welcome to Lab of Future!',
            from: 0,
            to: 100,
            ringText: '✓',
            chip: '+1 enrolment',
          });
        }
        receptionTargetCheck(rb);
      }
    } catch (x) {
      /* appreciation is decoration only */
    }
    return r;
  };
  // ---- payment recorded at the front desk: celebrate when a receptionist reaches the collections target
  var _payF = SUB.pay;
  SUB.pay = function () {
    var u = me(),
      rb = u && u.role === 'Reception' ? recAch(u.id, curMonth()) : 0,
      n0 = S.pay.length;
    var r = _payF.apply(this, arguments);
    try {
      if (S.pay.length > n0) receptionTargetCheck(rb);
    } catch (x) {
      /* decoration only */
    }
    return r;
  };
})();
