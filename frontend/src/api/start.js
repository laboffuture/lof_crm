/* Starts the app: checks the session, then signs in or loads data. */
var _closeModal = window.closeModal;
window.closeModal = function () {
  _closeModal();
  if (deferredRender) {
    deferredRender = false;
    render();
  }
};
req('GET', '/auth/me')
  .then(function (r) {
    afterAuth(r.stage);
  })
  .catch(function () {
    loginScreen();
  });
