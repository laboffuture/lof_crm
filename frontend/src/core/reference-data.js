/* Fixed reference lists: roles, lead categories and stages, programmes, campaigns. */
/* ====== reference data ====== */
const ROLES = [
  'Counsellor',
  'Centre Administrator',
  'Admissions Head',
  'Reception',
  'Management',
  'System Administrator',
];
const CATS = ['Hot', 'Warm', 'Cold', 'Not Interested', 'No Response'];
const LSTAGES = ['New Lead', 'Contacted', 'Qualified', 'Opportunity'];
const catKind = (c) =>
  ({ Hot: 'crit', Warm: 'warn', Cold: 'info', 'Not Interested': '', 'No Response': 'warn' })[c] || '';
const PROG = [
  ['ROB', 'Robotics', 'STEM', 2400, 'Level 1 Robotics Foundations', 'Level 2 Autonomous Robots'],
  ['AI', 'Artificial Intelligence', 'STEM', 2600, 'AI Explorers', 'Machine Learning Studio'],
  ['COD', 'Coding', 'STEM', 2000, 'Python Starters', 'App & Game Builders'],
  ['SPA', 'Space & Astronomy', 'Space Science', 2200, 'Cosmos Explorers', 'Mission Control & Rockets'],
  ['AER', 'Aeromodelling', 'Aerospace', 2100, 'Flight Basics', 'RC Aircraft Build'],
  ['ELE', 'Electronics', 'STEM', 1900, 'Circuit Basics', 'Embedded Systems'],
  ['IOT', 'IoT', 'STEM', 2300, 'Connected Things', 'Smart Home Lab'],
  ['3DP', '3D Designing & Printing', 'Design', 2000, '3D Design Basics', 'Print & Prototype'],
];
const PNAME = (id) => (S.programs.find((p) => p.id === id) || { name: id }).name;
const SRC_LIST = ['Website', 'Facebook', 'Instagram', 'WhatsApp', 'Manual'];
const CAMPS = [
  'Website Organic',
  'Meta Lead Form – AI Coding',
  'Autumn STEM Open Day',
  'Space Camp Early Bird',
  'Walk-in / Referral',
  'Robotics Fun Weekend',
];
