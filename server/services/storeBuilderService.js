const { pool } = require('../config/database');
const { getStoreSettings, updateStoreSettings } = require('./settingsService');

/**
 * Helper to retrieve JSON setting from site_settings table by key
 */
const getSettingByKey = async (key, fallback = null) => {
  const query = 'SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1';
  const [rows] = await pool.execute(query, [key]);

  if (!rows || rows.length === 0) {
    return fallback;
  }

  const val = rows[0].setting_value;
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
};

/**
 * Helper to update or insert JSON setting in site_settings table by key
 */
const setSettingByKey = async (key, value, description = null) => {
  const jsonStr = JSON.stringify(value);
  const query = `
    INSERT INTO site_settings (setting_key, setting_value, description)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = COALESCE(VALUES(description), description)
  `;
  await pool.execute(query, [key, jsonStr, description || `Store Builder section: ${key}`]);
};

/**
 * Store-Aware Key Resolution:
 * - Store 1 checks `${baseKey}_store_1`, falls back to legacy unpartitioned `${baseKey}`
 * - Store 2 checks `${baseKey}_store_2`, falls back to Store 2 default
 */
const getStoreKey = async (baseKey, storeId, fallback = null) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const storeKey = `${baseKey}_store_${numericStoreId}`;

  // 1. Try store-specific partitioned key
  const val = await getSettingByKey(storeKey, null);
  if (val !== null && val !== undefined) {
    return val;
  }

  // 2. Backward compatibility: if Store 1, fallback to legacy unpartitioned key
  if (numericStoreId === 1) {
    const legacyVal = await getSettingByKey(baseKey, null);
    if (legacyVal !== null && legacyVal !== undefined) {
      return legacyVal;
    }
  }

  // 3. Fallback to store default
  return fallback;
};

/**
 * Store-Aware Key Write:
 * - Saves strictly to `${baseKey}_store_${numericStoreId}`
 * - If Store 1, also mirrors to legacy `${baseKey}` to prevent breaking legacy consumers
 */
const setStoreKey = async (baseKey, storeId, value, description = null) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const storeKey = `${baseKey}_store_${numericStoreId}`;
  await setSettingByKey(storeKey, value, description || `Store Builder ${numericStoreId}: ${baseKey}`);

  if (numericStoreId === 1) {
    await setSettingByKey(baseKey, value, description || `Store Builder legacy: ${baseKey}`);
  }
};

/**
 * Store 1 (CHIPAKK) Default Profiles
 */
const STORE_1_HERO_DEFAULT = {
  mode: 'fixed',
  fixed_banner: {
    image_url: 'assets/images/hero-fallback.svg',
    show_eyebrow: true,
    eyebrow: 'New designs every week',
    show_title: true,
    title: 'STICK YOUR WORLD.',
    show_description: true,
    description: 'Premium stickers for a bolder, brighter, more you. Waterproof, scratch-resistant vinyl made for laptops, phones, bottles, and every surface that deserves personality.',
    show_primary_btn: true,
    primary_btn_text: 'Shop Now →',
    primary_btn_url: 'shop.html',
    show_secondary_btn: true,
    secondary_btn_text: 'Custom Stickers',
    secondary_btn_url: 'custom-stickers.html'
  },
  carousel: {
    slides: [
      {
        id: 'slide_1',
        image_url: 'assets/images/hero-fallback.svg',
        show_eyebrow: true,
        eyebrow: 'New designs every week',
        show_title: true,
        title: 'CUSTOM STICKERS',
        show_description: true,
        description: 'High Quality Vinyl Stickers & Decals',
        show_primary_btn: true,
        primary_btn_text: 'EXPLORE SHOP',
        primary_btn_url: 'shop.html',
        show_secondary_btn: true,
        secondary_btn_text: 'Custom Stickers',
        secondary_btn_url: 'custom-stickers.html',
        active: true,
        sort_order: 1
      }
    ]
  }
};

const STORE_1_ANNOUNCEMENT_DEFAULT = {
  enabled: true,
  text: 'WELCOME TO CHIPAKK! FREE SHIPPING OVER ₹300',
  mode: 'MARQUEE',
  marquee_speed: 'normal'
};

