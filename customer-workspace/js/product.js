/* =========================================================
   CHIPAKK — Product Details Module
   js/product.js

   PRODUCT PAGE ENGINE:
   - URL parameter parsing (?id=...)
   - Image gallery & thumbnail switching
   - Material & size variant selectors
   - Quantity stepper
   - Add to Cart & Buy Now flow
   - Accordion information tabs
   - Related products recommendation
   ========================================================= */

(function () {
  "use strict";

  const {
    getProductById,
    getProducts,
    cart,
    wishlist,
    formatPrice,
    starsMarkup,
    getRatingTier,
    renderProductCard,
    renderProductGrid,
    loader,
    media,
    escapeHtml,
    escapeAttr,
    showToast,
    $,
    $$
  } = window.CHIPAKK;

  let currentProduct = null;
  let selectedMaterial = "Glossy";
  let selectedSize = '3"';
  let quantity = 1;

  function getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "p1";
  }

  /* =========================================================
     1. RENDER PRODUCT DETAILS
     ========================================================= */

  async function renderProductPage() {
    const releaseLoader = loader.hold("product-detail");
    try {
      await renderProductPageInner();
    } catch (err) {
      console.error("[CHIPAKK Product] Failed to render product page:", err);
    } finally {
      releaseLoader();
    }
  }

  async function renderProductPageInner() {
    const productId = getProductIdFromUrl();
    currentProduct = await getProductById(productId);

    if (!currentProduct) {
      const container = $("#main") || $(".container");
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 72px 24px; background: var(--white); border: var(--border-w) solid var(--black); border-radius: var(--radius-lg); box-shadow: var(--shadow-hard); max-width: 600px; margin: 40px auto;">
            <div style="font-size: 64px; margin-bottom: 16px;">🔍</div>
            <h1 style="font-family: var(--font-display); font-size: 28px; text-transform: uppercase; margin-bottom: 12px;">Sticker Not Found</h1>
            <p style="color: #666; font-size: 15px; margin-bottom: 24px; line-height: 1.5;">The sticker you're looking for might have sold out or been removed from the catalog.</p>
            <a href="shop.html" class="btn btn-primary">Browse All Stickers →</a>
          </div>
        `;
      }
      showToast("Product not found");
      return;
    }

    selectedMaterial = (currentProduct.materials && currentProduct.materials[0]) || "Glossy";
    selectedSize = (currentProduct.sizes && currentProduct.sizes[0]) || '3"';
    quantity = 1;

    // Dynamic SEO, Canonical & Meta Synchronization
    const pageTitle = `${currentProduct.name} — CHIPAKK Stickers`;
    document.title = pageTitle;

    const canonicalUrl = `https://chipakk.shop/product.html?id=${encodeURIComponent(currentProduct.id)}`;
    let canonicalLink = $("#canonicalLink") || document.querySelector('link[rel="canonical"]');
    if (canonicalLink) {
      canonicalLink.setAttribute("href", canonicalUrl);
    }

    const prodDesc = currentProduct.description || `${currentProduct.name} waterproof vinyl sticker by CHIPAKK.`;
    const metaDesc = $("#metaDescription") || document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", prodDesc);

    const ogTitle = $("#ogTitle") || document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", pageTitle);

    const ogDesc = $("#ogDescription") || document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", prodDesc);

    const ogUrl = $("#ogUrl") || document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", canonicalUrl);

    const twitterTitle = $("#twitterTitle") || document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute("content", pageTitle);

    const twitterDesc = $("#twitterDescription") || document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) twitterDesc.setAttribute("content", prodDesc);

    // Product images: the normalized product already carries resolved URLs (js/media.js)
    const gallery = Array.isArray(currentProduct.images) ? currentProduct.images.filter(Boolean) : [];
    const primaryUrl = currentProduct.imageUrl || gallery[0] || "";
    const absoluteImgUrl = primaryUrl
      ? (/^https?:\/\//i.test(primaryUrl) ? primaryUrl : `https://chipakk.shop/${primaryUrl.replace(/^\/+/, "")}`)
      : "https://chipakk.shop/assets/images/logo.png";

    const ogImg = $("#ogImage") || document.querySelector('meta[property="og:image"]');
    if (ogImg) ogImg.setAttribute("content", absoluteImgUrl);
    const twImg = $("#twitterImage") || document.querySelector('meta[name="twitter:image"]');
    if (twImg) twImg.setAttribute("content", absoluteImgUrl);

    // Inject Dynamic JSON-LD Structured Data
    let schemaScript = $("#productSchemaJsonLd");
    if (!schemaScript) {
      schemaScript = document.createElement("script");
      schemaScript.type = "application/ld+json";
      schemaScript.id = "productSchemaJsonLd";
      document.head.appendChild(schemaScript);
    }

    const ratingVal = typeof currentProduct.rating === "number" ? currentProduct.rating : (parseFloat(currentProduct.rating) || 0);
    const ratingCount = currentProduct.ratingCount !== undefined ? currentProduct.ratingCount : (currentProduct.review_count !== undefined ? currentProduct.review_count : 0);

    const productSchema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          "@id": `${canonicalUrl}#product`,
          "name": currentProduct.name,
          "image": (gallery.length ? gallery : [absoluteImgUrl]),
          "description": prodDesc,
          "sku": String(currentProduct.id),
          "brand": {
            "@type": "Brand",
            "name": "CHIPAKK"
          },
          "offers": {
            "@type": "Offer",
            "url": canonicalUrl,
            "priceCurrency": "INR",
            "price": String(currentProduct.price),
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition"
          },
          ...(ratingCount > 0 ? {
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": ratingVal.toFixed(1),
              "reviewCount": ratingCount
            }
          } : {})
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "name": "Home",
              "item": "https://chipakk.shop/"
            },
            {
              "@type": "ListItem",
              "position": 2,
              "name": currentProduct.categoryName || "Shop",
              "item": currentProduct.categorySlug ? `https://chipakk.shop/shop.html?category=${encodeURIComponent(currentProduct.categorySlug)}` : "https://chipakk.shop/shop.html"
            },
            {
              "@type": "ListItem",
              "position": 3,
              "name": currentProduct.name,
              "item": canonicalUrl
            }
          ]
        }
      ]
    };
    schemaScript.textContent = JSON.stringify(productSchema, null, 2);

    // Breadcrumb / Category
    const catEl = $("#prodDetailCategory");
    if (catEl) {
      catEl.textContent = currentProduct.categoryName || "Stickers";
      catEl.href = `shop.html?category=${encodeURIComponent(currentProduct.categorySlug || 'all')}`;
    }

    // Title
    const titleEl = $("#prodDetailTitle");
    if (titleEl) titleEl.textContent = currentProduct.name;

    // Price
    const priceEl = $("#prodDetailPrice");
    if (priceEl) {
      priceEl.innerHTML = `
        <span>${formatPrice(currentProduct.price)}</span>
        ${currentProduct.compareAtPrice ? `<span class="product-price-orig">${formatPrice(currentProduct.compareAtPrice)}</span>` : ""}
      `;
    }

    // Reviews
    const reviewsEl = $("#prodDetailReviews");
    if (reviewsEl) {
      const tier = currentProduct.rating_tier || getRatingTier(currentProduct.rating);
      reviewsEl.innerHTML = `
        <span class="stars">${starsMarkup(currentProduct.rating)}</span>
        <span style="font-weight:700;">${currentProduct.rating.toFixed(1)} (${currentProduct.ratingCount} reviews)</span>
        <span class="rating-divider" aria-hidden="true" style="margin: 0 4px; color: #999;">·</span>
        <span class="rating-tier tier-${tier.toLowerCase()}">${escapeHtml(tier)}</span>
      `;
    }

    // Description
    const descEl = $("#prodDetailDesc");
    if (descEl) descEl.textContent = currentProduct.description;

    // Main stage: the first image is the LCP element, so it loads eagerly with high priority
    const stageEl = $("#prodStageArt");
    const stageImageHtml = (url, priority) => url
      ? media.imgHtml({ src: url, alt: `${currentProduct.name} sticker`, cls: "product-stage-img", width: 600, height: 600, priority })
      : `<span class="product-stage-emoji" aria-hidden="true">⚡</span>`;
    if (stageEl) {
      const tier = currentProduct.rating_tier || getRatingTier(currentProduct.rating);
      stageEl.innerHTML = `
        <span class="product-stage-slot">${stageImageHtml(primaryUrl, true)}</span>
        <span class="product-stage-badge tier-${escapeHtml(tier.toLowerCase())}">${escapeHtml(tier)}</span>
      `;
    }

    // Thumbnails: one per real image (nothing invented when a product has a single image)
    const thumbsContainer = $("#galleryThumbs");
    if (thumbsContainer) {
      if (gallery.length > 1) {
        thumbsContainer.innerHTML = gallery.map((url, idx) => `
          <button type="button" class="gallery-thumb ${idx === 0 ? 'is-active' : ''}" data-thumb-idx="${idx}" aria-label="View image ${idx + 1} of ${gallery.length}">
            ${media.imgHtml({ src: url, alt: "", width: 80, height: 80 })}
          </button>
        `).join("");

        thumbsContainer.addEventListener("click", (e) => {
          const btn = e.target.closest(".gallery-thumb");
          if (!btn || !stageEl) return;
          thumbsContainer.querySelectorAll(".gallery-thumb").forEach(b => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          const slot = stageEl.querySelector(".product-stage-slot");
          if (slot) slot.innerHTML = stageImageHtml(gallery[Number(btn.dataset.thumbIdx)] || primaryUrl, false);
        });
      } else {
        thumbsContainer.innerHTML = "";
      }
    }

    // Materials Selector
    const materialContainer = $("#materialPills");
    const materialLabel = $("#selectedMaterialLabel");
    if (materialContainer) {
      const materials = currentProduct.materials || ["Glossy", "Matte", "Holographic", "Transparent"];
      materialContainer.innerHTML = materials.map((mat, idx) => `
        <button type="button" class="option-pill-btn ${idx === 0 ? 'is-active' : ''}" data-option-val="${escapeAttr(mat)}">
          ${escapeHtml(mat)}
        </button>
      `).join("");

      if (materialLabel) materialLabel.textContent = selectedMaterial;

      materialContainer.addEventListener("click", (e) => {
        const btn = e.target.closest(".option-pill-btn");
        if (!btn) return;
        materialContainer.querySelectorAll(".option-pill-btn").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        selectedMaterial = btn.dataset.optionVal;
        if (materialLabel) materialLabel.textContent = selectedMaterial;
      });
    }

    // Size Selector
    const sizeContainer = $("#sizePills");
    const sizeLabel = $("#selectedSizeLabel");
    if (sizeContainer) {
      const sizes = currentProduct.sizes || ['2"', '3"', '4"'];
      sizeContainer.innerHTML = sizes.map((sz, idx) => `
        <button type="button" class="option-pill-btn ${idx === 0 ? 'is-active' : ''}" data-option-val="${escapeAttr(sz)}">
          ${escapeHtml(sz)}
        </button>
      `).join("");

      if (sizeLabel) sizeLabel.textContent = selectedSize;

      sizeContainer.addEventListener("click", (e) => {
        const btn = e.target.closest(".option-pill-btn");
        if (!btn) return;
        sizeContainer.querySelectorAll(".option-pill-btn").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        selectedSize = btn.dataset.optionVal;
        if (sizeLabel) sizeLabel.textContent = selectedSize;
      });
    }

    // Quantity Counter
    const qtyValEl = $("#qtyVal");
    $("#qtyDecBtn")?.addEventListener("click", () => {
      if (quantity > 1) {
        quantity--;
        if (qtyValEl) qtyValEl.textContent = String(quantity);
      }
    });
    $("#qtyIncBtn")?.addEventListener("click", () => {
      quantity++;
      if (qtyValEl) qtyValEl.textContent = String(quantity);
    });

    // Add to Cart Button
    const addBtn = $("#addToCartBtn");
    if (addBtn) {
      addBtn.onclick = () => {
        cart.addItem(currentProduct, quantity, { material: selectedMaterial, size: selectedSize });
        addBtn.textContent = "Added to Cart ✓";
        setTimeout(() => {
          addBtn.textContent = "Add to Cart";
        }, 1400);
      };
    }

    // Buy Now Button
    const buyBtn = $("#buyNowBtn");
    if (buyBtn) {
      buyBtn.onclick = () => {
        cart.addItem(currentProduct, quantity, { material: selectedMaterial, size: selectedSize });
        window.location.href = "checkout.html";
      };
    }

    // Wishlist Button
    const wishBtn = $("#prodWishlistBtn");
    if (wishBtn) {
      const isWishlisted = wishlist.has(currentProduct.id);
      wishBtn.classList.toggle("is-active", isWishlisted);
      wishBtn.onclick = () => {
        const active = wishlist.toggle(currentProduct.id);
        wishBtn.classList.toggle("is-active", active);
      };
    }

    // Accordions
    $$(".accordion-toggle").forEach(toggle => {
      toggle.addEventListener("click", () => {
        const item = toggle.closest(".accordion-item");
        if (item) item.classList.toggle("is-open");
      });
    });

    // Related Products
    renderRelatedProducts(currentProduct);
  }

  /* =========================================================
     2. RELATED PRODUCTS RECOMMENDATION
     ========================================================= */

  async function renderRelatedProducts(prod) {
    const grid = $("#relatedProductsGrid");
    if (!grid) return;

    const all = await getProducts();
    const others = all.filter(p => String(p.id) !== String(prod.id));
    // Same category first, then the rest of the catalog
    const sameCategory = others.filter(p => prod.categorySlug && p.categorySlug === prod.categorySlug);
    const rest = others.filter(p => !sameCategory.includes(p));
    const related = [...sameCategory, ...rest].slice(0, 4);

    grid.innerHTML = renderProductGrid(related, { isWishlisted: (p) => wishlist.has(p.id), priorityCount: 0 });

    grid.addEventListener("click", (e) => {
      // Add to cart delegation
      const btn = e.target.closest("[data-add-to-cart], [data-quick-add]");
      if (btn) {
        const pId = btn.dataset.addToCart || btn.dataset.quickAdd;
        const target = all.find(x => String(x.id) === String(pId));
        if (target) {
          cart.addItem(target, 1);
          const origHtml = btn.innerHTML;
          btn.textContent = "Added ✓";
          setTimeout(() => { btn.innerHTML = origHtml; }, 1200);
        }
      }

      // Wishlist delegation
      const wishBtn = e.target.closest("[data-wishlist-id]");
      if (wishBtn) {
        const pId = wishBtn.dataset.wishlistId;
        const active = wishlist.toggle(pId);
        wishBtn.classList.toggle("is-active", active);
        wishBtn.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderProductPage);
  } else {
    renderProductPage();
  }

})();
