'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let isScraping = false;
let selectorModeActive = false;
let selectorModeTarget = 'container';
let selectedContainerXPath = null;
let selectedNextBtnXPath = null;
let _hoverEl = null;
let _selectedHighlight = null;
let _nextBtnHighlight = null;
let scrapingOptions = {};
let allProducts = [];
let seenOfferIds = new Set();       // #1 deduplication
let uniqueParamsSet = new Set();
let pageCount = 0;

// ─── Utilities ────────────────────────────────────────────────────────────────
function log(text, level = '') {
  chrome.runtime.sendMessage({ action: 'log', text, level }).catch(() => {});
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min, max) { return sleep(min + Math.random() * (max - min)); }

function getXPath(el) {
  if (!el || el === document.body) return '/html/body';
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE && cur !== document.documentElement) {
    let idx = 1;
    let sib = cur.previousSibling;
    while (sib) { if (sib.nodeType === Node.ELEMENT_NODE && sib.tagName === cur.tagName) idx++; sib = sib.previousSibling; }
    const tag = cur.tagName.toLowerCase();
    parts.unshift(idx > 1 ? `${tag}[${idx}]` : tag);
    cur = cur.parentNode;
  }
  return '/' + parts.join('/');
}

function getElementByXPath(xpath) {
  try {
    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  } catch { return null; }
}

// ─── Element Selector Mode ────────────────────────────────────────────────────
function applyHighlight(el, color, width = '3px') {
  if (el) el.style.outline = `${width} solid ${color}`;
}
function removeHighlight(el) { if (el) el.style.outline = ''; }

function onMouseOver(e) {
  if (_hoverEl && _hoverEl !== _selectedHighlight && _hoverEl !== _nextBtnHighlight) removeHighlight(_hoverEl);
  _hoverEl = e.target;
  if (_hoverEl !== _selectedHighlight && _hoverEl !== _nextBtnHighlight) applyHighlight(_hoverEl, '#4f8ef7', '2px');
}
function onMouseOut() {
  if (_hoverEl && _hoverEl !== _selectedHighlight && _hoverEl !== _nextBtnHighlight) removeHighlight(_hoverEl);
  _hoverEl = null;
}
function onSelectorClick(e) {
  e.preventDefault(); e.stopPropagation();
  const el = e.target;
  const xpath = getXPath(el);
  if (selectorModeTarget === 'nextBtn') {
    if (_nextBtnHighlight) removeHighlight(_nextBtnHighlight);
    _nextBtnHighlight = el;
    applyHighlight(el, '#3ecf8e', '3px');
    selectedNextBtnXPath = xpath;
    chrome.storage.local.set({ nextBtnXPath: xpath });
    stopSelectorMode();
    chrome.runtime.sendMessage({ action: 'nextBtnSelected', xpath }).catch(() => {});
  } else {
    if (_selectedHighlight) removeHighlight(_selectedHighlight);
    _selectedHighlight = el;
    applyHighlight(el, '#ff6b35', '3px');
    selectedContainerXPath = xpath;
    chrome.storage.local.set({ selectorXPath: xpath });
    stopSelectorMode();
    chrome.runtime.sendMessage({ action: 'containerSelected', xpath }).catch(() => {});
  }
}
function startSelectorMode(target = 'container') {
  selectorModeTarget = target; selectorModeActive = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onSelectorClick, true);
  document.body.style.cursor = 'crosshair';
}
function stopSelectorMode() {
  selectorModeActive = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onSelectorClick, true);
  document.body.style.cursor = '';
  if (_hoverEl && _hoverEl !== _selectedHighlight && _hoverEl !== _nextBtnHighlight) removeHighlight(_hoverEl);
}
function clearSelector(target) {
  if (target === 'nextBtn') {
    if (_nextBtnHighlight) { removeHighlight(_nextBtnHighlight); _nextBtnHighlight = null; }
    selectedNextBtnXPath = null;
  } else {
    if (_selectedHighlight) { removeHighlight(_selectedHighlight); _selectedHighlight = null; }
    selectedContainerXPath = null;
  }
}
function restoreHighlights() {
  if (selectedContainerXPath) { const el = getElementByXPath(selectedContainerXPath); if (el) { _selectedHighlight = el; applyHighlight(el, '#ff6b35', '3px'); } }
  if (selectedNextBtnXPath)   { const el = getElementByXPath(selectedNextBtnXPath);   if (el) { _nextBtnHighlight = el;  applyHighlight(el, '#3ecf8e', '3px'); } }
}