const STORE_1_SECTIONS_DEFAULT = [
  {
    id: 'sec_featured',
    type: 'featured_products',
    title: 'Trending Stickers',
    enabled: true,
    sort_order: 1,
    config: { limit: 8 }
  },
  {
    id: 'sec_categories',
    type: 'category_grid',
    title: 'Shop by Category',
    enabled: true,
    sort_order: 2,
    config: {}
  }
];

/**
 * Store 2 (THE MARSHANS) Default Profiles (3D Printing & On-Demand Manufacturing)
 */
const STORE_2_HERO_DEFAULT = {
  mode: 'fixed',
  fixed_banner: {
    image_url: 'assets/images/hero-fallback.svg',
    show_eyebrow: true,
    eyebrow: 'Precision On-Demand Manufacturing',
    show_title: true,
    title: 'ENGINEERED IN 3D.',
    show_description: true,
    description: 'Industrial grade 3D printing in PLA, PETG, ABS & Resin. Rapid prototyping to production batches with custom quotations.',
    show_primary_btn: true,
    primary_btn_text: 'Explore 3D Catalog →',
    primary_btn_url: 'shop.html',
    show_secondary_btn: true,
    secondary_btn_text: 'Custom 3D Request',
    secondary_btn_url: 'custom-print.html'
  },
  carousel: {
    slides: [
      {
        id: 'slide_mrs_1',
        image_url: 'assets/images/hero-fallback.svg',
        show_eyebrow: true,
        eyebrow: 'Rapid Prototyping',
        show_title: true,
        title: 'CUSTOM 3D FABRICATION',
        show_description: true,
        description: 'High-tolerance functional parts & aesthetic models',
        show_primary_btn: true,
        primary_btn_text: 'VIEW CATALOG',
        primary_btn_url: 'shop.html',
        show_secondary_btn: true,
        secondary_btn_text: 'Request Quote',
        secondary_btn_url: 'custom-print.html',
        active: true,
        sort_order: 1
      }
    ]
  }
};

const STORE_2_ANNOUNCEMENT_DEFAULT = {
  enabled: true,
  text: 'PRECISION 3D PRINTING & CUSTOM ON-DEMAND MANUFACTURING | THE MARSHANS',
  mode: 'MARQUEE',
  marquee_speed: 'normal'
};

const STORE_2_SECTIONS_DEFAULT = [
  {
    id: 'sec_featured_3d',
    type: 'featured_products',
    title: 'Featured 3D Prints',
    enabled: true,
    sort_order: 1,
    config: { limit: 8 }
  },
  {
    id: 'sec_categories_3d',
    type: 'category_grid',
    title: '3D Printing Categories',
    enabled: true,
    sort_order: 2,
    config: {}
  }
];

/**
 * Fetch full Store Builder configuration for Admin Panel scoped by storeId
 * @param {number} [storeId=1] Store context (1 for CHIPAKK, 2 for THE MARSHANS)
 */
