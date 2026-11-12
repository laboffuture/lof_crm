/* Which mode the screens run in. With the server: data comes from /api/v1. With ?demo=1 (or the standalone
 * demo build): the original offline prototype runs on sample data in the browser and nothing is saved. */
window.LOF_API = /[?&]demo=1/.test(location.search) ? null : { base: '/api/v1' };
