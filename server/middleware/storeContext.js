/**
 * Store Context Resolution Middleware
 * Resolves the active store context (CHIPAKK vs THE MARSHANS) for all incoming API requests.
 *
 * Attaches to req:
 * - req.storeId (BIGINT number: 1 or 2)
 * - req.storeCode ('chipakk' or 'marshans')
 * - req.store ({ id, code, name, domain })
 */

const KNOWN_STORES = {
  1: {
    id: 1,
    code: 'chipakk',
    name: 'CHIPAKK',
    domain: 'chipakk.shop'
  },
  2: {
    id: 2,
    code: 'marshans',
    name: 'THE MARSHANS',
    domain: 'themarshans.shop'
  }
};

const resolveStoreContext = (req, res, next) => {
  try {
    let resolvedStoreId = 1; // Default to CHIPAKK

    // 1. Priority: Explicit HTTP Header (Used by Admin Panel context switcher & API clients)
    const headerStoreId = req.headers['x-store-id'] || req.headers['x-store'];
    const headerStoreCode = req.headers['x-store-code'];

    if (headerStoreId) {
      const parsedId = parseInt(headerStoreId, 10);
      if (parsedId === 1 || parsedId === 2) {
        resolvedStoreId = parsedId;
      }
    } else if (headerStoreCode) {
      const cleanCode = String(headerStoreCode).trim().toLowerCase();
      if (cleanCode === 'marshans' || cleanCode === 'themarshans') {
        resolvedStoreId = 2;
      } else if (cleanCode === 'chipakk') {
        resolvedStoreId = 1;
      }
    } else if (req.query && (req.query.store || req.query.store_id)) {
      // 2. Priority: Query Parameter (Convenient for local browser testing e.g. ?store=marshans)
      const qStore = String(req.query.store || req.query.store_id).trim().toLowerCase();
      if (qStore === '2' || qStore === 'marshans' || qStore === 'themarshans') {
        resolvedStoreId = 2;
      } else if (qStore === '1' || qStore === 'chipakk') {
        resolvedStoreId = 1;
      }
    } else {
      // 3. Priority: Hostname / Origin / Referer domain resolution (Customer Storefronts)
      const extractHost = (val) => {
        if (!val || typeof val !== 'string') return '';
        try {
          if (val.startsWith('http://') || val.startsWith('https://')) {
            return new URL(val).hostname.toLowerCase();
          }
          return val.split(':')[0].trim().toLowerCase();
        } catch (_) {
          return '';
        }
      };

      const candidates = [
        extractHost(req.get('origin')),
        extractHost(req.get('host')),
        extractHost(req.get('referer'))
      ].filter(Boolean);

      const MARSHANS_HOSTS = new Set(['themarshans.shop', 'www.themarshans.shop']);
      const CHIPAKK_HOSTS = new Set(['chipakk.shop', 'www.chipakk.shop']);

      for (const h of candidates) {
        if (MARSHANS_HOSTS.has(h)) {
          resolvedStoreId = 2;
          break;
        }
        if (CHIPAKK_HOSTS.has(h)) {
          resolvedStoreId = 1;
          break;
        }
      }
    }

    // Attach resolved store context to request
    req.storeId = resolvedStoreId;
    req.storeCode = KNOWN_STORES[resolvedStoreId].code;
    req.store = KNOWN_STORES[resolvedStoreId];

    // Echo resolved store ID back in response headers for client verification
    res.setHeader('X-Store-ID', resolvedStoreId);
    res.setHeader('X-Store-Code', req.storeCode);

    return next();
  } catch (err) {
    console.error('[Store Context Resolution Error]', err.message);
    // Safe fallback to Store 1 (CHIPAKK)
    req.storeId = 1;
    req.storeCode = 'chipakk';
    req.store = KNOWN_STORES[1];
    return next();
  }
};

module.exports = {
  resolveStoreContext,
  KNOWN_STORES
};
