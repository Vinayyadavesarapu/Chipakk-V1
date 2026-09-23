/**
 * account.js's post-login "?redirect=" handler (checkRedirectAfterAuth) — open-redirect guard, driven through the
 * REAL shipped account.js.
 *
 * BUG THIS GUARDS (found 2026-09-23 during a full-repo security audit, static code reading — not yet seen live
 * since exploitation requires only a crafted link, no server interaction):
 *
 *   The original guard was: (clean.startsWith("/") || clean.endsWith(".html") || clean.startsWith("./")) &&
 *   !clean.startsWith("//") && !clean.includes("://"). Browsers normalize BACKSLASHES to forward slashes when
 *   resolving a URL for navigation (WHATWG URL spec, special schemes), so a value like "/\evil.example/x" or
 *   "\\evil.example/x.html" passes every one of those string checks (it starts with "/" or ends with ".html", and
 *   literally contains no "//" or "://" as plain text) yet still resolves to "//evil.example/..." -- a
 *   protocol-relative navigation off-site. An attacker link like
 *   "https://chipakk.shop/account.html?redirect=/\\evil.example/phish.html" sent to a victim would, immediately
 *   after they type their REAL CHIPAKK password and sign in successfully, silently bounce them to an
 *   attacker-controlled page -- a classic open-redirect / phishing handoff (CWE-601). Fixed by also rejecting any
 *   redirect value that contains a backslash.
 */
const assert = require('assert');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el() {
  return {
    innerHTML: '', textContent: '', value: '', href: '', src: '', disabled: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, click() {}, appendChild() {}, remove() {}
  };
}
/** Like el(), but addEventListener actually records handlers so a test can fire them (form submit). */
function elWithListeners() {
  const base = el();
  const handlers = {};
  base.addEventListener = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  base.dispatch = async (ev, evt) => { for (const fn of (handlers[ev] || [])) await fn(evt); };
  return base;
}
const ACCOUNT_IDS = ['accountAddressContainer', 'accountAvatar', 'accountDashboardContainer', 'accountOrdersList',
  'accountUserDisplayName', 'accountUserEmail', 'accountWishlistGrid', 'addNewAddressBtn', 'addressFormCity',
  'addressFormDefault', 'addressFormError', 'addressFormId', 'addressFormLine1', 'addressFormLine2', 'addressFormName',
  'addressFormPhone', 'addressFormPin', 'addressFormState', 'addressFormType', 'addressModalTitle',
  'authFormsContainer', 'cancelAddressModalBtn', 'closeAddressModalBtn', 'closeTrackModalBtn',
  'customerAddressForm', 'customerAddressModal', 'defaultAddressName', 'forgotPasswordBtn', 'logoutBtn',
  'orderTrackingModal', 'panelSignIn', 'panelSignUp', 'profileDisplayName', 'profileEmail', 'profilePhone',
  'profileUpdateBtn', 'saveAddressModalBtn', 'signInEmail', 'signInError', 'signInForm', 'signInGoogleBtn',
  'signInPassword', 'signInSubmitBtn', 'signUpConfirmPassword', 'signUpEmail', 'signUpError', 'signUpForm',
  'signUpGoogleBtn', 'signUpName', 'signUpPassword', 'signUpSubmitBtn', 'tabBtnSignIn', 'tabBtnSignUp',
  'trackModalAddress', 'trackModalCourier', 'trackModalItems', 'trackModalOrderId', 'trackModalPayment',
  'trackModalStatus', 'trackModalStatusMessage', 'trackModalTotal', 'trackModalTrackingNo'];
function accountElements() {
  const m = {};
  ACCOUNT_IDS.forEach((id) => (m[id] = el()));
  m.signInForm = elWithListeners();
  return m;
}

/** Loads account.js for real with a given ?redirect= query value, submits the real sign-in form with the real
 *  submit handler (which calls the real checkRedirectAfterAuth() on success), and returns the final location.href
 *  the guard decided on. */
async function attemptSignInWithRedirectParam(redirectValue) {
  const elements = accountElements();
  elements.signInEmail.value = 'qa@chipakk.shop';
  elements.signInPassword.value = 'correct-horse-battery-staple';
  const search = '?redirect=' + encodeURIComponent(redirectValue);
  const sf = loadStorefront({
    elements,
    location: { search, href: 'https://chipakk.shop/account.html' + search },
    fetch: async (url) => {
      if (/\/customer\/me/.test(url)) return envelope({ is_admin: false, is_customer: true, customer: { id: 1, email: 'qa@chipakk.shop' } });
      return envelope([]);
    },
    extraScripts: ['account.js']
  });
  // account.js's initAccount() read window.CHIPAKK.auth.signIn live inside the submit handler -- inject a fake
  // successful sign-in the same way the real Firebase wrapper would resolve one.
  sf.window.CHIPAKK.auth.signIn = async () => ({ uid: 'qa-test-uid', email: 'qa@chipakk.shop' });
  await elements.signInForm.dispatch('submit', { preventDefault() {} });
  await sleep(30);
  return sf.window.location.href;
}

(async () => {
  // For a malicious value, the ONLY correct outcome is that checkRedirectAfterAuth never calls
  // window.location.href = ... at all -- so href must stay exactly the original page URL. (It is NOT enough to
  // assert the resulting href "doesn't contain evil-attacker.example": the original attack link itself is
  // *made* of "...?redirect=<that value>", so an unchanged href trivially still contains that substring in its
  // own query string -- only exact-equality-to-the-original proves no navigation happened.)
  await test('OPEN REDIRECT :: a leading "/\\" value (browser-normalizes to protocol-relative "//") is rejected, not navigated to', async () => {
    const originalHref = 'https://chipakk.shop/account.html?redirect=' + encodeURIComponent('/\\evil-attacker.example/phish.html');
    const href = await attemptSignInWithRedirectParam('/\\evil-attacker.example/phish.html');
    assert.strictEqual(href, originalHref, `must not navigate at all: got href="${href}"`);
  });

  await test('OPEN REDIRECT :: a leading "\\\\...html" value (no leading slash, still browser-normalizes to "//") is rejected', async () => {
    const originalHref = 'https://chipakk.shop/account.html?redirect=' + encodeURIComponent('\\\\evil-attacker.example/phish.html');
    const href = await attemptSignInWithRedirectParam('\\\\evil-attacker.example/phish.html');
    assert.strictEqual(href, originalHref, `must not navigate at all: got href="${href}"`);
  });

  await test('OPEN REDIRECT :: a genuine absolute URL with "://" is still rejected (pre-existing protection, must not regress)', async () => {
    const originalHref = 'https://chipakk.shop/account.html?redirect=' + encodeURIComponent('https://evil-attacker.example/phish.html');
    const href = await attemptSignInWithRedirectParam('https://evil-attacker.example/phish.html');
    assert.strictEqual(href, originalHref, `must not navigate at all: got href="${href}"`);
  });

  await test('OPEN REDIRECT :: a genuine same-site relative path ("/shop.html") is still allowed to redirect (fix must not be overly strict)', async () => {
    const href = await attemptSignInWithRedirectParam('/shop.html');
    assert.strictEqual(href, '/shop.html', `legitimate same-site redirect must still work: got href="${href}"`);
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nOPEN REDIRECT GUARD: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
