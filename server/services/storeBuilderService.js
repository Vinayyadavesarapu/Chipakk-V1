const { pool } = require('../config/database');
const { getSettings } = require('./settingsService');

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

  // 2. Hero Groups
  const hero_groups = await getSettingByKey('store_builder_hero_groups', [
    {
      id: 'hero_default',
      name: 'Main Hero Carousel',
      active: true,
      slides: [
        {
          id: 'slide_1',
          title: 'CUSTOM STICKERS',
          subtitle: 'High Quality Vinyl Stickers & Decals',
          image_url: '/uploads/hero-banner-1.png',
          storage_path: 'uploads/hero-banner-1.png',
          target_url: '/products',
          cta_text: 'EXPLORE SHOP',
          active: true,
          sort_order: 1
        }
      ]
    }
  ]);

  // 3. Promo Banners (from banners table & site_settings)
  let promo_banners = await getSettingByKey('store_builder_promo_banners', null);
  if (!promo_banners) {
    const [bannerRows] = await pool.execute(
      'SELECT id, title, image_url, storage_path, target_url, sort_order, active, created_at, updated_at FROM banners ORDER BY sort_order ASC, id DESC'
    );
    promo_banners = bannerRows;
  }

  // 4. Content Sections
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
    hero_groups,
    promo_banners,
    content_sections
  };
};

/**
 * Update Store Builder sections while preserving existing, unsupplied sections
 */
const updateStoreBuilderData = async (updatePayload = {}) => {
  const { announcement_bar, hero_groups, promo_banners, content_sections } = updatePayload;

  if (announcement_bar !== undefined) {
    await setSettingByKey('store_builder_announcement_bar', announcement_bar, 'Store Builder Announcement Bar Settings');
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
  const globalSettings = await getSettings();

  // 1. Filter active Announcement Bar
  const announcement_bar = adminData.announcement_bar && adminData.announcement_bar.enabled
    ? {
        enabled: true,
        text: adminData.announcement_bar.text || '',
        mode: adminData.announcement_bar.mode || 'STATIC',
        marquee_speed: adminData.announcement_bar.marquee_speed || 'normal'
      }
    : { enabled: false, text: '', mode: 'STATIC', marquee_speed: 'normal' };

  // 2. Filter active Hero Group & active Slides
  const heroGroups = Array.isArray(adminData.hero_groups) ? adminData.hero_groups : [];
  const activeHeroGroup = heroGroups.find(g => g.active === true) || heroGroups[0] || null;
  
  let hero = null;
  if (activeHeroGroup) {
    const activeSlides = (Array.isArray(activeHeroGroup.slides) ? activeHeroGroup.slides : [])
      .filter(s => s.active === true || s.active === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(s => ({
        id: s.id,
        title: s.title || '',
        subtitle: s.subtitle || '',
        image_url: s.image_url || '',
        target_url: s.target_url || '',
        cta_text: s.cta_text || 'SHOP NOW'
      }));

    hero = {
      id: activeHeroGroup.id,
      name: activeHeroGroup.name,
      slides: activeSlides
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
