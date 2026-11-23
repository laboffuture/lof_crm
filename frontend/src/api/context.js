/* Shared state of the server adapter: API base, local storage wrapper, collection lists. */
var API = window.LOF_API.base;
var LS = {
  get: function (k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set: function (k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch (e) {}
  },
};
// Sessions live in an HttpOnly cookie the page cannot read; remove tokens left by older versions
LS.set('lof_token', null);
var SERVER = { integrations: {}, impersonation: false };
var COLL = {
  branches: 1,
  programs: 1,
  fees: 1,
  discounts: 1,
  staff: 1,
  leads: 1,
  opps: 1,
  students: 1,
  enr: 1,
  pay: 1,
  ms: 1,
  refunds: 1,
  approvals: 1,
  tasks: 1,
  calls: 1,
  comms: 1,
  notifs: 1,
  audit: 1,
};
var SETTINGS = ['cfg', 'perms', 'scope', 'fx', 'hist'];
var EXACT = ['lead', 'opp', 'enr', 'pay', 'student', 'ap', 'rf', 'pd'];
var BLOCK = ['ms', 'task', 'call', 'cm', 'notif', 'audit'];
var p2 = function (n, w) {
  return String(n).padStart(w, '0');
};
var FMT = {
  lead: function (n) {
    return 'LD-26-' + n;
  },
  opp: function (n) {
    return 'OP-26-' + p2(n, 4);
  },
  enr: function (n) {
    return 'EN-26-' + p2(n, 4);
  },
  pay: function (n) {
    return 'PY-26-' + p2(n, 4);
  },
  student: function (n) {
    return 'LOF-26-' + p2(n, 6);
  },
  ap: function (n) {
    return 'AP-26-' + p2(n, 4);
  },
  rf: function (n) {
    return 'RF-26-' + p2(n, 4);
  },
  pd: function (n) {
    return 'PD-' + p2(n, 2);
  },
};
var INTEG_LABEL = {
  website: 'Website',
  meta: 'Meta',
  whatsapp: 'WhatsApp',
  exotel: 'Exotel',
  lms: 'LMS',
  telr: 'Telr',
  razorpay: 'Razorpay',
  erpnext: 'ERPNext',
  gcal: 'Google Calendar',
  email: 'E-mail',
};
