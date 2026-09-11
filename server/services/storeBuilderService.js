const { pool } = require('../config/database');
const { getSiteSettings } = require('./settingsService');

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
 * Fetch full Store Builder configuration for Admin Panel
 */
const getStoreBuilderAdminData = async () => {
  // 1. Announcement Bar
  const announcement_bar = await getSettingByKey('store_builder_announcement_bar', {
    enabled: true,
    text: 'WELCOME TO CHIPAKK! FREE SHIPPING OVER ₹499',
    mode: 'MARQUEE',
    marquee_speed: 'normal'
  });

  // 2. Hero Configuration (Mutually Exclusive: fixed vs carousel)
  const hero_config = await getSettingByKey('store_builder_hero_config', {
    mode: 'fixed', // 'fixed' | 'carousel'
    fixed_banner: {
      image_url: '/uploads/hero-banner-1.png',
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
          image_url: '/uploads/hero-banner-1.png',
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
  });

  // 3. Hero Groups (backwards compatibility)
  const hero_groups = await getSettingByKey('store_builder_hero_groups', [
    {
      id: 'hero_default',
      name: 'Main Hero Carousel',
      active: hero_config.mode === 'carousel',
      slides: hero_config.carousel.slides || []
    }
  ]);

  // 4. Promo Banners (from banners table & site_settings)
  let promo_banners = await getSettingByKey('store_builder_promo_banners', null);
  if (!promo_banners) {
    const [bannerRows] = await pool.execute(
      'SELECT id, title, image_url, storage_path, target_url, sort_order, active, created_at, updated_at FROM banners ORDER BY sort_order ASC, id DESC'
    );
    promo_banners = bannerRows;
  }

  // 5. Content Sections
  const content_sections = await getSettingByKey('store_builder_content_sections', [
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
  ]);

  return {
    announcement_bar,
    hero_config,
    hero_groups,
    promo_banners,
    content_sections
  };
};

/**
 * Update Store Builder sections while preserving existing, unsupplied sections
 */
const updateStoreBuilderData = async (updatePayload = {}) => {
  const { announcement_bar, hero_config, hero_mode, hero_groups, promo_banners, content_sections } = updatePayload;

  if (announcement_bar !== undefined) {
    await setSettingByKey('store_builder_announcement_bar', announcement_bar, 'Store Builder Announcement Bar Settings');
  }

  // Enforce mutual exclusivity between fixed banner and carousel
  if (hero_config !== undefined || hero_mode !== undefined) {
    const existing = await getSettingByKey('store_builder_hero_config', {});
    const targetMode = hero_mode || hero_config?.mode || existing.mode || 'fixed';
    const mergedConfig = {
      ...existing,
      ...(hero_config || {}),
      mode: targetMode === 'carousel' ? 'carousel' : 'fixed'
    };
    await setSettingByKey('store_builder_hero_config', mergedConfig, 'Store Builder Hero Configuration');
  }

  if (hero_groups !== undefined) {
    await setSettingByKey('store_builder_hero_groups', hero_groups, 'Store Builder Hero Groups & Slides');
  }

  if (promo_banners !== undefined) {
    await setSettingByKey('store_builder_promo_banners', promo_banners, 'Store Builder Promotional Banners Configuration');
  }

  if (content_sections !== undefined) {
    await setSettingByKey('store_builder_content_sections', content_sections, 'Store Builder Content Sections Configuration');
  }

  return getStoreBuilderAdminData();
};

/**
 * Fetch storefront-safe Store Builder data for public customer applications
 */
const getPublicStoreBuilderData = async () => {
  const adminData = await getStoreBuilderAdminData();
  const globalSettings = await getSiteSettings();

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
    hero = {
      mode: 'fixed',
      enabled: true,
      image_url: fb.image_url || '',
      show_eyebrow: fb.show_eyebrow !== false,
      eyebrow: fb.eyebrow || 'New designs every week',
      show_title: fb.show_title !== false,
      title: fb.title || 'STICK YOUR WORLD.',
      show_description: fb.show_description !== false,
      description: fb.description || 'Premium stickers for a bolder, brighter, more you.',
      show_primary_btn: fb.show_primary_btn !== false,
      primary_btn_text: fb.primary_btn_text || 'Shop Now →',
      primary_btn_url: fb.primary_btn_url || 'shop.html',
      show_secondary_btn: fb.show_secondary_btn !== false,
      secondary_btn_text: fb.secondary_btn_text || 'Custom Stickers',
      secondary_btn_url: fb.secondary_btn_url || 'custom-stickers.html'
    };
  } else {
    // Carousel mode
    const slides = (heroConfig.carousel?.slides || adminData.hero_groups?.[0]?.slides || [])
      .filter(s => s.active === true || s.active === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(s => ({
        id: s.id,
        image_url: s.image_url || '',
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
        secondary_btn_text: s.secondary_btn_text || 'Custom Stickers',
        secondary_btn_url: s.secondary_btn_url || 'custom-stickers.html'
      }));

    hero = {
      mode: 'carousel',
      enabled: slides.length > 0,
      slides
    };
  }

  // 3. Query active Promotional Banners directly from banners table
  const [bannerRows] = await pool.execute(
    'SELECT id, title, image_url, target_url, sort_order FROM banners WHERE active = 1 ORDER BY sort_order ASC, id DESC'
  );

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
    announcement_bar,
    hero,
    promo_banners: bannerRows,
    content_sections: contentSections,
    store_info: {
      store_name: globalSettings.store_name || 'CHIPAKK',
      announcement_text: globalSettings.announcement_text || '',
      announcement_active: globalSettings.announcement_active || false,
      maintenance_active: globalSettings.maintenance_active || false,
      free_shipping_threshold: globalSettings.free_shipping_threshold || 0,
      free_shipping_threshold_rupees: Math.round((globalSettings.free_shipping_threshold || 0) / 100)
    }
  };
};

module.exports = {
  getStoreBuilderAdminData,
  updateStoreBuilderData,
  getPublicStoreBuilderData
};
