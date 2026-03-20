'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

function showScreen(name) {
  ['screenLogin', 'screenAdmin', 'screenMain'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = id === name ? 'flex' : 'none';
  });
}

function showErr(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function hideErr(el)       { el.style.display = 'none'; }
function showOk(el, msg)   { el.textContent = msg; el.style.display = 'block'; }

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function setSession(val) {
  try { await chrome.storage.session.set({ loggedIn: val }); } catch {}
}
async function getSession() {
  try { const r = await chrome.storage.session.get('loggedIn'); return !!r.loggedIn; } catch { return false; }
}

// ════════════════════════════════════════════════════════════════════════════
//  GitHub Gist — pobieranie hasha (bez tokena, publiczny odczyt secret gista)
// ════════════════════════════════════════════════════════════════════════════
async function fetchPasswordHash() {
  const gistId  = SCRAPER_CONFIG.GIST_ID;
  const gistFile = SCRAPER_CONFIG.GIST_FILE;

  if (!gistId || gistId === 'WPISZ_ID_GISTA_TUTAJ') {
    throw new Error('Wtyczka nie jest skonfigurowana. Skontaktuj się z właścicielem.');
  }

  let res;
  try {
    res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
  } catch {
    throw new Error('Brak połączenia z internetem. Sprawdź sieć i spróbuj ponownie.');
  }

  if (res.status === 404) {
    throw new Error(`Gist nie znaleziony (ID: ${gistId.slice(0,8)}…). Właściciel musi sprawdzić config.js.`);
  }
  if (res.status === 403) {
    throw new Error('Przekroczono limit GitHub API. Spróbuj za chwilę.');
  }
  if (!res.ok) {
    throw new Error(`Błąd serwera GitHub (${res.status}). Spróbuj ponownie.`);
  }

  const data = await res.json();
  const fileNames = Object.keys(data.files);

  // Find the config file — exact match first, then case-insensitive fallback
  let file = data.files[gistFile];
  if (!file) {
    const found = fileNames.find(n => n.toLowerCase() === gistFile.toLowerCase());
    if (found) file = data.files[found];
  }

  if (!file) {
    throw new Error(
      `Nie znaleziono pliku "${gistFile}" w Gist.\n` +
      `Pliki w Gist: ${fileNames.join(', ') || '(brak)'}`
    );
  }

  let content = file.content;
  if (file.truncated) {
    const raw = await fetch(file.raw_url);
    content = await raw.text();
  }

  let config = {};
  try { config = JSON.parse(content || '{}'); } catch {
    throw new Error('Plik w Gist zawiera nieprawidłowy JSON. Sprawdź jego zawartość.');
  }

  if (!config.passwordHash) {
    throw new Error('Hasło nie zostało jeszcze ustawione. Właściciel musi je skonfigurować przez panel admina.');
  }

  return { hash: config.passwordHash, version: config.version || null, downloadUrl: config.downloadUrl || null };
}

// ════════════════════════════════════════════════════════════════════════════
//  GitHub Gist — aktualizacja (wymaga tokena właściciela)
// ════════════════════════════════════════════════════════════════════════════
async function updateGist(token, newHash) {
  const gistId = SCRAPER_CONFIG.GIST_ID;
  const content = JSON.stringify({
    passwordHash: newHash,
    updatedAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
  }, null, 2);

  // GitHub akceptuje zarówno "token ghp_..." jak i "Bearer github_pat_..."
  const authHeader = token.startsWith('github_pat_')
    ? `Bearer ${token}`
    : `token ${token}`;

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ files: { [SCRAPER_CONFIG.GIST_FILE]: { content } } }),
  });

  if (res.status === 401) {
    throw new Error(
      'Nieprawidłowy token GitHub.\n' +
      'Upewnij się że używasz Classic Token (ghp_...) z uprawnieniem "gist".\n' +
      'Fine-grained tokens NIE obsługują Gistów.'
    );
  }
  if (res.status === 403) {
    throw new Error('Token nie ma uprawnień do edycji Gistów. Wygeneruj nowy token z uprawnieniem "gist".');
  }
  if (res.status === 404) {
    throw new Error('Gist nie znaleziony. Sprawdź GIST_ID w config.js.');
  }
  if (!res.ok) {
    throw new Error(`Błąd GitHub API: ${res.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  UPDATE CHECKER
// ════════════════════════════════════════════════════════════════════════════
function checkUpdate(version, downloadUrl) {
  if (!version) return;
  const current = chrome.runtime.getManifest().version;
  const pa = current.split('.').map(Number);
  const pb = String(version).split('.').map(Number);
  let newer = false;
  for (let i = 0; i < 3; i++) { const d = (pb[i]||0) - (pa[i]||0); if (d > 0) { newer = true; break; } if (d < 0) break; }
  if (!newer) return;
  const banner = $('updateBanner');
  $('updateVersion').textContent = `v${version}`;
  if (downloadUrl) $('updateLink').href = downloadUrl;
  else $('updateLink').style.display = 'none';
  banner.style.display = 'flex';
}

// ════════════════════════════════════════════════════════════════════════════
//  SCREEN: LOGIN
// ════════════════════════════════════════════════════════════════════════════
function initLogin() {
  showScreen('screenLogin');
  const loginError   = $('loginError');
  const loginForm    = $('loginForm');
  const loginSpinner = $('loginSpinner');
  const passInput    = $('loginPassword');

  // Pokaż/ukryj hasło
  $('btnEye').addEventListener('click', () => {
    passInput.type = passInput.type === 'password' ? 'text' : 'password';
  });

  // Ukryty panel admina — kliknij 5x w logo
  let logoClicks = 0;
  document.querySelector('#screenLogin .auth-logo').addEventListener('click', () => {
    logoClicks++;
    if (logoClicks >= 5) { logoClicks = 0; $('adminHint').style.display = 'block'; }
  });

  $('btnShowAdmin').addEventListener('click', () => initAdmin());

  $('btnLogin').addEventListener('click', doLogin);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  passInput.focus();

  async function doLogin() {
    hideErr(loginError);
    const pass = passInput.value;
    if (!pass) return showErr(loginError, 'Podaj hasło.');

    $('btnLogin').disabled = true;
    loginForm.style.display = 'none';
    loginSpinner.style.display = 'flex';

    try {
      const { hash, version, downloadUrl } = await fetchPasswordHash();
      const inputHash = await sha256(pass);

      if (inputHash !== hash) throw new Error('Nieprawidłowe hasło.');

      await setSession(true);
      passInput.value = '';
      await initMain();
      checkUpdate(version, downloadUrl);

    } catch (e) {
      loginForm.style.display = 'flex';
      loginSpinner.style.display = 'none';
      showErr(loginError, e.message);
    } finally {
      $('btnLogin').disabled = false;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SCREEN: ADMIN (tylko właściciel)
// ════════════════════════════════════════════════════════════════════════════
function initAdmin() {
  showScreen('screenAdmin');
  $('adminGistId').textContent = SCRAPER_CONFIG.GIST_ID || '(nie ustawiono)';

  // Wypełnij zapisany token
  chrome.storage.local.get('ownerToken').then(r => {
    if (r.ownerToken) $('adminToken').value = r.ownerToken;
  });

  $('btnAdminBack').addEventListener('click', () => initLogin());

  $('btnAdminSave').addEventListener('click', async () => {
    const adminError = $('adminError');
    const adminOk    = $('adminOk');
    hideErr(adminError); adminOk.style.display = 'none';

    const token  = $('adminToken').value.trim();
    const pass   = $('adminNewPass').value;
    const pass2  = $('adminNewPass2').value;

    if (!token)           return showErr(adminError, 'Podaj GitHub Personal Access Token.');
    if (pass.length < 6)  return showErr(adminError, 'Hasło musi mieć co najmniej 6 znaków.');
    if (pass !== pass2)   return showErr(adminError, 'Hasła nie są identyczne.');

    const btn = $('btnAdminSave');
    btn.disabled = true; btn.textContent = 'Aktualizuję Gist…';

    try {
      const newHash = await sha256(pass);
      await updateGist(token, newHash);

      // Zapisz token lokalnie żeby nie wpisywać go za każdym razem
      await chrome.storage.local.set({ ownerToken: token });

      $('adminNewPass').value = '';
      $('adminNewPass2').value = '';
      showOk(adminOk, '✓ Hasło zmienione! Wszystkie wtyczki zostaną zablokowane przy następnym otwarciu.');

    } catch (e) {
      showErr(adminError, e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Ustaw hasło i zablokuj innych ▶';
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SCREEN: MAIN (scraper)
// ════════════════════════════════════════════════════════════════════════════
async function initMain() {
  showScreen('screenMain');

  $('btnDismissUpdate').addEventListener('click', () => { $('updateBanner').style.display = 'none'; });

  $('btnLogout').addEventListener('click', async () => {
    await setSession(false);
    initLogin();
  });

  // ── Scraper UI ─────────────────────────────────────────────────────────────
  const statusBadge          = $('statusBadge');
  const statusMsg            = $('statusMsg');
  const countProducts        = $('countProducts');
  const countPages           = $('countPages');
  const countDupes           = $('countDupes');
  const countParams          = $('countParams');
  const pagesLabel           = $('pagesLabel');
  const progressWrap         = $('progressWrap');
  const progressFill         = $('progressFill');
  const progressLabel        = $('progressLabel');
  const btnStart             = $('btnStart');
  const btnNew               = $('btnNew');
  const btnStop              = $('btnStop');
  const btnExport            = $('btnExport');
  const btnClear             = $('btnClear');
  const btnSelector          = $('btnSelector');
  const btnClearSelector     = $('btnClearSelector');
  const selectorLabel        = $('selectorLabel');
  const btnNextBtnPicker     = $('btnNextBtnPicker');
  const btnClearNextBtn      = $('btnClearNextBtn');
  const nextBtnSelectorLabel = $('nextBtnSelectorLabel');
  const chkInfiniteScroll    = $('chkInfiniteScroll');
  const nextBtnSection       = $('nextBtnSection');
  const nextBtnSelector      = $('nextBtnSelector');
  const delayMin             = $('delayMin');
  const delayMax             = $('delayMax');
  const previewPanel         = $('previewPanel');
  const previewBody          = $('previewBody');
  const previewCount         = $('previewCount');
  const logEntries           = $('logEntries');

  let isScraping = false;
  let selectorModeActive = false;
  let logCollapsed = false;
  let totalDupesSkipped = 0;

  function setStatus(text, type = '') {
    statusBadge.className = 'badge' + (type ? ' ' + type : '');
    statusBadge.textContent = type === 'running' ? 'Scrapuje…' : type === 'done' ? 'Gotowe' : type === 'error' ? 'Błąd' : 'Gotowy';
    statusMsg.textContent = text;
  }

  function addLog(msg, type = '') {
    const now = new Date();
    const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const el  = document.createElement('div');
    el.className = 'log-entry' + (type ? ' ' + type : '');
    el.innerHTML = `<span class="ts">${ts}</span><span class="msg">${msg}</span>`;
    logEntries.prepend(el);
    if (logEntries.children.length > 60) logEntries.lastChild.remove();
  }

  function updateStats(products, pages, params, totalPages = null) {
    countProducts.textContent = products;
    countParams.textContent   = params;
    if (totalPages) {
      countPages.textContent = pages; pagesLabel.textContent = `/ ${totalPages} stron`;
      const pct = Math.round((pages / totalPages) * 100);
      progressWrap.style.display = 'flex'; progressFill.style.width = pct + '%'; progressLabel.textContent = pct + '%';
    } else {
      countPages.textContent = pages; pagesLabel.textContent = 'stron';
      if (isScraping) { progressWrap.style.display = 'flex'; progressFill.style.width = '100%'; progressFill.style.opacity = '0.35'; progressLabel.textContent = '…'; }
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function sendToContent(action, data = {}) {
    const tab = await getActiveTab();
    return chrome.tabs.sendMessage(tab.id, { action, ...data });
  }

  async function loadData() {
    const r = await chrome.storage.local.get(['products', 'pageCount', 'uniqueParams']);
    return { products: r.products || [], pageCount: r.pageCount || 0, uniqueParams: r.uniqueParams || [] };
  }

  function renderPreview(products) {
    if (!products || !products.length) { previewPanel.style.display = 'none'; return; }
    previewPanel.style.display = 'flex';
    const recent = products.slice(-15).reverse();
    previewBody.innerHTML = recent.map(p => {
      const name = (p.nazwa || '').slice(0,35) + ((p.nazwa||'').length > 35 ? '…' : '');
      const cena = p.cena != null ? Number(p.cena).toFixed(2) + ' zł' : '—';
      const id   = p.id_oferty || '—';
      const smart = p.smart === 'tak';
      const days  = p.czas_dostawy != null ? p.czas_dostawy + ' dni' : '—';
      return `<tr><td title="${p.nazwa||''}">${name}</td><td class="num">${cena}</td><td class="num">${id}</td><td class="${smart?'tak':'nie'}">${smart?'✓':'—'}</td><td class="num">${days}</td></tr>`;
    }).join('');
    previewCount.textContent = `Pokazuję ${recent.length} z ${products.length} produktów`;
  }

  async function loadAndRenderPreview() { const { products } = await loadData(); renderPreview(products); }

  // Init stats
  const { products, pageCount, uniqueParams } = await loadData();
  updateStats(products.length, pageCount, uniqueParams.length);
  if (products.length > 0) { btnExport.disabled = false; setStatus(`Masz ${products.length} produktów.`, 'done'); renderPreview(products); }

  const stored = await chrome.storage.local.get(['selectorXPath', 'nextBtnXPath']);
  if (stored.selectorXPath) { selectorLabel.textContent = stored.selectorXPath; selectorLabel.classList.add('active'); btnClearSelector.style.display = 'inline'; }
  if (stored.nextBtnXPath)  { nextBtnSelectorLabel.textContent = stored.nextBtnXPath; nextBtnSelectorLabel.classList.add('active'); btnClearNextBtn.style.display = 'inline'; }

  function setScrapingUI(running) {
    isScraping = running; btnStart.disabled = running; btnNew.disabled = running;
    btnStop.disabled = !running; btnExport.disabled = running;
    progressFill.style.opacity = '1'; progressFill.style.transition = 'width .4s';
    if (!running) { progressFill.style.width = '0%'; progressLabel.textContent = ''; progressWrap.style.display = 'none'; }
  }

  // Selectors
  btnSelector.addEventListener('click', async () => {
    if (selectorModeActive) { selectorModeActive = false; btnSelector.classList.remove('active'); btnSelector.textContent = 'Wybierz'; await sendToContent('stopSelectorMode').catch(()=>{}); return; }
    selectorModeActive = true; btnSelector.classList.add('active'); btnSelector.textContent = 'Anuluj';
    try { await sendToContent('startSelectorMode', { target: 'container' }); window.close(); }
    catch { selectorModeActive = false; btnSelector.classList.remove('active'); btnSelector.textContent = 'Wybierz'; }
  });
  btnClearSelector.addEventListener('click', async () => {
    await chrome.storage.local.remove('selectorXPath');
    await sendToContent('clearSelector', { target: 'container' }).catch(()=>{});
    selectorLabel.textContent = 'Domyślny (cała strona)'; selectorLabel.classList.remove('active'); btnClearSelector.style.display = 'none';
  });
  btnNextBtnPicker.addEventListener('click', async () => {
    if (selectorModeActive) { selectorModeActive = false; btnNextBtnPicker.classList.remove('active'); btnNextBtnPicker.textContent = 'Wybierz'; await sendToContent('stopSelectorMode').catch(()=>{}); return; }
    selectorModeActive = true; btnNextBtnPicker.classList.add('active'); btnNextBtnPicker.textContent = 'Anuluj';
    try { await sendToContent('startSelectorMode', { target: 'nextBtn' }); window.close(); }
    catch { selectorModeActive = false; btnNextBtnPicker.classList.remove('active'); btnNextBtnPicker.textContent = 'Wybierz'; }
  });
  btnClearNextBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('nextBtnXPath');
    await sendToContent('clearSelector', { target: 'nextBtn' }).catch(()=>{});
    nextBtnSelectorLabel.textContent = 'Domyślny (CSS powyżej)'; nextBtnSelectorLabel.classList.remove('active'); btnClearNextBtn.style.display = 'none';
  });

  chkInfiniteScroll.addEventListener('change', () => { nextBtnSection.style.display = chkInfiniteScroll.checked ? 'none' : 'block'; });

  function buildOptions() {
    const mn = parseInt(delayMin.value)||800, mx = parseInt(delayMax.value)||2000;
    return { infiniteScroll: chkInfiniteScroll.checked, nextSelector: nextBtnSelector.value.trim()||'a[data-role="next-page"]', delayMin: Math.min(mn,mx), delayMax: Math.max(mn,mx) };
  }

  btnStart.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab.url || !tab.url.includes('allegro.pl')) { setStatus('Przejdź na allegro.pl!', 'error'); return; }
    setScrapingUI(true); setStatus('Rozpoczynam…', 'running'); addLog('Start', 'ok');
    try { await chrome.tabs.sendMessage(tab.id, { action: 'startScraping', options: buildOptions() }); }
    catch (e) { setStatus('Błąd. Odśwież stronę.', 'error'); addLog('Błąd: '+e.message, 'err'); setScrapingUI(false); }
  });

  btnNew.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab.url || !tab.url.includes('allegro.pl')) { setStatus('Przejdź na allegro.pl!', 'error'); return; }
    await chrome.storage.local.set({ products:[], pageCount:0, uniqueParams:[], seenOfferIds:[] });
    await sendToContent('clearData').catch(()=>{});
    totalDupesSkipped=0; updateStats(0,0,0); countDupes.textContent='0'; btnExport.disabled=true; previewPanel.style.display='none';
    addLog('Dane wyczyszczone — nowe scrapowanie','warn');
    setScrapingUI(true); setStatus('Nowe scrapowanie…','running'); addLog('Start','ok');
    try { await chrome.tabs.sendMessage(tab.id, { action:'startScraping', options:buildOptions() }); }
    catch (e) { setStatus('Błąd: '+e.message,'error'); setScrapingUI(false); }
  });

  btnStop.addEventListener('click', async () => {
    await sendToContent('stopScraping').catch(()=>{});
    setScrapingUI(false); setStatus('Zatrzymano.',''); addLog('Zatrzymano','warn');
    const { products } = await loadData(); if (products.length) btnExport.disabled=false;
  });

  btnExport.addEventListener('click', async () => {
    const { products, uniqueParams } = await loadData();
    if (!products.length) { setStatus('Brak danych.',''); return; }
    setStatus('Generuję XLSX…',''); addLog(`Eksport ${products.length} produktów…`,'');
    try {
      const res = await chrome.runtime.sendMessage({ action:'exportXLSX', products, uniqueParams });
      if (res&&res.ok) { setStatus(`Wyeksportowano ${products.length} produktów.`,'done'); addLog('Eksport OK','ok'); }
      else throw new Error(res?.error||'Błąd');
    } catch (e) { setStatus('Błąd eksportu: '+e.message,'error'); addLog('Błąd: '+e.message,'err'); }
  });

  btnClear.addEventListener('click', async () => {
    if (!confirm('Wyczyścić wszystkie dane?')) return;
    await chrome.storage.local.set({ products:[], pageCount:0, uniqueParams:[], seenOfferIds:[] });
    await sendToContent('clearData').catch(()=>{});
    totalDupesSkipped=0; updateStats(0,0,0); countDupes.textContent='0'; btnExport.disabled=true; previewPanel.style.display='none';
    setStatus('Dane wyczyszczone.',''); addLog('Dane wyczyszczone','warn');
  });

  $('btnRefreshPreview').addEventListener('click', loadAndRenderPreview);

  $('btnToggleLog').addEventListener('click', () => {
    logCollapsed = !logCollapsed;
    logEntries.classList.toggle('collapsed', logCollapsed);
    $('btnToggleLog').textContent = logCollapsed ? '▼' : '▲';
  });

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case 'scrapingProgress':
        updateStats(msg.products, msg.pages, msg.params, msg.totalPages||null);
        totalDupesSkipped += (msg.skipped||0); countDupes.textContent = totalDupesSkipped;
        setStatus(`Strona ${msg.pages}${msg.totalPages?'/'+msg.totalPages:''}: ${msg.products} produktów…`,'running');
        addLog(`Strona ${msg.pages}: +${msg.newOnPage}${msg.skipped?' (dup: '+msg.skipped+')':''}`,'ok');
        if (msg.preview) loadAndRenderPreview();
        break;
      case 'scrapingDone':
        setScrapingUI(false); btnExport.disabled=false;
        updateStats(msg.products, msg.pages, msg.params);
        setStatus(`Gotowe! ${msg.products} produktów z ${msg.pages} stron.`,'done');
        addLog('Scrapowanie zakończone','ok'); loadAndRenderPreview(); break;
      case 'scrapingError':
        setScrapingUI(false); setStatus('Błąd: '+msg.error,'error'); addLog('Błąd: '+msg.error,'err'); break;
      case 'containerSelected':
        selectorModeActive=false; btnSelector.classList.remove('active'); btnSelector.textContent='Wybierz';
        selectorLabel.textContent=msg.xpath||'element'; selectorLabel.classList.add('active'); btnClearSelector.style.display='inline';
        addLog('Kontener: '+(msg.xpath||'element'),'ok'); break;
      case 'nextBtnSelected':
        selectorModeActive=false; btnNextBtnPicker.classList.remove('active'); btnNextBtnPicker.textContent='Wybierz';
        nextBtnSelectorLabel.textContent=msg.xpath||'element'; nextBtnSelectorLabel.classList.add('active'); btnClearNextBtn.style.display='inline';
        addLog('Next btn: '+(msg.xpath||'element'),'ok'); break;
      case 'log': addLog(msg.text, msg.level||''); break;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  const loggedIn = await getSession();
  if (loggedIn) {
    await initMain();
  } else {
    initLogin();
  }
})();
