/* Fee revisions are one explicit transaction, acknowledged before local state or success changes. */
window.saveFeeChanges = async function (entries, form, what, fingerprint) {
  if (form._feeSaving) return;
  // Reuse the exact transaction if a reply was lost and the user retries unchanged values.
  if (!form._feeAttempt || form._feeAttempt.fingerprint !== fingerprint)
    form._feeAttempt = { fingerprint: fingerprint, changes: entries };
  var changes = form._feeAttempt.changes;
  var button = document.querySelector('button[type="submit"][form="mform"]');
  var error = form.querySelector('[data-fee-error]');
  var label = button && button.textContent;
  form._feeSaving = true;
  form.setAttribute('aria-busy', 'true');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving…';
  }
  try {
    var result = await req('PUT', '/sync', { changes: changes });
    if (!result || !result.ok) throw new Error('The server did not confirm the save. Please retry.');
    mergeDocs(result.docs);
    // Return to the current price rather than a historical row in the all-versions view.
    S.feeF = Object.assign({}, S.feeF, { view: 'current' });
    form._feeAttempt = null;
    if (document.getElementById('mform') === form) closeModal();
    else safeRender();
    toast(what + ' saved', 'ok');
  } catch (e) {
    if (e.message === 'Signed out') return;
    var message = 'Not saved: ' + e.message;
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    toast(message, 'err');
  } finally {
    form._feeSaving = false;
    form.removeAttribute('aria-busy');
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
};