// ─── #6 Page total detection ──────────────────────────────────────────────────
function detectTotalPages() {
  // Allegro shows e.g. "1 z 24" or "Strona 1 z 24" near pagination
  const patterns = [
    /strona\s+\d+\s+z\s+(\d+)/i,
    /\d+\s+z\s+(\d+)\s+stron/i,
    /page\s+\d+\s+of\s+(\d+)/i,
  ];
  const paginationEl = document.querySelector('[data-role="pagination"], nav[aria-label*="stronicowania"], nav[aria-label*="paginat"]');
  const searchIn = paginationEl ? paginationEl.textContent : document.body.textContent;
  for (const pat of patterns) {
    const m = searchIn.match(pat);
    if (m) return parseInt(m[1]);
  }
  // Fallback: count numbered page links
  const pageLinks = document.querySelectorAll('[aria-label*="Strona "], [aria-label*="Idź do strony"]');
  if (pageLinks.length > 1) {
    let max = 0;
    pageLinks.forEach(a => { const n = parseInt(a.getAttribute('aria-label')?.match(/\d+/)?.[0] || '0'); if (n > max) max = n; });
    if (max > 0) return max;
  }
  return null;
}

// ─── #5 Price normalization ───────────────────────────────────────────────────
/**
 * Parse price text robustly.
 * Handles: "99,99 zł", "1 299,00 zł", "1.299,00", "1299.99", "99zł", "od 99,99 zł"
 * Returns a float or null.
 */
