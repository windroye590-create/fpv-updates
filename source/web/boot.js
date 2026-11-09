// Remain usable if the module graph cannot start; never touch saved data.
(() => {
  const splash = document.querySelector('[data-startup]');
  if (!splash) return;
  let shown = false;
  function recover() {
    if (shown || !splash.isConnected) return;
    shown = true;
    splash.replaceChildren();
    const image = document.createElement('img'); image.src = '/icon.png'; image.alt = '';
    const title = document.createElement('strong'); title.textContent = 'Не вдалося відкрити застосунок';
    const message = document.createElement('small');
    message.textContent = 'Спробуйте повторити запуск. Якщо це не допоможе, завантажте актуальну версію програми. Збережені дані залишаються на цьому ПК.';
    const actions = document.createElement('div'); actions.className = 'actions';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Повторити запуск';
    retry.addEventListener('click', () => location.reload());
    const download = document.createElement('a'); download.textContent = 'Завантажити програму';
    download.href = 'https://github.com/windroye590-create/fpv-updates/releases/latest/download/FPV-Komisiia-PC.exe';
    download.target = '_blank'; download.rel = 'noreferrer';
    actions.append(retry, download); splash.append(image, title, message, actions);
    splash.setAttribute('role', 'alert'); splash.setAttribute('data-startup-error', '');
  }
  window.addEventListener('error', event => {
    if (event.error || (event.target instanceof HTMLScriptElement && event.target.type === 'module')) recover();
  }, true);
  window.addEventListener('unhandledrejection', recover);
  window.addEventListener('lk:startup-failed', recover);
  const timer = setTimeout(recover, 15000);
  new MutationObserver((_, observer) => {
    if (!splash.isConnected) { clearTimeout(timer); observer.disconnect(); }
  }).observe(document.getElementById('app'), {childList:true});
})();