const getStoreBuilderAdminData = async (storeId = 1) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const isMarshans = numericStoreId === 2;

  // 1. Announcement Bar
  const announcement_bar = await getStoreKey(
    'store_builder_announcement_bar',
    numericStoreId,
    isMarshans ? STORE_2_ANNOUNCEMENT_DEFAULT : STORE_1_ANNOUNCEMENT_DEFAULT
  );

  // 2. Hero Configuration (Mutually Exclusive: fixed vs carousel)
  const hero_config = await getStoreKey(
    'store_builder_hero_config',
    numericStoreId,
    isMarshans ? STORE_2_HERO_DEFAULT : STORE_1_HERO_DEFAULT
  );

  // 3. Hero Groups (backwards compatibility)
  const hero_groups = await getStoreKey('store_builder_hero_groups', numericStoreId, [
    {
      id: isMarshans ? 'hero_default_marshans' : 'hero_default',
      name: isMarshans ? 'Marshans Hero Carousel' : 'Main Hero Carousel',
      active: hero_config.mode === 'carousel',
      slides: hero_config.carousel?.slides || []
    }
  ]);

  // 4. Promo Banners (from banners table & site_settings)
  let promo_banners = await getStoreKey('store_builder_promo_banners', numericStoreId, null);
  if (!promo_banners) {
    try {
      let hasStoreIdCol = false;
      try {
        const [cols] = await pool.execute("SHOW COLUMNS FROM banners LIKE 'store_id'");
        hasStoreIdCol = cols && cols.length > 0;
      } catch (_) {}

      if (hasStoreIdCol) {
        const [bannerRows] = await pool.execute(
          'SELECT id, title, image_url, storage_path, target_url, sort_order, active, created_at, updated_at FROM banners WHERE store_id = ? OR store_id IS NULL ORDER BY sort_order ASC, id DESC',
          [numericStoreId]
        );
        promo_banners = bannerRows;
      } else {
        const [bannerRows] = await pool.execute(
          'SELECT id, title, image_url, storage_path, target_url, sort_order, active, created_at, updated_at FROM banners ORDER BY sort_order ASC, id DESC'
        );
        promo_banners = bannerRows;
      }
    } catch (_) {
      promo_banners = [];
    }
  }

  // 5. Content Sections
  const content_sections = await getStoreKey(
    'store_builder_content_sections',
    numericStoreId,
    isMarshans ? STORE_2_SECTIONS_DEFAULT : STORE_1_SECTIONS_DEFAULT
  );

  return {
    store_id: numericStoreId,
    announcement_bar,
    hero_config,
    hero_groups,
    promo_banners,
    content_sections
  };
};

/**
 * Update Store Builder sections while preserving existing, unsupplied sections, strictly isolated per store
 * @param {object} updatePayload Update payload
 * @param {number} [storeId=1] Store context (1 for CHIPAKK, 2 for THE MARSHANS)
 */
const updateStoreBuilderData = async (updatePayload = {}, storeId = 1) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const { announcement_bar, hero_config, hero_mode, hero_groups, promo_banners, content_sections } = updatePayload;

  if (announcement_bar !== undefined) {
    await setStoreKey('store_builder_announcement_bar', numericStoreId, announcement_bar, `Store Builder ${numericStoreId} Announcement Bar`);
    // Synchronize to store_settings table so settingsService and header sync stay in step
    try {
      await updateStoreSettings(numericStoreId, {
        announcement_text: announcement_bar.text || '',
        announcement_active: Boolean(announcement_bar.enabled)
      });
    } catch (syncErr) {
      console.warn('[StoreBuilder Sync Warning] Could not sync announcement to store_settings:', syncErr.message);
    }
  }

  // Enforce mutual exclusivity between fixed banner and carousel
  if (hero_config !== undefined || hero_mode !== undefined) {
    const existing = await getStoreKey('store_builder_hero_config', numericStoreId, numericStoreId === 2 ? STORE_2_HERO_DEFAULT : STORE_1_HERO_DEFAULT);
    const targetMode = hero_mode || hero_config?.mode || existing.mode || 'fixed';
    const mergedConfig = {
      ...existing,
      ...(hero_config || {}),
      mode: targetMode === 'carousel' ? 'carousel' : 'fixed'
    };
    await setStoreKey('store_builder_hero_config', numericStoreId, mergedConfig, `Store Builder ${numericStoreId} Hero Configuration`);
  }

  if (hero_groups !== undefined) {
    await setStoreKey('store_builder_hero_groups', numericStoreId, hero_groups, `Store Builder ${numericStoreId} Hero Groups & Slides`);
  }

  if (promo_banners !== undefined) {
    await setStoreKey('store_builder_promo_banners', numericStoreId, promo_banners, `Store Builder ${numericStoreId} Promotional Banners Configuration`);
  }

  if (content_sections !== undefined) {
    await setStoreKey('store_builder_content_sections', numericStoreId, content_sections, `Store Builder ${numericStoreId} Content Sections Configuration`);
  }

  return getStoreBuilderAdminData(numericStoreId);
};

/**
 * Fetch storefront-safe Store Builder data for public customer applications, isolated by storeId
 * @param {number} [storeId=1] Store context (1 for CHIPAKK, 2 for THE MARSHANS)
 */