function parsePrice(text) {
  if (!text) return null;
  // Remove currency symbols and whitespace
  let s = text.replace(/[zł\sPLN€$]/gi, '').replace(/\u00a0/g, '').trim();

  // Remove "od " prefix
  s = s.replace(/^od/i, '').trim();

  // Pattern A: Polish format "1 299,99" or "1299,99" — comma is decimal, space/dot is thousands
  // Pattern B: International "1,299.99" — dot is decimal, comma is thousands
  // We disambiguate by position of comma vs dot

  const commaPos = s.lastIndexOf(',');
  const dotPos   = s.lastIndexOf('.');

  if (commaPos > dotPos) {
    // Comma is last separator → Polish decimal comma
    // Remove all dots (thousands) then replace comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (dotPos > commaPos) {
    // Dot is last separator → international decimal dot
    // Remove all commas (thousands)
    s = s.replace(/,/g, '');
  }
  // else only one separator or none

  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

// ─── #4 Improved element extraction helpers ───────────────────────────────────
function hasText(el, text) {
  return (el.textContent || '').toLowerCase().includes(text.toLowerCase());
}

/**
 * Try multiple selector strategies in order, return first match.
 */
function qFirst(el, ...selectors) {
  for (const sel of selectors) {
    try { const r = el.querySelector(sel); if (r) return r; } catch {}
  }
  return null;
}

/**
 * Find element whose aria-label contains all given terms (case-insensitive).
 */
function qAriaLabel(el, ...terms) {
  const all = el.querySelectorAll('[aria-label]');
  for (const node of all) {
    const label = (node.getAttribute('aria-label') || '').toLowerCase();
    if (terms.every(t => label.includes(t.toLowerCase()))) return node;
  }
  return null;
}

/** Extract numeric ID from Allegro / Allegro Lokalnie URL */
function extractOfferId(url) {
  if (!url) return '';

  // 1. ?offerId=17325336443
  const offerIdMatch = url.match(/[?&]offerId=(\d+)/);
  if (offerIdMatch) return offerIdMatch[1];

  // 2. ?rep=1090004015  (Allegro Lokalnie)
  const repMatch = url.match(/[?&]rep=(\d+)/);
  if (repMatch) return repMatch[1];

  // 3. allegro.pl/events/clicks?...&redirect=<encoded-offer-url>
  //    Decode the redirect param and recurse to extract ID from the real URL
  const redirectMatch = url.match(/[?&]redirect=([^&]+)/);
  if (redirectMatch) {
    try {
      const decoded = decodeURIComponent(redirectMatch[1]);
      if (decoded !== url) return extractOfferId(decoded);
    } catch {}
  }

  // 4. Trailing long numeric ID in path: /oferta/nazwa-produktu-18421832653
  const longMatch = url.match(/-(\d{8,})(?:[/?#]|$)/);
  if (longMatch) return longMatch[1];

  // 5. /oferta/nazwa-1234 (shorter IDs, allegrolokalnie)
  const shortMatch = url.match(/\/oferta\/[^/?#]+-(\d{4,})(?:[/?#]|$)/);
  if (shortMatch) return shortMatch[1];

  return '';
}

/** Convert Polish delivery text to number of days */
function parseDeliveryDays(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('dziś') || lower.includes('dzisiaj')) return 0;
  if (lower.includes('jutro')) return 1;
  const weekdays = { 'poniedziałek': 1, 'wtorek': 2, 'środę': 3, 'środa': 3, 'czwartek': 4, 'piątek': 5, 'sobotę': 6, 'sobota': 6, 'niedzielę': 0, 'niedziela': 0 };
  for (const [name, dayNum] of Object.entries(weekdays)) {
    if (lower.includes(name)) {
      const today = new Date().getDay();
      let diff = (dayNum - today + 7) % 7;
      return diff === 0 ? 7 : diff;
    }
  }
  const za = lower.match(/za\s+(\d+)\s+dni/);      if (za) return parseInt(za[1]);
  const range = lower.match(/(\d+)\s*[–-]\s*\d+\s*dni/); if (range) return parseInt(range[1]);
  const single = lower.match(/(\d+)\s*dni/);         if (single) return parseInt(single[1]);
  return null;
}

// ─── #4 Main extraction function ──────────────────────────────────────────────
function extractProduct(article) {
  const product = {};

  // ── 1 & 2. Nazwa + Link ────────────────────────────────────────────────────
  // Try data-testid first (stable), then h2/h3 anchors (structural), then any prominent link
  const titleAnchor = qFirst(article,
    '[data-testid="listing-item-title"] a',
    '[data-testid*="item-title"] a',
    'h2 a', 'h3 a',
    'a[href*="/oferta/"]',
    'a[href*="/produkt/"]',
  );
  product.nazwa = titleAnchor ? titleAnchor.textContent.trim() : '';
  product.link  = titleAnchor ? titleAnchor.href : '';

  // ── 3. ID oferty ───────────────────────────────────────────────────────────
  product.id_oferty = extractOfferId(product.link);

  // ── 4. Cena (#5 normalized) ────────────────────────────────────────────────
  // Priority: aria-label with "aktualna cena" → any aria-label with price number
  // → data-testid price → visible price text
  let priceText = '';
  const priceByAria = qAriaLabel(article, 'aktualna cena') || qAriaLabel(article, 'cena');
  if (priceByAria) {
    priceText = priceByAria.getAttribute('aria-label') || priceByAria.textContent;
  } else {
    const priceByTestId = qFirst(article,
      '[data-testid="price"]',
      '[data-testid*="price"]',
      '[data-testid*="Price"]',
    );
    if (priceByTestId) {
      priceText = priceByTestId.textContent;
    } else {
      // Last resort: scan spans/ps for Polish price pattern
      for (const el of article.querySelectorAll('span, p, div')) {
        if (/\d[\d\s]*[,.]\d{2}\s*(zł|PLN)/i.test(el.textContent) && el.children.length < 4) {
          priceText = el.textContent; break;
        }
      }
    }
  }
  product.cena = parsePrice(priceText);

  // ── 5. Ocena ───────────────────────────────────────────────────────────────
  const ratingEl = qAriaLabel(article, 'na 5')
    || qAriaLabel(article, 'ocena')
    || qFirst(article, '[data-testid*="rating"]', '[data-testid*="Rating"]', '[aria-label*="gwiazdki"]');
  let rating = null;
  if (ratingEl) {
    const rt = ratingEl.getAttribute('aria-label') || ratingEl.textContent;
    const rm = rt.match(/(\d+[,.]\d+|\d+)/);
    if (rm) rating = parseFloat(rm[1].replace(',', '.'));
  }
  product.ocena = rating;

  // ── 6. Liczba kupujących ───────────────────────────────────────────────────
  const buyersEl = qAriaLabel(article, 'kupiło') || qAriaLabel(article, 'kupiły') || qAriaLabel(article, 'kupił');
  let buyers = null;
  if (buyersEl) {
    const bt = buyersEl.getAttribute('aria-label') || buyersEl.textContent;
    const bm = bt.replace(/\s/g, '').match(/(\d+)/);
    if (bm) buyers = parseInt(bm[1]);
  } else {
    // Walk text nodes
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (/kupiło|kupiły/i.test(node.textContent)) {
        const m = node.textContent.replace(/\s/g, '').match(/(\d+)/);
        if (m) { buyers = parseInt(m[1]); break; }
      }
    }
  }
  product.liczba_kupujacych = buyers;

  // ── 7. Promowane ──────────────────────────────────────────────────────────
  product.promowane = (
    hasText(article, 'promowane') ||
    !!qFirst(article, '[data-testid*="promo"]', '[data-testid*="sponsored"]')
  ) ? 'tak' : 'nie';

  // ── 8. Smart monety ───────────────────────────────────────────────────────
  product.smart_monety = (
    !!qFirst(article, 'img[src*="smart-coins"]', 'img[src*="moneta"]', 'img[alt*="oneta"]') ||
    hasText(article, 'smart! moneta') || hasText(article, 'smart moneta') ||
    !!qAriaLabel(article, 'moneta')
  ) ? 'tak' : 'nie';

  // ── 9. Smart ──────────────────────────────────────────────────────────────
  product.smart = (
    !!qFirst(article, 'img[alt="Smart!"]', 'img[src*="brand-subbrand-smart"]', 'img[src*="smart-badge"]') ||
    !!qAriaLabel(article, 'Allegro Smart')
  ) ? 'tak' : 'nie';

  // ── 10. Raty ─────────────────────────────────────────────────────────────
  product.raty = (
    !!qFirst(article, 'img[alt*="Raty"]', 'img[alt*="raty"]', 'img[src*="installment"]', '[data-testid*="installment"]') ||
    /\d+\s*x\s*\d|rat[ay]/i.test(article.textContent)
  ) ? 'tak' : 'nie';

  // ── 11. Darmowa dostawa ───────────────────────────────────────────────────
  product.darmowa_dostawa = (
    hasText(article, 'darmowa dostawa') ||
    !!qFirst(article, '[data-testid*="free-delivery"]', '[data-testid*="freeDelivery"]') ||
    !!qAriaLabel(article, 'darmowa dostawa')
  ) ? 'tak' : 'nie';

  // ── 13. Czas dostawy ──────────────────────────────────────────────────────
  let deliveryText = '';
  const delivEl = qFirst(article, '[data-testid*="delivery-time"]', '[data-testid*="deliveryTime"]')
    || qAriaLabel(article, 'dostawa');
  if (delivEl) {
    deliveryText = delivEl.getAttribute('aria-label') || delivEl.textContent;
  } else {
    const m = article.textContent.match(/dostawa[^.!?\n]{0,70}/i);
    if (m) deliveryText = m[0];
  }
  product.czas_dostawy = parseDeliveryDays(deliveryText);

  // ── 14. Gwarancja najniższej ceny ─────────────────────────────────────────
  product.gwarancja_ceny = (
    !!qFirst(article, 'img[alt*="Gwarancj"]', 'img[src*="lowest-price"]', 'img[src*="gwarancja"]', '[data-testid*="price-guarantee"]') ||
    hasText(article, 'gwarancja najniższej ceny')
  ) ? 'tak' : 'nie';

  // ── 15. Parametry wpisane ─────────────────────────────────────────────────
  const dlEl = article.querySelector('dl');
  product.parametry_wpisane = dlEl ? 'tak' : 'nie';

  // ── 16+. Dynamic parameters ───────────────────────────────────────────────
  product._params = {};
  if (dlEl) {
    const dts = dlEl.querySelectorAll('dt');
    const dds = dlEl.querySelectorAll('dd');
    dts.forEach((dt, i) => {
      const key = dt.textContent.trim().replace(/:$/, '').trim();
      const val = dds[i] ? dds[i].textContent.trim() : '';
      if (key) product._params[key] = val;
    });
  }

  return product;
}

// ─── Scrape current page ──────────────────────────────────────────────────────
function scrapeCurrentPage() {
  let container = document;
  if (selectedContainerXPath) {
    const el = getElementByXPath(selectedContainerXPath);
    if (el) container = el;
  }

  let articles = container.querySelectorAll('article');
  if (!articles.length) {
    log('Nie znaleziono <article>, próbuję alternatyw…', 'warn');
    // Allegro sometimes wraps items in li/div with data attributes
    const fallback = container.querySelectorAll('[data-testid*="listing-item"], [data-testid*="search-list-item"]');
    if (fallback.length) articles = fallback;
  }

  const products = [];
  articles.forEach(article => {
    try {
      const p = extractProduct(article);
      if (p.nazwa || p.link) products.push(p);
    } catch (e) {
      log('Błąd parsowania: ' + e.message, 'err');
    }
  });
  return products;
}

// ─── Pagination helpers ───────────────────────────────────────────────────────
function findNextLink(options) {
  if (selectedNextBtnXPath) { const el = getElementByXPath(selectedNextBtnXPath); if (el) return el; }
  if (options.nextSelector) { try { const el = document.querySelector(options.nextSelector); if (el) return el; } catch {} }
  return document.querySelector('a[rel="next"]') || null;
}

function getNextHref(el) {
  if (!el) return null;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) return null;
  const href = el.href || el.getAttribute('href');
  if (!href || href === '#' || href === '') return null;
  try { return new URL(href, location.href).href; } catch { return null; }
}

async function infiniteScroll() {
  const prevHeight = document.body.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(1500);
  return document.body.scrollHeight > prevHeight;
}

async function waitForUrlChange(currentUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(300);
    if (location.href !== currentUrl) { await sleep(600); return true; }
  }
  return false;
}

async function waitForArticles(previousFirstId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(300);
    const first = document.querySelector('article');
    if (first) {
      const id = first.querySelector('h2 a, h3 a, a[href*="/oferta/"]')?.href || first.textContent.slice(0, 40);
      if (id !== previousFirstId) return true;
    }
  }
  return false;
}

// ─── Main scraping loop ───────────────────────────────────────────────────────
async function startScraping(options) {
  if (isScraping) return;
  isScraping = true;
  scrapingOptions = options;

  // Load existing state
  const stored = await chrome.storage.local.get(['products', 'uniqueParams', 'pageCount', 'seenOfferIds']);
  allProducts      = stored.products      || [];
  uniqueParamsSet  = new Set(stored.uniqueParams || []);
  pageCount        = stored.pageCount     || 0;
  seenOfferIds     = new Set(stored.seenOfferIds || []);  // #1

  const visitedUrls = new Set();

  try {
    while (isScraping) {
      const currentUrl = location.href;

      if (visitedUrls.has(currentUrl)) {
        log('Już odwiedzono tę stronę – koniec paginacji', 'ok');
        break;
      }
      visitedUrls.add(currentUrl);

      // #6 Detect total pages
      const totalPages = detectTotalPages();

      const pageProducts = scrapeCurrentPage();
      pageCount++;

      // #1 Deduplicate
      let newCount = 0;
      const uniquePageProducts = [];
      pageProducts.forEach(p => {
        const key = p.id_oferty || p.link;
        if (!key || !seenOfferIds.has(key)) {
          if (key) seenOfferIds.add(key);
          uniquePageProducts.push(p);
          newCount++;
        }
      });
      const skipped = pageProducts.length - newCount;
      if (skipped > 0) log(`Pominięto ${skipped} duplikatów na stronie ${pageCount}`, 'warn');

      // Collect params and flatten
      uniquePageProducts.forEach(p => Object.keys(p._params).forEach(k => uniqueParamsSet.add(k)));
      const flatProducts = uniquePageProducts.map(({ _params, ...rest }) => ({ ...rest, ..._params }));
      allProducts.push(...flatProducts);

      // Persist
      await chrome.storage.local.set({
        products:     allProducts,
        uniqueParams: [...uniqueParamsSet],
        pageCount,
        seenOfferIds: [...seenOfferIds],
      });

      // #6 Progress with total pages
      chrome.runtime.sendMessage({
        action:     'scrapingProgress',
        products:   allProducts.length,
        pages:      pageCount,
        totalPages: totalPages,
        params:     uniqueParamsSet.size,
        newOnPage:  newCount,
        skipped,
        // Send last few products for preview
        preview:    flatProducts.slice(-5),
      }).catch(() => {});

      const totalStr = totalPages ? `/${totalPages}` : '';
      log(`Strona ${pageCount}${totalStr}: +${newCount} (duplikaty: ${skipped}, łącznie: ${allProducts.length})`);

      await randomDelay(options.delayMin, options.delayMax);
      if (!isScraping) break;

      // Navigate
      if (options.infiniteScroll) {
        const firstId = document.querySelector('article h2 a, article h3 a')?.href || '';
        const grew = await infiniteScroll();
        if (!grew) { log('Koniec infinite scroll', 'ok'); break; }
        const appeared = await waitForArticles(firstId, 5000);
        if (!appeared) { log('Brak nowych artykułów po scrollu', 'ok'); break; }
      } else {
        const nextEl   = findNextLink(options);
        const nextHref = getNextHref(nextEl);
        if (!nextHref) { log('Brak przycisku "Następna strona" – koniec', 'ok'); break; }
        if (visitedUrls.has(nextHref)) { log('Przycisk wskazuje już odwiedzony URL – koniec', 'ok'); break; }

        log(`Przechodzę do: ${nextHref}`);
        const firstArticleId = document.querySelector('article h2 a, article h3 a')?.href || '';
        nextEl.click();

        const urlChanged = await waitForUrlChange(currentUrl, 15000);
        if (!urlChanged) {
          log('URL nie zmienił się – próbuję bezpośredniej nawigacji', 'warn');
          location.href = nextHref;
          await waitForUrlChange(currentUrl, 15000);
        }
        await waitForArticles(firstArticleId, 10000);
      }
    }
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'scrapingError', error: e.message }).catch(() => {});
    log('Błąd: ' + e.message, 'err');
  }

  isScraping = false;
  chrome.runtime.sendMessage({
    action:   'scrapingDone',
    products: allProducts.length,
    pages:    pageCount,
    params:   uniqueParamsSet.size,
  }).catch(() => {});
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'startSelectorMode': startSelectorMode(msg.target || 'container'); sendResponse({ ok: true }); break;
    case 'stopSelectorMode':  stopSelectorMode(); sendResponse({ ok: true }); break;
    case 'clearSelector':     clearSelector(msg.target || 'container'); sendResponse({ ok: true }); break;
    case 'startScraping':     startScraping(msg.options); sendResponse({ ok: true }); break;
    case 'stopScraping':      isScraping = false; sendResponse({ ok: true }); break;
    case 'clearData':
      allProducts = []; seenOfferIds = new Set(); uniqueParamsSet = new Set(); pageCount = 0;
      sendResponse({ ok: true }); break;
    case 'getStatus': sendResponse({ isScraping, productCount: allProducts.length }); break;
    case 'getPreview':
      sendResponse({ products: allProducts.slice(-20) }); break;
  }
  return true;
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const stored = await chrome.storage.local.get(['selectorXPath', 'nextBtnXPath']);
  if (stored.selectorXPath) selectedContainerXPath = stored.selectorXPath;
  if (stored.nextBtnXPath)  selectedNextBtnXPath   = stored.nextBtnXPath;
  restoreHighlights();
})();
