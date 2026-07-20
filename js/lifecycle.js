// Coordinates browser page lifecycle signals without relying on `unload`, which
// is not guaranteed to fire and prevents back-forward cache use in some browsers.

export function bindPageLifecycle({
  documentTarget = globalThis.document,
  windowTarget = globalThis.window,
  onSave,
  onPageActivity,
  onExit,
}) {
  if (!documentTarget?.addEventListener || !windowTarget?.addEventListener) {
    return () => {};
  }

  let savedWhileHidden = false;
  let pageExitHandled = false;

  const saveOnceWhileHidden = () => {
    if (savedWhileHidden) return;
    savedWhileHidden = Boolean(onSave?.());
  };

  const syncPageActivity = () => {
    const active = documentTarget.visibilityState === 'visible';
    onPageActivity?.(active);
    if (active) savedWhileHidden = false;
    else saveOnceWhileHidden();
  };

  const suspendAndSave = () => {
    onPageActivity?.(false);
    saveOnceWhileHidden();
  };

  const exitPage = () => {
    if (pageExitHandled) return;
    pageExitHandled = true;
    // Some browsers dispatch pagehide without a preceding visibilitychange.
    suspendAndSave();
    onExit?.();
    savedWhileHidden = false;
  };

  const showPage = () => {
    pageExitHandled = false;
    syncPageActivity();
  };

  documentTarget.addEventListener('visibilitychange', syncPageActivity);
  documentTarget.addEventListener('freeze', suspendAndSave);
  windowTarget.addEventListener('blur', suspendAndSave);
  windowTarget.addEventListener('focus', syncPageActivity);
  windowTarget.addEventListener('beforeunload', exitPage);
  windowTarget.addEventListener('pagehide', exitPage);
  windowTarget.addEventListener('pageshow', showPage);
  syncPageActivity();

  return () => {
    documentTarget.removeEventListener('visibilitychange', syncPageActivity);
    documentTarget.removeEventListener('freeze', suspendAndSave);
    windowTarget.removeEventListener('blur', suspendAndSave);
    windowTarget.removeEventListener('focus', syncPageActivity);
    windowTarget.removeEventListener('beforeunload', exitPage);
    windowTarget.removeEventListener('pagehide', exitPage);
    windowTarget.removeEventListener('pageshow', showPage);
  };
}
