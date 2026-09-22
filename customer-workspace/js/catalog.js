/* =========================================================
   CHIPAKK — Catalog Module (product/category model + card rendering)
   js/catalog.js

   One normalisation layer and ONE product-card renderer for the whole
   storefront (home, shop, product recommendations, wishlist, search).

     normalizeProduct(raw)     -> canonical product object (never throws)
     normalizeCategory(raw)    -> canonical category object
     productCardHtml(p, opts)  -> card markup for a normalized product
     productGridHtml(list,o)   -> markup for a whole grid (+ empty state)
     categoryMediaHtml(c)      -> category thumbnail markup

   Money: CHIPAKK (store 1) API values are whole rupees; the server also
   sends price_rupees / compare_at_price_rupees for both stores, and those
   are the ONLY fields used for display. Checkout never trusts the client
   price - the server recomputes it from product_id.

   UMD: browser (window.CHIPAKK_CATALOG) and Node (tests).
   ========================================================= */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CHIPAKK_CATALOG = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getRatingTier(rating) {
    var r = Math.round((parseFloat(rating) || 0) * 10) / 10;
    if (r >= 4.9) return "LEGENDARY";
    if (r >= 4.7) return "RARE";
    if (r >= 4.4) return "EPIC";
    if (r >= 4.0) return "UNCOMMON";
    if (r >= 3.0) return "COMMON";
    return "BASIC";
  }

  function starsMarkup(rating) {
    // Unrated (0 / missing) must read as empty stars, never as a fabricated 5-star rating.
    var full = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var out = "";
    for (var i = 0; i < 5; i++) {
      out += i < full
        ? '<svg viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9.5 16.5 14 18 22 12 18 6 22 7.5 14 2 9.5 9 9"/></svg>'
        : '<svg class="star-empty" viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9.5 16.5 14 18 22 12 18 6 22 7.5 14 2 9.5 9 9"/></svg>';
    }
    return out;
  }

  function toNumberOrNull(v) {
    if (v === undefined || v === null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function parseTags(t) {
    if (Array.isArray(t)) return t;
    if (typeof t === "string" && t) { try { var j = JSON.parse(t); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
    return [];
  }

  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /**
   * Recognizes whether a user search query matches an active category by name or slug.
   * Priority:
   * 1. Exact match on slug or name (case-insensitive)
   * 2. Slugified query match (e.g. "utility co" -> "utility-co")
   * 3. Clear intent match stripped of generic filler words ("stickers", "prints", "designs", "collection")
   * Returns matching category object or null.
   */
  function matchCategoryQuery(query, categories) {
    if (!query || typeof query !== "string") return null;
    var raw = query.trim().toLowerCase();
    if (!raw) return null;
    if (!Array.isArray(categories) || categories.length === 0) return null;

    var activeCats = categories.filter(function (c) {
      return c && c.active !== false && c.slug;
    });

    // 1. Exact match on slug or name
    var exact = activeCats.find(function (c) {
      var slug = (c.slug || "").toLowerCase().trim();
      var name = (c.name || "").toLowerCase().trim();
      return slug === raw || name === raw;
    });
    if (exact) return exact;

    // 2. Slugified query match (e.g. "utility co" vs "utility-co")
    var slugifiedQuery = slugify(raw);
    if (slugifiedQuery) {
      var slugMatch = activeCats.find(function (c) {
        var s = (c.slug || "").toLowerCase().trim();
        var nSlug = slugify(c.name);
        return s === slugifiedQuery || nSlug === slugifiedQuery;
      });
      if (slugMatch) return slugMatch;
    }

    // 3. Clear intent match: stripped of common accessory words like "stickers", "sticker", "prints", "print", "collection", "merch", "designs"
    // e.g. "anime stickers" -> "anime", "darshanam prints" -> "darshanam"
    var stripped = raw
      .replace(/\b(stickers?|prints?|designs?|collection|merch)\b/gi, "")
      .trim();
    if (stripped && stripped !== raw && stripped.length >= 2) {
      var strippedSlug = slugify(stripped);
      var strippedMatch = activeCats.find(function (c) {
        var slug = (c.slug || "").toLowerCase().trim();
        var name = (c.name || "").toLowerCase().trim();
        var nSlug = slugify(name);
        return slug === stripped || name === stripped || slug === strippedSlug || nSlug === strippedSlug;
      });
      if (strippedMatch) return strippedMatch;
    }

    return null;
  }

  /**
   * createCatalog({ media, formatPrice, storeId })
   *   media       - CHIPAKK_MEDIA.createMedia(...) instance
   *   formatPrice - (rupees:number) => "₹1,500"
   *   storeId     - active store (1 CHIPAKK / 2 MARSHANS)
   */
  function createCatalog(deps) {
    deps = deps || {};
    var media = deps.media;
    var formatPrice = deps.formatPrice || function (n) { return "₹" + Math.round(Number(n || 0)); };
    var activeStoreId = function () { return typeof deps.storeId === "function" ? deps.storeId() : (deps.storeId || 1); };

    function normalizeProduct(p) {
      if (!p || typeof p !== "object") return null;
      if (p.id === undefined || p.id === null || p.id === "") return null;

      var id = String(p.id);
      var sku = p.sku ? String(p.sku) : "";
      var adminProductId = p.admin_product_id || sku || id;
      var name = String(p.name || p.title || "Sticker");
      var slug = p.slug || slugify(adminProductId) || id;

      // Whole-rupee display price (store 1) / paise-derived rupees (store 2) come from the API.
      var price;
      if (toNumberOrNull(p.price_rupees) !== null) price = Number(p.price_rupees);
      else price = Math.round(toNumberOrNull(p.price) || 0);

      var compareAt = null;
      if (toNumberOrNull(p.compare_at_price_rupees) !== null) compareAt = Number(p.compare_at_price_rupees);
      else if (toNumberOrNull(p.compare_at_price) !== null) compareAt = Math.round(Number(p.compare_at_price));
      else if (toNumberOrNull(p.compareAtPrice) !== null) compareAt = Number(p.compareAtPrice);

      var rating = typeof p.average_rating === "number" ? p.average_rating : (typeof p.rating === "number" ? p.rating : (parseFloat(p.rating) || 0)); // unknown stays 0 / unrated - never an invented score
      var ratingCount = parseInt(p.review_count !== undefined ? p.review_count : p.ratingCount, 10) || 0;

      // ---- images: every reference goes through the ONE resolver ----
      var gallery = [];
      var seen = {};
      function pushImg(raw) {
        var u = media.resolve(typeof raw === "string" ? raw : (raw && (raw.image_url || raw.external_url || raw.url)));
        if (u && !seen[u]) { seen[u] = 1; gallery.push(u); }
      }
      if (Array.isArray(p.images)) p.images.forEach(pushImg);
      pushImg(p.primary_image_url);
      if (typeof p.image === "string") pushImg(p.image);
      var imageUrl = gallery.length ? gallery[0] : "";

      var categoryName = p.category_name || p.categoryName || "";
      var categorySlug = p.category_slug || (categoryName ? slugify(categoryName) : "");

      var materials = ["Glossy", "Matte", "Holographic", "Transparent"];
      var sizes = ['2"', '3"', '4"'];
      if (Array.isArray(p.options) && p.options.length > 0) {
        var matOpt = p.options.find(function (o) { return /material|finish/i.test(o && o.name); });
        if (matOpt && Array.isArray(matOpt.values) && matOpt.values.length) materials = matOpt.values.map(function (v) { return typeof v === "string" ? v : (v.value || v.name); });
        var szOpt = p.options.find(function (o) { return /size|dimension/i.test(o && o.name); });
        if (szOpt && Array.isArray(szOpt.values) && szOpt.values.length) sizes = szOpt.values.map(function (v) { return typeof v === "string" ? v : (v.value || v.name); });
      } else if (Array.isArray(p.materials) && p.materials.length) {
        materials = p.materials;
      }

      // Availability: only an EXPLICIT signal marks a product unavailable.
      // (The API reports stock = 0 for products that have no inventory row, so
      //  "stock > 0" would wrongly mark the whole catalog sold out.)
      var inStock = true;
      if (p.in_stock === false || p.inStock === false || p.available === false) inStock = false;
      if (p.track_inventory === true && toNumberOrNull(p.stock) !== null && Number(p.stock) <= 0) inStock = false;

      // effective GST rate (product > category); null means "use the store default". Never invented here.
      var gstRate = toNumberOrNull(p.effective_gst_rate);
      if (gstRate === null) gstRate = toNumberOrNull(p.gst_rate);

      var variants = Array.isArray(p.variants) ? p.variants : [];
      var defaultVariant = variants.find(function (v) { return v && v.variant_slug === "default"; }) || variants[0] || null;

      var isBest = p.is_best_seller === 1 || p.is_best_seller === true || p.isBestSeller === true;
      var storeId = toNumberOrNull(p.store_id);

      return {
        id: id,
        store_id: storeId !== null ? storeId : activeStoreId(),
        admin_product_id: adminProductId,
        sku: sku,
        name: name,
        slug: slug,
        url: "product.html?id=" + encodeURIComponent(id),
        price: price,
        price_rupees: price,
        compareAtPrice: compareAt,
        compare_at_price: compareAt,
        compare_at_price_rupees: compareAt,
        rating: rating,
        ratingCount: ratingCount,
        hasRating: rating > 0,
        rating_tier: p.rating_tier || getRatingTier(rating),
        active: p.active === 1 || p.active === true || p.active === undefined,
        featured: p.featured === 1 || p.featured === true,
        // "image" keeps the legacy contract (URL, or an emoji when there is none)
        image: imageUrl || "⚡",
        imageUrl: imageUrl,
        images: gallery,
        categoryId: p.category_id !== undefined && p.category_id !== null ? String(p.category_id) : String(p.categoryId || ""),
        categoryName: categoryName,
        categorySlug: categorySlug,
        tags: parseTags(p.tags),
        description: p.description || "",
        materials: materials,
        sizes: sizes,
        inStock: inStock,
        gstRate: gstRate,
        stock: p.stock !== undefined ? p.stock : null,
        variants: variants,
        options: Array.isArray(p.options) ? p.options : [],
        variantId: defaultVariant ? (defaultVariant.variant_id || defaultVariant.id || null) : null,
        is_best_seller: isBest,
        isBestSeller: isBest
      };
    }

    function normalizeCategory(c) {
      if (!c || typeof c !== "object" || c.id === undefined || c.id === null) return null;
      var name = c.name || "Category";
      var raw = c.image_url || (c.media && (c.media.thumbnail || c.media.hero_light)) || (typeof c.image === "string" ? c.image : "");
      var imageUrl = media.resolve(raw);
      return {
        id: String(c.id),
        name: name,
        slug: c.slug || slugify(name),
        active: c.active === 1 || c.active === true || c.active === undefined,
        description: c.description || "",
        image_url: imageUrl || null,
        image: imageUrl || c.icon || "✨",
        icon: c.icon || "✨",
        productCount: parseInt(c.product_count !== undefined ? c.product_count : c.productCount, 10) || 0
      };
    }

    /** Category thumbnail: image through the shared pipeline, else an icon. */
    function categoryMediaHtml(c) {
      var url = c && (c.image_url || media.resolve(c.image));
      if (url && media.resolve(url)) {
        return media.imgHtml({ src: url, alt: (c.name || "") + " sticker category", cls: "cat-media-img", width: 96, height: 96 });
      }
      return "<span>" + escapeHtml((c && (c.icon || (media.resolve(c.image) ? "✨" : c.image))) || "✨") + "</span>";
    }

    /**
     * Product card. Accepts a NORMALIZED product; tolerates a raw one by
     * normalizing it, so a caller can never render un-resolved image data.
     * options: { isWishlisted, mode: 'standard'|'wishlist', priority }
     */
    function productCardHtml(input, options) {
      options = options || {};
      var p = input && input.imageUrl !== undefined && input.url ? input : normalizeProduct(input);
      if (!p) return "";

      var mode = options.mode || "standard";
      var wished = !!options.isWishlisted;
      var ratingVal = typeof p.rating === "number" && isFinite(p.rating) ? p.rating : 0;
      var rated = ratingVal > 0;
      var tier = p.rating_tier || getRatingTier(ratingVal);
      var idAttr = escapeHtml(p.id);
      var nameAttr = escapeHtml(p.name);
      var soldOut = p.inStock === false;
      var showCompare = p.compareAtPrice !== null && p.compareAtPrice > p.price;

      // imgHtml returns the shared placeholder when there is no URL, so "no image" and "image failed"
      // look identical everywhere (no made-up artwork).
      var mediaHtml = media.imgHtml({ src: p.imageUrl, alt: p.name, width: 300, height: 300, priority: !!options.priority });

      var wishBtn = mode === "wishlist" ? "" :
        '<button class="product-wishlist ' + (wished ? "is-active" : "") + '" type="button" data-wishlist-id="' + idAttr + '" aria-label="Wishlist ' + nameAttr + '" aria-pressed="' + wished + '">' +
        '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.6-10-9.2C0 8 1.8 4 6 4c2.2 0 3.8 1.2 6 4 2.2-2.8 3.8-4 6-4 4.2 0 6 4 4 7.8C19 16.4 12 21 12 21z"/></svg></button>';

      var badge = p.is_best_seller ? '<span class="product-badge" aria-label="Best seller">Best Seller</span>' : "";
      var cartIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9.5" cy="21" r="1.4"/><circle cx="17.5" cy="21" r="1.4"/></svg>';

      var actions;
      if (mode === "wishlist") {
        actions = '<div class="product-card-actions">' +
          '<button class="product-add move-to-cart-btn" type="button" data-move-cart="' + idAttr + '"' + (soldOut ? " disabled" : "") + '>' + cartIcon + '<span>Move to Cart</span></button>' +
          '<button type="button" class="btn-icon remove-wish-btn" data-remove-wish="' + idAttr + '" aria-label="Remove ' + nameAttr + ' from wishlist">✕</button></div>';
      } else {
        actions = '<button class="product-add" type="button" data-add-to-cart="' + idAttr + '"' + (soldOut ? ' disabled aria-disabled="true"' : "") + '>' + cartIcon + "<span>" + (soldOut ? "Sold Out" : "Add to Cart") + "</span></button>";
      }

      return '<article class="product-card' + (soldOut ? " is-sold-out" : "") + '" data-product-id="' + idAttr + '"' +
        (p.sku ? ' data-sku="' + escapeHtml(p.sku) + '"' : "") +
        ' data-store-id="' + escapeHtml(p.store_id) + '"' +
        (p.categorySlug ? ' data-category="' + escapeHtml(p.categorySlug) + '"' : "") +
        (p.is_best_seller ? ' data-best-seller="true"' : "") + ">" +
        '<div class="product-media">' + badge + wishBtn +
        '<a href="' + escapeHtml(p.url) + '" class="product-media-link" aria-label="' + nameAttr + '">' + mediaHtml + "</a></div>" +
        '<div class="product-body">' +
        '<div class="product-rating" aria-label="' + (rated ? ratingVal.toFixed(1) + " out of 5 stars, tier " + escapeHtml(tier) : "Not rated yet") + '">' +
        '<span class="stars">' + starsMarkup(ratingVal) + "</span>" +
        (rated ? '<span class="rating-val">' + ratingVal.toFixed(1) + "</span>" : "") +
        (p.ratingCount ? '<span class="rating-count">(' + p.ratingCount + ")</span>" : "") +
        (rated ? '<span class="rating-divider" aria-hidden="true">·</span>' : "") +
        '<span class="rating-tier tier-' + escapeHtml(tier.toLowerCase()) + '">' + escapeHtml(tier) + "</span></div>" +
        '<h3 class="product-name"><a href="' + escapeHtml(p.url) + '">' + escapeHtml(p.name) + "</a></h3>" +
        '<div class="product-pricing"><span class="product-price">' + formatPrice(p.price) + "</span>" +
        (showCompare ? '<span class="product-price-orig">' + formatPrice(p.compareAtPrice) + "</span>" : "") + "</div>" +
        actions + "</div></article>";
    }

    /**
     * A whole grid. Non-array / empty input renders the empty state instead of throwing.
     * options: { isWishlisted:(p)=>bool, mode, emptyHtml, priorityCount (default 4) }
     */
    function productGridHtml(list, options) {
      options = options || {};
      var arr = Array.isArray(list) ? list.filter(Boolean) : [];
      if (!arr.length) return options.emptyHtml || "";
      var prio = options.priorityCount === undefined ? 4 : options.priorityCount;
      var seen = {};
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        var key = p && p.id !== undefined ? String(p.id) : "";
        if (key && seen[key]) continue; // never render the same product twice in one grid
        if (key) seen[key] = 1;
        out.push(productCardHtml(p, {
          mode: options.mode,
          isWishlisted: typeof options.isWishlisted === "function" ? options.isWishlisted(p) : !!options.isWishlisted,
          priority: i < prio
        }));
      }
      return out.join("");
    }

    return {
      normalizeProduct: normalizeProduct,
      normalizeCategory: normalizeCategory,
      categoryMediaHtml: categoryMediaHtml,
      productCardHtml: productCardHtml,
      productGridHtml: productGridHtml,
      matchCategoryQuery: matchCategoryQuery
    };
  }

  return {
    createCatalog: createCatalog,
    matchCategoryQuery: matchCategoryQuery,
    getRatingTier: getRatingTier,
    starsMarkup: starsMarkup,
    escapeHtml: escapeHtml
  };
});