const getPublicStoreBuilderData = async (storeId = 1) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const isMarshans = numericStoreId === 2;

  try {
    const adminData = await getStoreBuilderAdminData(numericStoreId);
    const storeSettings = await getStoreSettings(numericStoreId);

    // 1. Filter active Announcement Bar
    const announcement_bar = adminData.announcement_bar && adminData.announcement_bar.enabled
      ? {
          enabled: true,
          text: adminData.announcement_bar.text || '',
          mode: adminData.announcement_bar.mode || 'STATIC',
          marquee_speed: adminData.announcement_bar.marquee_speed || 'normal'
        }
      : { enabled: false, text: '', mode: 'STATIC', marquee_speed: 'normal' };

    // 2. Filter active Hero (Fixed Banner vs Carousel)
    const heroConfig = adminData.hero_config || {};
    const heroMode = heroConfig.mode || 'fixed';
    let hero = null;

    if (heroMode === 'fixed') {
      const fb = heroConfig.fixed_banner || {};
      const rawImg = fb.image_url || '';
      const safeImg = (!rawImg || rawImg.includes('hero-banner-1.png')) ? 'assets/images/hero-fallback.svg' : rawImg;
      hero = {
        mode: 'fixed',
        enabled: true,
        image_url: safeImg,
        show_eyebrow: fb.show_eyebrow !== false,
        eyebrow: fb.eyebrow || (isMarshans ? 'Precision On-Demand Manufacturing' : 'New designs every week'),
        show_title: fb.show_title !== false,
        title: fb.title || (isMarshans ? 'ENGINEERED IN 3D.' : 'STICK YOUR WORLD.'),
        show_description: fb.show_description !== false,
        description: fb.description || (isMarshans ? 'Industrial grade 3D printing in PLA, PETG, ABS & Resin.' : 'Premium stickers for a bolder, brighter, more you.'),
        show_primary_btn: fb.show_primary_btn !== false,
        primary_btn_text: fb.primary_btn_text || (isMarshans ? 'Explore 3D Catalog →' : 'Shop Now →'),
        primary_btn_url: fb.primary_btn_url || 'shop.html',
        show_secondary_btn: fb.show_secondary_btn !== false,
        secondary_btn_text: fb.secondary_btn_text || (isMarshans ? 'Custom 3D Request' : 'Custom Stickers'),
        secondary_btn_url: fb.secondary_btn_url || (isMarshans ? 'custom-print.html' : 'custom-stickers.html')
      };
    } else {
      // Carousel mode
      const slides = (heroConfig.carousel?.slides || adminData.hero_groups?.[0]?.slides || [])
        .filter(s => s.active === true || s.active === 1)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(s => {
          const rawImg = s.image_url || '';
          const safeImg = (!rawImg || rawImg.includes('hero-banner-1.png')) ? 'assets/images/hero-fallback.svg' : rawImg;
          return {
            id: s.id,
            image_url: safeImg,
            show_eyebrow: s.show_eyebrow !== false,
            eyebrow: s.eyebrow || '',
            show_title: s.show_title !== false,
            title: s.title || '',
            show_description: s.show_description !== false,
            description: s.description || s.subtitle || '',
            show_primary_btn: s.show_primary_btn !== false,
            primary_btn_text: s.primary_btn_text || s.cta_text || 'Shop Now →',
            primary_btn_url: s.primary_btn_url || s.target_url || 'shop.html',
            show_secondary_btn: s.show_secondary_btn === true,
            secondary_btn_text: s.secondary_btn_text || (isMarshans ? 'Custom 3D Request' : 'Custom Stickers'),
            secondary_btn_url: s.secondary_btn_url || (isMarshans ? 'custom-print.html' : 'custom-stickers.html')
          };
        });

      hero = {
        mode: 'carousel',
        enabled: slides.length > 0,
        slides
      };
    }

    // 3. Query active Promotional Banners scoped by store
    let bannerRows = [];
    try {
      let hasStoreIdCol = false;
      try {
        const [cols] = await pool.execute("SHOW COLUMNS FROM banners LIKE 'store_id'");
        hasStoreIdCol = cols && cols.length > 0;
      } catch (_) {}

      if (hasStoreIdCol) {
        const [rows] = await pool.execute(
          'SELECT id, title, image_url, target_url, sort_order FROM banners WHERE active = 1 AND (store_id = ? OR store_id IS NULL) ORDER BY sort_order ASC, id DESC',
          [numericStoreId]
        );
        bannerRows = rows;
      } else {
        const [rows] = await pool.execute(
          'SELECT id, title, image_url, target_url, sort_order FROM banners WHERE active = 1 ORDER BY sort_order ASC, id DESC'
        );
        bannerRows = rows;
      }
    } catch (_) {}

    // 4. Filter active Content Sections
    const contentSections = (Array.isArray(adminData.content_sections) ? adminData.content_sections : [])
      .filter(sec => sec.enabled === true || sec.enabled === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(sec => ({
        id: sec.id,
        type: sec.type,
        title: sec.title || '',
        config: sec.config || {}
      }));

    return {
      store_id: numericStoreId,
      announcement_bar,
      hero,
      promo_banners: bannerRows,
      content_sections: contentSections,
      store_info: {
        store_name: storeSettings.store_name || (isMarshans ? 'THE MARSHANS' : 'CHIPAKK'),
        announcement_text: storeSettings.announcement_text || adminData.announcement_bar?.text || '',
        announcement_active: storeSettings.announcement_active !== false && Boolean(adminData.announcement_bar?.enabled),
        maintenance_active: storeSettings.maintenance_active || false,
        free_shipping_threshold: storeSettings.free_shipping_threshold || 0,
        free_shipping_threshold_rupees: Math.round((storeSettings.free_shipping_threshold || 0) / 100)
      }
    };
  } catch (err) {
    console.warn(`[StoreBuilder DB Fallback Warning] Store ${numericStoreId} safe fallback:`, err.message);
    const isMarshansFallback = numericStoreId === 2;
    return {
      store_id: numericStoreId,
      announcement_bar: isMarshansFallback ? STORE_2_ANNOUNCEMENT_DEFAULT : STORE_1_ANNOUNCEMENT_DEFAULT,
      hero: {
        mode: 'fixed',
        enabled: true,
        image_url: 'assets/images/hero-fallback.svg',
        show_eyebrow: true,
        eyebrow: isMarshansFallback ? 'Precision On-Demand Manufacturing' : 'New designs every week',
        show_title: true,
        title: isMarshansFallback ? 'ENGINEERED IN 3D.' : 'STICK YOUR WORLD.',
        show_description: true,
        description: isMarshansFallback ? 'Industrial grade 3D printing in PLA, PETG, ABS & Resin.' : 'Premium stickers for a bolder, brighter, more you.',
        show_primary_btn: true,
        primary_btn_text: isMarshansFallback ? 'Explore 3D Catalog →' : 'Shop Now →',
        primary_btn_url: 'shop.html',
        show_secondary_btn: true,
        secondary_btn_text: isMarshansFallback ? 'Custom 3D Request' : 'Custom Stickers',
        secondary_btn_url: isMarshansFallback ? 'custom-print.html' : 'custom-stickers.html'
      },
      promo_banners: [],
      content_sections: isMarshansFallback ? STORE_2_SECTIONS_DEFAULT : STORE_1_SECTIONS_DEFAULT,
      store_info: {
        store_name: isMarshansFallback ? 'THE MARSHANS' : 'CHIPAKK',
        announcement_text: isMarshansFallback ? STORE_2_ANNOUNCEMENT_DEFAULT.text : STORE_1_ANNOUNCEMENT_DEFAULT.text,
        announcement_active: true,
        maintenance_active: false,
        free_shipping_threshold: isMarshansFallback ? 0 : 300,
        free_shipping_threshold_rupees: isMarshansFallback ? 0 : 300
      }
    };
  }
};

module.exports = {
  getStoreBuilderAdminData,
  updateStoreBuilderData,
  getPublicStoreBuilderData,
  STORE_1_HERO_DEFAULT,
  STORE_2_HERO_DEFAULT,
  STORE_1_ANNOUNCEMENT_DEFAULT,
  STORE_2_ANNOUNCEMENT_DEFAULT
};
