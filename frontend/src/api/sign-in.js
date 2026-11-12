function signOut(msg) {
  stopLmsPolling();
  timers.forEach(clearInterval);
  timers = [];
  // drop everything the previous user could see before showing the sign-in screen
  S = null;
  S_sel = {};
  Object.keys(snap).forEach(function (k) {
    snap[k] = new Map();
  });
  snapSet = {};
  loginScreen(msg);
}
var pendingPw = null; // kept in memory only between "sign in" and the forced password change
// ---------------- sign-in screens: full-page design with a dark and a light theme (sun/moon switch, top right).
// The chosen theme is stored as lof_theme, the same setting the CRM uses after sign-in.
var BRAND = { name: 'Learning Based', accent: 'CRM', tagline: 'Connect • Learn • Grow' };
var LBI = {
  mail: '<svg class="lb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
  lock: '<svg class="lb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>',
  login:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z"/></svg>',
};
function authTheme() {
  var t = LS.get('lof_theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function lbLogo() {
  return (
    '<img class="lb-logo" src="/logo.png" alt="' +
    esc(BRAND.name + ' ' + BRAND.accent) +
    ' logo" width="48" height="48">'
  );
}
// Left panel: a launch trajectory across a blueprint grid. The four programmes are stops along it and a small
// rocket (from the logo) flies it once on load; after that everything holds still. Reduced motion: final state only.
var LB_STOPS = [
  ['Space and Astronomy', 0.2, 1],
  ['Robotics', 0.4, 1],
  ['Artificial Intelligence', 0.59, -1],
  ['Aerospace', 0.77, -1],
];
var LB_PATH = 'M96 812 C 380 812 560 772 650 612 S 742 262 812 128';
var LB_EASE = [0.22, 0.8, 0.3, 1],
  LB_DUR = 2.6,
  lbPlayed = false;
// Night sky behind the trajectory: stars (kept clear of the logo and headline), a crescent moon, a ringed planet
function lbSky() {
  var seed = 11,
    rnd = function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    },
    s = '';
  for (var n = 0, made = 0; made < 95 && n < 800; n++) {
    var x = rnd() * 900,
      y = rnd() * 900,
      r = rnd();
    if ((x < 660 && y > 150 && y < 400) || (x < 430 && y < 115) || Math.hypot(x - 790, y - 800) < 235) continue;
    made++;
    s +=
      r > 0.93
        ? '<path class="sc-spark" data-x="' +
          x.toFixed(0) +
          '" data-y="' +
          y.toFixed(0) +
          '" d="M' +
          x.toFixed(0) +
          ' ' +
          (y - 7).toFixed(0) +
          'q1 6 7 7q-6 1-7 7q-1-6-7-7q6-1 7-7Z"/>'
        : '<circle class="sc-star" cx="' +
          x.toFixed(1) +
          '" cy="' +
          y.toFixed(1) +
          '" r="' +
          (0.7 + r * 1.4).toFixed(2) +
          '" opacity="' +
          (0.3 + rnd() * 0.6).toFixed(2) +
          '"/>';
  }
  return (
    '<defs><radialGradient id="lbPlanet" cx=".34" cy=".28" r=".8"><stop offset="0" class="sc-pl1"/><stop offset="1" class="sc-pl2"/></radialGradient></defs>' +
    '<g class="sc-sky">' +
    s +
    '</g>' +
    '<g class="sc-moon"><circle cx="520" cy="116" r="17"/><circle class="sc-moon-cut" cx="528" cy="109" r="15"/></g>' +
    '<g class="sc-planet"><ellipse class="sc-ring" cx="790" cy="800" rx="205" ry="40" transform="rotate(-14 790 800)"/>' +
    '<circle cx="790" cy="800" r="118" fill="url(#lbPlanet)"/>' +
    '<path class="sc-ring" d="M585 800 A205 40 0 0 0 995 800" transform="rotate(-14 790 800)"/></g>'
  );
}
function lbScene() {
  return (
    '<svg class="lb-scene" viewBox="0 0 900 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
    '<defs><mask id="lbReveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="900">' +
    '<path class="sc-reveal" pathLength="1" d="' +
    LB_PATH +
    '" fill="none" stroke="#fff" stroke-width="18"/></mask></defs>' +
    lbSky() +
    '<g class="sc-pad"><circle cx="96" cy="812" r="6"/><circle cx="96" cy="812" r="22" fill="none"/><circle cx="96" cy="812" r="40" fill="none"/></g>' +
    '<path id="lbPath" class="sc-path" d="' +
    LB_PATH +
    '" mask="url(#lbReveal)"/>' +
    LB_STOPS.map(function (s, i) {
      return (
        '<g class="sc-stop" id="lbStop' +
        i +
        '"><circle class="sc-halo" r="16"/><circle class="sc-dot" r="6.5"/>' +
        '<text x="' +
        24 * s[2] +
        '" y="5" text-anchor="' +
        (s[2] > 0 ? 'start' : 'end') +
        '">' +
        esc(s[0]) +
        '</text></g>'
      );
    }).join('') +
    '<g id="lbRocket"><g class="sc-rocket" transform="scale(1.25)">' +
    '<path class="sc-flame" d="M-19 0 L-36 -6 L-31 0 L-36 6 Z"/>' +
    '<path class="sc-fin" d="M-13 -6 L-22 -15 L-6 -6 Z M-13 6 L-22 15 L-6 6 Z"/>' +
    '<path class="sc-body" d="M-18 -6.5 H6 C14 -6.5 20 -3 25 0 C20 3 14 6.5 6 6.5 H-18 Z"/>' +
    '<circle class="sc-window" cx="5" cy="0" r="3"/></g>' +
    '<animateMotion id="lbFly" dur="' +
    LB_DUR +
    's" begin="indefinite" fill="freeze" rotate="auto" calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines="' +
    LB_EASE.join(' ') +
    '"><mpath href="#lbPath"/></animateMotion></g>' +
    '</svg>'
  );
}
// Time (0..1) at which the eased flight reaches a given share of the path – stops light up as the rocket passes
function lbTimeAt(share) {
  var a = LB_EASE,
    bz = function (s, p1, p2) {
      var u = 1 - s;
      return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
    };
  for (var k = 0; k <= 200; k++) {
    var s = k / 200;
    if (bz(s, a[1], a[3]) >= share) return bz(s, a[0], a[2]);
  }
  return 1;
}
function lbAnimate(root) {
  var path = root.querySelector('#lbPath'),
    len = path.getTotalLength(),
    rocket = root.querySelector('#lbRocket');
  var reduce = lbPlayed || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  LB_STOPS.forEach(function (s, i) {
    var p = path.getPointAtLength(len * s[1]),
      g = root.querySelector('#lbStop' + i);
    g.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');
    g.style.animationDelay = (lbTimeAt(s[1]) * LB_DUR).toFixed(2) + 's';
  });
  // keep the programme labels clear of stars
  var boxes = LB_STOPS.map(function (s, i) {
    var g = root.querySelector('#lbStop' + i),
      t = g.querySelector('text').getBBox(),
      m = g.transform.baseVal.consolidate().matrix;
    return [m.e + t.x - 12, m.f + t.y - 10, m.e + t.x + t.width + 12, m.f + t.y + t.height + 10];
  });
  Array.prototype.forEach.call(root.querySelectorAll('.sc-star,.sc-spark'), function (st) {
    var x = +(st.getAttribute('cx') || st.getAttribute('data-x')),
      y = +(st.getAttribute('cy') || st.getAttribute('data-y'));
    if (
      boxes.some(function (b) {
        return x > b[0] && x < b[2] && y > b[1] && y < b[3];
      })
    )
      st.parentNode.removeChild(st);
  });
  if (reduce) {
    // final state, no motion: rocket at the end of its flight, trajectory and stops drawn
    root.classList.add('lb-still');
    var a = path.getPointAtLength(len),
      b = path.getPointAtLength(len * 0.99),
      ang = Math.atan2(a.y - b.y, a.x - b.x);
    rocket.removeChild(rocket.querySelector('animateMotion'));
    rocket.setAttribute(
      'transform',
      'translate(' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ') rotate(' + ((ang * 180) / Math.PI).toFixed(1) + ')',
    );
    return;
  }
  lbPlayed = true;
  var fly = root.querySelector('#lbFly');
  if (fly && fly.beginElement) fly.beginElement();
}
function lbStyles() {
  if (document.getElementById('lbStyle')) return;
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap';
  document.head.appendChild(l);
  var st = document.createElement('style');
  st.id = 'lbStyle';
  st.textContent = [
    '.lb-shell{--lb-accent:#087BFF;min-height:100vh;min-height:100dvh;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(460px,1fr);font-family:"Bricolage Grotesque","IBM Plex Sans",system-ui,sans-serif;color:var(--lb-text);background:var(--lb-bg1)}',
    '.lb-left{position:relative;overflow:hidden;isolation:isolate;min-height:100%}',
    '.lb-right{position:relative;display:flex;flex-direction:column;background:var(--lb-bg2);border-left:1px solid var(--lb-border)}',
    '.lb-right .lb-theme{position:absolute;top:28px;right:32px;z-index:1}',
    '.lb-dark{--lb-bg1:#061A3A;--lb-bg2:#08152B;--lb-card:#071B36;--lb-accent2:#00C8F8;--lb-text:#FFFFFF;--lb-muted:#A9B9D2;--lb-border:#263E60;--lb-input:#0A2347;--lb-input-b:#2A4870;--lb-shadow:0 18px 40px rgba(0,6,20,.45);--lb-pill:#0B2447}',
    '.lb-light{--lb-bg1:#F7F9FE;--lb-bg2:#EAF2FF;--lb-card:#FFFFFF;--lb-accent2:#123B82;--lb-text:#10264F;--lb-muted:#687B9F;--lb-border:#D8E2F2;--lb-input:#FFFFFF;--lb-input-b:#D3DEEF;--lb-shadow:0 18px 40px rgba(16,38,79,.10);--lb-pill:#FFFFFF}',
    '.lb-scene{position:absolute;inset:0;width:100%;height:100%;z-index:-1}',
    // blueprint grid (major every 120px, minor every 24px) – the launch pad the trajectory is plotted on
    '.lb-left{background:radial-gradient(ellipse 70% 55% at 88% 100%,var(--lb-glow),transparent 70%),var(--lb-bg1)}',
    '.lb-dark{--lb-glow:rgba(8,123,255,.20);--lb-path:#00C8F8;--lb-ember:#E8543A;--lb-flame:#FFB23E;--lb-rocket:#FFFFFF;--lb-rocket-line:#FFFFFF}',
    '.lb-light{--lb-glow:rgba(8,123,255,.10);--lb-path:#087BFF;--lb-ember:#E2492E;--lb-flame:#F59E0B;--lb-rocket:#FFFFFF;--lb-rocket-line:#10264F}',
    '.sc-path{fill:none;stroke:var(--lb-path);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:1 11}',
    '.sc-pad circle{stroke:var(--lb-path);stroke-opacity:.45;stroke-width:1.5}.sc-pad circle:first-child{fill:var(--lb-path);fill-opacity:.8;stroke:none}',
    '.sc-reveal{stroke-dasharray:1;stroke-dashoffset:1;animation:lbDraw 2.6s cubic-bezier(.22,.8,.3,1) forwards}',
    '.sc-stop{opacity:0;animation:lbStop .45s ease-out forwards}',
    '.sc-star{fill:var(--lb-star)}.sc-spark{fill:var(--lb-spark)}.lb-light .sc-sky{opacity:.55}',
    '.sc-moon circle{fill:var(--lb-moon)}.sc-moon .sc-moon-cut{fill:var(--lb-bg1)}',
    '.sc-ring{fill:none;stroke:var(--lb-ring);stroke-width:3}',
    '.lb-dark{--lb-star:#FFFFFF;--lb-spark:#CFE8FF;--lb-moon:#E8EEF8;--lb-ring:rgba(0,200,248,.5)}.lb-dark .sc-pl1{stop-color:#2D6DBA}.lb-dark .sc-pl2{stop-color:#0A2650}',
    '.lb-light{--lb-star:#123B82;--lb-spark:#087BFF;--lb-moon:rgba(18,59,130,.35);--lb-ring:rgba(8,123,255,.4)}.lb-light .sc-pl1{stop-color:#EEF4FE}.lb-light .sc-pl2{stop-color:#9FBDEA}',
    '.sc-dot{fill:var(--lb-ember)}.sc-halo{fill:var(--lb-ember);fill-opacity:.18}',
    '.sc-stop text{fill:var(--lb-text);font-family:"Bricolage Grotesque",Inter,sans-serif;font-size:17px;font-weight:600;letter-spacing:-.01em}',
    '.sc-body{fill:var(--lb-rocket);stroke:var(--lb-rocket-line);stroke-width:1.2}.sc-window{fill:#087BFF}.sc-fin{fill:var(--lb-ember)}.sc-flame{fill:var(--lb-flame)}',
    '@keyframes lbDraw{to{stroke-dashoffset:0}}@keyframes lbStop{from{opacity:0;transform-box:fill-box}to{opacity:1}}',
    '.lb-still .sc-reveal{animation:none;stroke-dashoffset:0}.lb-still .sc-stop{animation:none;opacity:1}',
    '@media (prefers-reduced-motion:reduce){.sc-reveal{animation:none;stroke-dashoffset:0}.sc-stop{animation:none;opacity:1}}',
    // headline: the brand's own words, set large over the grid
    '.lb-hero{position:absolute;left:clamp(24px,4.4vw,64px);top:clamp(132px,21%,220px);max-width:min(560px,80%)}',
    '.lb-big{margin:0;font-family:"Bricolage Grotesque",Inter,sans-serif;font-variation-settings:"opsz" 96;font-size:clamp(64px,7.6vw,132px);font-weight:800;line-height:.9;letter-spacing:-.05em;color:var(--lb-text)}',
    '.lb-lede{margin:22px 0 0;max-width:34ch;font-size:17px;line-height:1.5;color:var(--lb-muted)}',
    // header
    '.lb-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;padding:28px 40px;gap:16px}',
    '.lb-brand{display:flex;align-items:center;gap:14px}.lb-logo{width:52px;height:52px;flex:none;object-fit:contain}',
    '.lb-dark .lb-logo{filter:drop-shadow(0 0 1px rgba(255,255,255,.35))}',
    '.lb-name{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--lb-text)}.lb-name b{color:var(--lb-accent);font-weight:800}',
    '.lb-tag{font-size:13px;color:var(--lb-muted);margin-top:4px;letter-spacing:.04em}',
    '.lb-theme{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--lb-pill);border:1px solid var(--lb-border);box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;font:inherit}',
    '.lb-theme span{display:grid;place-items:center;width:34px;height:28px;border-radius:999px;color:var(--lb-muted)}',
    '.lb-theme svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.lb-theme span.on{background:var(--lb-accent);color:#fff}',
    '.lb-theme:focus-visible,.lb-btn:focus-visible,.lb-link:focus-visible,.lb-eye:focus-visible{outline:2px solid var(--lb-accent);outline-offset:2px}',
    // card
    '.lb-main{flex:1;display:flex;align-items:center;justify-content:center;padding:96px clamp(24px,5vw,72px) 40px;box-sizing:border-box}',
    '.lb-card{width:min(100%,440px);box-sizing:border-box;background:var(--lb-card);border:1px solid var(--lb-border);border-radius:20px;box-shadow:var(--lb-shadow);padding:40px 40px 32px;display:flex;flex-direction:column;gap:16px}',
    '.lb-dark .lb-card{border-color:#1E4A85}',
    '.lb-h1{margin:0;font-size:29px;font-weight:800;letter-spacing:-.02em;color:var(--lb-text)}',
    '.lb-sub{margin:-8px 0 0;font-size:15px;color:var(--lb-muted)}',
    '.lb-rule{width:44px;height:3px;border-radius:3px;background:linear-gradient(90deg,var(--lb-accent),var(--lb-accent2));margin:0 0 8px}',
    '.lb-field{position:relative;display:block}',
    '.lb-field input,.lb-card .f input{width:100%;box-sizing:border-box;height:50px;border-radius:12px;border:1px solid var(--lb-input-b);background:var(--lb-input);color:var(--lb-text);font:inherit;font-size:15.5px;padding:0 16px;transition:border-color .15s,box-shadow .15s}',
    '.lb-field input{padding:0 48px 0 46px}',
    '.lb-field input::placeholder,.lb-card .f input::placeholder{color:var(--lb-muted);opacity:.85}',
    '.lb-field input:focus,.lb-card .f input:focus{outline:none;border-color:var(--lb-accent);box-shadow:0 0 0 3px rgba(8,123,255,.22)}',
    '.lb-field .lb-ic{position:absolute;left:15px;top:50%;transform:translateY(-50%);pointer-events:none}',
    '.lb-ic{width:20px;height:20px;fill:none;stroke:var(--lb-muted);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.lb-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:8px;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--lb-muted)}',
    '.lb-eye:hover{color:var(--lb-text)}.lb-eye svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.lb-card .f{display:flex;flex-direction:column;gap:6px}.lb-card .f label{font-size:13.5px;font-weight:600;color:var(--lb-text)}.lb-card .help{color:var(--lb-muted)}',
    '.lb-row{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px}',
    '.lb-check{display:inline-flex;align-items:center;gap:8px;color:var(--lb-muted);cursor:pointer}.lb-check input{width:16px;height:16px;accent-color:var(--lb-accent);margin:0}',
    '.lb-link{color:var(--lb-accent);font-weight:600;text-decoration:none;cursor:pointer;border-radius:4px}.lb-link:hover{text-decoration:underline}',
    '.lb-dark .lb-link{color:#3D9BFF}',
    '.lb-btn{display:flex;align-items:center;justify-content:center;gap:10px;height:50px;width:100%;border:0;border-radius:12px;cursor:pointer;color:#fff;font:inherit;font-size:16.5px;font-weight:600;background:linear-gradient(180deg,#1A86FF,#0870E8);box-shadow:0 6px 16px rgba(8,123,255,.28);transition:filter .15s,transform .05s,box-shadow .15s}',
    '.lb-btn:hover{filter:brightness(1.07);box-shadow:0 8px 20px rgba(8,123,255,.36)}.lb-btn:active{transform:translateY(1px);filter:brightness(.95)}.lb-btn:disabled{opacity:.65;cursor:progress}',
    '.lb-btn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.lb-foot{margin:6px 0 0;text-align:center;font-size:13.5px;color:var(--lb-muted)}',
    '.lb-msg{padding:10px 12px;border-radius:10px;font-size:13.5px;background:rgba(8,123,255,.1);border:1px solid rgba(8,123,255,.3);color:var(--lb-text)}',
    '.lb-err{font-size:13.5px;color:#F04E5E;min-height:0}.lb-err:empty{display:none}.lb-light .lb-err{color:#C62839}',
    '.lb-info{font-size:13px;color:var(--lb-muted);text-align:center}.lb-info:empty{display:none}',
    '.lb-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}',
    '.lb-card .banner{margin:0}',
    // phones / narrow windows: the left panel becomes a short banner above the card
    '@media (max-width:900px){.lb-shell{grid-template-columns:1fr;grid-template-rows:auto 1fr}.lb-left{min-height:88px}.lb-right{border-left:0;border-top:1px solid var(--lb-border)}' +
      '.lb-hero,.lb-scene{display:none}.lb-right .lb-theme{top:-68px;right:16px}.lb-main{align-items:flex-start;padding:28px 16px 32px}.lb-top{padding:20px 16px}.lb-name{font-size:21px}.lb-logo{width:40px;height:40px}.lb-card{padding:32px 24px 26px}}',
    '@media (max-width:420px){.lb-tag{display:none}.lb-h1{font-size:25px}}',
    '@media (prefers-reduced-motion:reduce){.lb-shell *{transition:none!important}}',
  ].join('\n');
  document.head.appendChild(st);
}
function authShell(cardHtml) {
  lbStyles();
  var t = authTheme();
  document.documentElement.dataset.theme = t;
  document.getElementById('app').innerHTML =
    // Split screen: left = branding over the library scene, right = solid panel with the sign-in card
    '<div class="lb-shell lb-' +
    t +
    '" id="lbRoot">' +
    '<section class="lb-left">' +
    lbScene() +
    '<header class="lb-top"><div class="lb-brand">' +
    lbLogo() +
    '<div><div class="lb-name">' +
    esc(BRAND.name) +
    ' <b>' +
    esc(BRAND.accent) +
    '</b></div><div class="lb-tag">' +
    esc(BRAND.tagline) +
    '</div></div></div></header>' +
    '<div class="lb-hero"><p class="lb-big">Be curious.</p>' +
    '<p class="lb-lede">Enquiries, admissions, enrolments and payments for every centre, in one place.</p></div>' +
    '</section>' +
    '<section class="lb-right">' +
    '<button type="button" class="lb-theme" id="lbTheme" role="switch" aria-checked="' +
    (t === 'dark') +
    '" aria-label="Dark theme">' +
    '<span class="' +
    (t === 'light' ? 'on' : '') +
    '">' +
    LBI.sun +
    '</span><span class="' +
    (t === 'dark' ? 'on' : '') +
    '">' +
    LBI.moon +
    '</span></button>' +
    '<main class="lb-main">' +
    cardHtml +
    '</main></section></div>';
  lbAnimate(document.getElementById('lbRoot'));
  document.getElementById('lbTheme').addEventListener('click', function () {
    var root = document.getElementById('lbRoot'),
      dark = !root.classList.contains('lb-dark');
    root.classList.toggle('lb-dark', dark);
    root.classList.toggle('lb-light', !dark);
    var spans = this.querySelectorAll('span');
    spans[0].classList.toggle('on', !dark);
    spans[1].classList.toggle('on', dark);
    this.setAttribute('aria-checked', String(dark));
    LS.set('lof_theme', dark ? 'dark' : 'light'); // the CRM opens in the same theme after sign-in
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  });
}
function authCard(sub, msg, inner, btn, foot) {
  authShell(
    '<form id="lofAuth" class="lb-card" novalidate>' +
      '<h1 class="lb-h1">' +
      esc(sub) +
      '</h1><div class="lb-rule"></div>' +
      (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') +
      inner +
      '<div class="lb-err" id="lofErr" role="alert"></div>' +
      '<button class="lb-btn" type="submit">' +
      LBI.login +
      '<span>' +
      esc(btn) +
      '</span></button>' +
      (foot ? '<div class="lb-foot">' + foot + '</div>' : '') +
      '</form>',
  );
  var f = document.getElementById('lofAuth');
  var first = f.querySelector('input:not([type=hidden])');
  if (first) first.focus();
  return f;
}
function onSubmit(f, fn) {
  f.addEventListener(
    'submit',
    function (e) {
      e.preventDefault();
      e.stopPropagation();
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      Promise.resolve(fn(Object.fromEntries(new FormData(f).entries()), document.getElementById('lofErr')))
        .catch(function (x) {
          document.getElementById('lofErr').textContent = x.message;
        })
        .then(function () {
          if (document.body.contains(btn)) btn.disabled = false;
        });
    },
    true,
  );
}
function afterAuth(stage) {
  if (stage === 'password_change' || stage === 'mfa_setup') stageScreen(stage);
  else start();
}
function loginScreen(msg, needCode, remembered) {
  var f;
  if (needCode) {
    f = authCard(
      'Two-step verification',
      msg || 'Enter the 6-digit code from your authenticator app.',
      '<input type="hidden" name="email" value="' +
        esc(remembered.email) +
        '"><input type="hidden" name="password" value="' +
        esc(remembered.password) +
        '">' +
        '<div class="f"><label for="lc">Verification code</label><input id="lc" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required></div>',
      'Verify and Sign In',
      '',
    );
  } else {
    // Remember Me keeps only the e-mail address on this device – never the password
    var saved = LS.get('lof_login_email') || '';
    authShell(
      '<form id="lofAuth" class="lb-card" novalidate>' +
        '<h1 class="lb-h1">Welcome Back!</h1><p class="lb-sub">Sign in to continue your learning journey</p><div class="lb-rule"></div>' +
        (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') +
        '<div class="lb-field"><label for="le" class="lb-sr">Email Address</label>' +
        LBI.mail +
        '<input id="le" name="email" type="email" autocomplete="username" placeholder="Email Address" required value="' +
        esc(saved) +
        '"></div>' +
        '<div class="lb-field"><label for="lp" class="lb-sr">Password</label>' +
        LBI.lock +
        '<input id="lp" name="password" type="password" autocomplete="current-password" placeholder="Password" required>' +
        '<button type="button" class="lb-eye" id="lbEye" aria-label="Show password" aria-pressed="false">' +
        LBI.eye +
        '</button></div>' +
        '<div class="lb-row"><label class="lb-check"><input type="checkbox" name="remember" id="lbRemember"' +
        (saved ? ' checked' : '') +
        '><span>Remember Me</span></label>' +
        '<a href="#" class="lb-link" id="linkForgotPw">Forgot Password?</a></div>' +
        '<div class="lb-err" id="lofErr" role="alert"></div>' +
        '<button class="lb-btn" type="submit">' +
        LBI.login +
        '<span>Sign In</span></button>' +
        '<div class="lb-info" id="lbInfo" role="status" aria-live="polite"></div>' +
        '<p class="lb-foot">Don’t have an account? <a href="#" class="lb-link" id="lbContact">Contact Administrator</a></p>' +
        '</form>',
    );
    f = document.getElementById('lofAuth');
    (saved ? document.getElementById('lp') : document.getElementById('le')).focus();
    var info = document.getElementById('lbInfo');
    document.getElementById('lbEye').addEventListener('click', function () {
      var pw = document.getElementById('lp'),
        show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      this.innerHTML = show ? LBI.eyeOff : LBI.eye;
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    document.getElementById('linkForgotPw').addEventListener('click', function (e) {
      e.preventDefault();
      forgotPasswordScreen('', document.getElementById('le').value.trim());
    });
    document.getElementById('lbContact').addEventListener('click', function (e) {
      e.preventDefault();
      info.textContent =
        'Accounts are created by your System Administrator (Settings → Staff & Users). Please contact them to get access.';
    });
  }

  onSubmit(f, function (d) {
    return req('POST', '/auth/login', { email: d.email, password: d.password, code: d.code }).then(function (r) {
      if (!needCode) LS.set('lof_login_email', d.remember ? String(d.email || '').trim() : null);
      if (r.mfaRequired) return loginScreen('', true, { email: d.email, password: d.password });
      pendingPw = r.stage === 'password_change' ? d.password : null;
      afterAuth(r.stage);
    });
  });
}

function forgotPasswordScreen(msg, emailPrefill) {
  var foot =
    '<a href="javascript:void(0)" id="linkBackToLogin" style="font-size:12.5px;color:var(--muted,#64748b);text-decoration:none;cursor:pointer">← Back to Sign In</a>';

  var f = authCard(
    'Self-Service Password Reset',
    msg || 'Enter your registered work e-mail address. We will verify your account and provide a 6-digit reset code.',
    '<div class="f"><label for="fpe">Work E-mail</label><input id="fpe" name="email" type="email" autocomplete="email" placeholder="name@example.com" value="' +
      esc(emailPrefill || '') +
      '" required autofocus></div>',
    'Send Verification Code',
    foot,
  );

  var backLink = document.getElementById('linkBackToLogin');
  if (backLink) {
    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      loginScreen();
    });
  }

  onSubmit(f, function (d, err) {
    var email = (d.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 0) {
      err.textContent = 'Please enter a valid work e-mail address.';
      return;
    }
    return req('POST', '/auth/forgot-password/request', { email: email }).then(function (res) {
      confirmResetPasswordScreen(email, res.message, res.devCode);
    });
  });
}

function confirmResetPasswordScreen(email, msg, devCode) {
  var foot =
    '<div style="display:flex;justify-content:space-between;font-size:12px">' +
    '<a href="javascript:void(0)" id="linkResend" style="color:var(--accent,#2563eb);text-decoration:none;cursor:pointer">Resend code</a>' +
    '<a href="javascript:void(0)" id="linkBackToLogin2" style="color:var(--muted,#64748b);text-decoration:none;cursor:pointer">Back to Sign In</a>' +
    '</div>';

  var devBanner = devCode
    ? '<div class="banner" style="margin:0;background:var(--ok-bg,#ecfdf5);color:var(--ok,#059669);border:1px solid var(--ok);font-size:12px">' +
      '<b>Verification Code:</b> <span class="mono" style="font-weight:700;font-size:14px;letter-spacing:1px">' +
      esc(devCode) +
      '</span><br>' +
      '<span class="xs" style="opacity:0.9">In development / testing mode, the code is provided directly here.</span></div>'
    : '';

  var f = authCard(
    'Set New Password',
    msg || 'A verification code has been sent for ' + esc(email) + '.',
    devBanner +
      '<input type="hidden" name="email" value="' +
      esc(email) +
      '">' +
      '<div class="f"><label for="rpc">6-Digit Verification Code</label><input id="rpc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="e.g. 123456" pattern="[0-9]{6}" required value="' +
      esc(devCode || '') +
      '"></div>' +
      '<div class="f"><label for="rpn">New Password</label><input id="rpn" name="next" type="password" autocomplete="new-password" placeholder="At least 10 characters" required></div>' +
      '<div class="f"><label for="rpn2">Confirm New Password</label><input id="rpn2" name="next2" type="password" autocomplete="new-password" placeholder="Re-enter new password" required>' +
      '<div class="help" style="margin-top:4px">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
    'Reset Password',
    foot,
  );

  var resendLink = document.getElementById('linkResend');
  if (resendLink) {
    resendLink.addEventListener('click', function (e) {
      e.preventDefault();
      req('POST', '/auth/forgot-password/request', { email: email })
        .then(function (res) {
          confirmResetPasswordScreen(email, 'New verification code sent.', res.devCode);
          if (typeof toast === 'function') toast('New verification code sent', 'ok');
        })
        .catch(function (err) {
          document.getElementById('lofErr').textContent = err.message;
        });
    });
  }

  var backLink = document.getElementById('linkBackToLogin2');
  if (backLink) {
    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      loginScreen();
    });
  }

  onSubmit(f, function (d, err) {
    if (d.next !== d.next2) {
      err.textContent = 'The passwords do not match';
      return;
    }
    return req('POST', '/auth/forgot-password/confirm', {
      email: d.email,
      code: (d.code || '').trim(),
      next: d.next,
    }).then(function (res) {
      loginScreen(res.message || 'Password successfully reset! Please sign in with your new password.');
      if (typeof toast === 'function') toast('Password reset successfully', 'ok');
    });
  });
}
function stageScreen(stage, msg) {
  timers.forEach(clearInterval);
  if (stage === 'password_change') {
    var f = authCard(
      'Choose a new password',
      msg || 'Your password must be changed before you continue.',
      (pendingPw
        ? ''
        : '<div class="f"><label for="lp0">Current password</label><input id="lp0" name="current" type="password" autocomplete="current-password" required></div>') +
        '<div class="f"><label for="lp1">New password</label><input id="lp1" name="next" type="password" autocomplete="new-password" required></div><div class="f"><label for="lp2">Repeat new password</label><input id="lp2" name="next2" type="password" autocomplete="new-password" required><div class="help">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
      'Save and continue',
    );
    onSubmit(f, function (d, err) {
      if (d.next !== d.next2) {
        err.textContent = 'The passwords do not match';
        return;
      }
      return req('POST', '/auth/change-password', { current: pendingPw || d.current, next: d.next }).then(function (r) {
        pendingPw = null;
        afterAuth(r.stage);
      });
    });
    return;
  }
  // Two-step verification setup
  authCard('Set up two-step verification', 'Loading…', '', 'Turn on');
  req('POST', '/auth/mfa/setup')
    .then(function (r) {
      var qrImg = '';
      try {
        if (window.qrcode) {
          var q = window.qrcode(0, 'M');
          q.addData(r.otpauth);
          q.make();
          qrImg =
            '<img alt="QR code for your authenticator app" src="' +
            q.createDataURL(5, 8) +
            '" style="width:200px;height:200px;align-self:center;image-rendering:pixelated;background:#fff;border-radius:6px">';
        }
      } catch (e) {}
      var f = authCard(
        'Set up two-step verification',
        msg ||
          'Your role requires a verification code at sign-in. Scan the QR code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code.',
        qrImg +
          '<div class="f"><label for="ms">Or enter this setup key</label><input id="ms" readonly value="' +
          esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) +
          '" class="mono"></div><div class="f"><label for="mc">6-digit code</label><input id="mc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>',
        'Turn on and continue',
      );
      onSubmit(f, function (d) {
        return req('POST', '/auth/mfa/enable', { code: d.code }).then(function () {
          start();
        });
      });
    })
    .catch(function (e) {
      authCard('Two-step verification', e.message, '', 'Retry');
    });
}
