/* Starts the offline demo (?demo=1). With the server, src/api/start.js starts the app instead. */
/* ====== boot ====== */
function boot() {
  S = seed();
  render();
}
if (!window.LOF_API) boot();
