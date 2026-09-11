/* =========================================================
   CHIPAKK — Home Page Module
   js/home.js
   
   BACKEND-DRIVEN HERO & HOMEPAGE SECTIONS:
   - renderHero(heroData) mounts the editorial hero from data
   - renderCategoriesPreview()
   - renderTrendingProducts()
   - renderDropSection()
   ========================================================= */

(function () {
  "use strict";

  const {
    getHeroData,
    getCategories,
    getProducts,
    getEvents,
    cart,
    wishlist,
    formatPrice,
    starsMarkup,
    renderProductCard,
    escapeHtml,
    escapeAttr,
    showToast,
    $,
    $$
  } = window.CHIPAKK;

  /* =========================================================
     1. DYNAMIC BACKEND-DRIVEN HERO RENDERER
     ========================================================= */

  let heroSlideInterval = null;

  function renderHero(hero) {
    const mount = $("#heroMount");
    if (!mount) return;

    if (heroSlideInterval) {
      clearInterval(heroSlideInterval);
      heroSlideInterval = null;
    }

    if (!hero || hero.enabled === false) {
      mount.innerHTML = "";
      return;
    }

    const mode = hero.mode === "carousel" ? "carousel" : "fixed";
    const slides = Array.isArray(hero.slides) && hero.slides.length > 0 ? hero.slides : null;

    let activeSlideIndex = 0;

    function buildSlideHtml(slideData, isCarousel) {
      const showEyebrow = slideData.show_eyebrow !== false;
      const showTitle = slideData.show_title !== false;
      const showDesc = slideData.show_description !== false;
      const showPrimaryBtn = slideData.show_primary_btn !== false;
      const showSecondaryBtn = !isCarousel && slideData.show_secondary_btn !== false;

      const eyebrow = escapeHtml(slideData.eyebrow || "New designs every week");
      const line1 = escapeHtml(slideData.titleLine1 || slideData.title || "STICK");
      const line2 = escapeHtml(slideData.titleLine2 || (!isCarousel ? "YOUR" : ""));
      const line3 = escapeHtml(slideData.titleLine3 || (!isCarousel ? "WORLD." : ""));
      const accentLine = slideData.accentLine || 3;
      const desc = escapeHtml(slideData.description || slideData.subtitle || "Premium stickers for a bolder, brighter, more you.");
      const pBtnText = escapeHtml(slideData.primaryButtonText || slideData.cta_text || "Shop Now →");
      const pBtnLink = escapeAttr(slideData.primaryButtonLink || slideData.cta_url || slideData.target_url || "shop.html");
      const sBtnText = escapeHtml(slideData.secondaryButtonText || "Custom Stickers");
      const sBtnLink = escapeAttr(slideData.secondaryButtonLink || "custom-stickers.html");

      const hasImg = Boolean(slideData.image_url || slideData.image);
      const imgSrc = slideData.image_url || slideData.image || "assets/images/logo.png";
      const imgAlt = escapeAttr(slideData.imageAlt || slideData.title || "CHIPAKK Sticker Culture");

      const stats = Array.isArray(slideData.stats) ? slideData.stats : (hero.stats || [
        { value: "500+", label: "Original designs" },
        { value: "50k+", label: "Stickers shipped" },
        { value: "4.8★", label: "Average rating" }
      ]);

      const eyebrowHtml = showEyebrow ? `
        <span class="hero-tag">
          <span class="dot"></span>
          ${eyebrow}
        </span>
      ` : '';

      const titleHtml = showTitle ? `
        <h1 class="hero-title">
          <span class="${accentLine === 1 ? 'line-accent' : ''}">${line1}</span>
          ${line2 ? `<span class="${accentLine === 2 ? 'line-accent' : ''}">${line2}</span>` : ''}
          ${line3 ? `<span class="${accentLine === 3 ? 'line-accent' : ''}">${line3}</span>` : ''}
        </h1>
      ` : '';

      const descHtml = showDesc ? `
        <p class="hero-desc">${desc}</p>
      ` : '';

      const hasAnyBtn = showPrimaryBtn || showSecondaryBtn;
      const ctasHtml = hasAnyBtn ? `
        <div class="hero-ctas">
          ${showPrimaryBtn ? `<a href="${pBtnLink}" class="btn btn-primary">${pBtnText}</a>` : ''}
          ${showSecondaryBtn ? `<a href="${sBtnLink}" class="btn btn-custom-cta">${sBtnText}</a>` : ''}
        </div>
      ` : '';

      const carouselControlsHtml = isCarousel && slides && slides.length > 1 ? `
        <div class="hero-carousel-dots" style="display:flex;gap:8px;margin-top:16px;align-items:center;">
          ${slides.map((_, idx) => `
            <button type="button" class="carousel-dot-btn" data-slide-to="${idx}" aria-label="Go to slide ${idx + 1}" style="width:${idx === activeSlideIndex ? '28px' : '10px'};height:10px;border-radius:999px;background:${idx === activeSlideIndex ? 'var(--yellow)' : 'rgba(0,0,0,0.2)'};border:2px solid var(--black);cursor:pointer;padding:0;transition:all 0.2s ease;"></button>
          `).join('')}
        </div>
      ` : '';

      return `
        <section class="hero hero-${mode}" id="heroSection">
          <div class="hero-inner">
            <!-- LEFT: Dynamic Copy & Actions -->
            <div class="hero-copy">
              ${eyebrowHtml}
              ${titleHtml}
              ${descHtml}
              ${ctasHtml}
              ${carouselControlsHtml}

              <div class="hero-stats">
                ${stats.map(s => `
                  <div class="hero-stat">
                    <b>${escapeHtml(s.value)}</b>
                    <span>${escapeHtml(s.label)}</span>
                  </div>
                `).join("")}
              </div>
            </div>

            <!-- RIGHT: Large Expressive Visual Artwork Canvas -->
            <div class="hero-visual" aria-hidden="true">
              <!-- Neo-Brutalist Doodles, Scribbles & Arrows -->
              <svg class="hero-scribble scribble-1" viewBox="0 0 80 80" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round">
                <path d="M10 10 L70 70 M70 10 L10 70"/>
              </svg>
              <svg class="hero-scribble scribble-2" viewBox="0 0 100 40" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round">
                <path d="M2 20 Q 20 2, 38 20 T 74 20 T 98 20"/>
              </svg>
              <svg class="hero-scribble scribble-arrow" viewBox="0 0 60 60" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M50 12 Q 20 10 14 40 M14 40 l-8-10 M14 40 l12-4"/>
              </svg>

              <!-- Main Artwork Photo Frame -->
              <div class="hero-photo-frame">
                <img src="${escapeAttr(imgSrc || 'assets/images/hero-fallback.svg')}" alt="${imgAlt}" data-hero-img onerror="if(!this.dataset.failed){this.dataset.failed='true';this.src='assets/images/hero-fallback.svg';}" style="width:100%;height:100%;object-fit:cover;display:block;" />
              </div>

              <!-- Hand-Drawn Stickers, Speech Bubbles & Accents -->
              <div class="hero-doodle doodle-bubble">Small stickers.<br />Big personality.</div>
              <div class="hero-doodle doodle-crown">👑</div>
              <div class="hero-doodle doodle-burst">Good ideas<br />stick around</div>
              <div class="hero-doodle doodle-note">Life is better<br />with stickers ♥</div>
              <div class="hero-doodle doodle-star">★</div>
            </div>
          </div>
        </section>
      `;
    }

    function renderCurrent() {
      if (mode === "carousel" && slides && slides.length > 0) {
        const currentSlide = slides[activeSlideIndex] || slides[0];
        mount.innerHTML = buildSlideHtml(currentSlide, true);
        const dots = mount.querySelectorAll(".carousel-dot-btn");
        dots.forEach(btn => {
          btn.addEventListener("click", () => {
            activeSlideIndex = parseInt(btn.dataset.slideTo, 10) || 0;
            renderCurrent();
          });
        });
      } else {
        mount.innerHTML = buildSlideHtml(hero, false);
      }
    }

    renderCurrent();

    if (mode === "carousel" && slides && slides.length > 1) {
      heroSlideInterval = setInterval(() => {
        activeSlideIndex = (activeSlideIndex + 1) % slides.length;
        renderCurrent();
      }, 5000);
    }
  }

  /* =========================================================
     2. SHOP BY CATEGORY PREVIEW
     ========================================================= */

  function renderCategoryMedia(c) {
    const raw = c.image_url || c.image;
    const isUrl = typeof raw === "string" && (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("/") ||
      raw.startsWith("assets/") ||
      raw.includes("/") ||
      /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw)
    );
    if (isUrl) {
      return `<img src="${escapeAttr(raw)}" alt="${escapeAttr(c.name)} sticker category" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
    }
    return `<span>${escapeHtml(c.icon || c.image || "✨")}</span>`;
  }

  function renderCategoriesPreview(categories) {
    const grid = $("#categoriesGrid");
    if (!grid) return;

    const list = (categories || []).filter(c => c.active !== false).slice(0, 8);
    grid.innerHTML = list.map(c => `
      <a href="shop.html?category=${encodeURIComponent(c.slug)}" class="category-card" data-category-id="${c.id}">
        <span class="cat-icon-wrap" aria-hidden="true">${renderCategoryMedia(c)}</span>
        <span class="cat-name">${escapeHtml(c.name)}</span>
        <span style="font-size:11px;color:#777;margin-top:2px;">${c.productCount || 0}+ designs</span>
      </a>
    `).join("");
  }

  /* =========================================================
     3. TRENDING STICKERS GRID
     ========================================================= */

  function renderTrendingProducts(products) {
    const grid = $("#productsGrid");
    if (!grid) return;

    const all = Array.isArray(products) ? products.filter(p => p && p.active !== false) : [];

    // Prioritize real backend featured products, then top-rated (>= 4.7), then latest
    const featured = all.filter(p => p.featured === true || p.featured === 1);
    let selected = [...featured];

    if (selected.length < 6) {
      const topRated = all
        .filter(p => !selected.some(s => s.id === p.id) && (p.rating >= 4.7))
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));
      selected.push(...topRated);
    }

    if (selected.length < 6) {
      const remaining = all.filter(p => !selected.some(s => s.id === p.id));
      selected.push(...remaining);
    }

    const finalProducts = selected.slice(0, 6);

    if (finalProducts.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: var(--white); border: var(--border-w) solid var(--black); border-radius: var(--radius-lg); box-shadow: var(--shadow-hard);">
          <p style="font-weight: 700; text-transform: uppercase;">New stickers dropping soon!</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = finalProducts.map(p => renderProductCard(p, { isWishlisted: wishlist.has(p.id) })).join("");
  }

  /* =========================================================
     4. NEW DROP & PROMOTION SECTION
     ========================================================= */

  let dropTimerInterval = null;
  function renderDropSection(events) {
    const dropSection = $("#drop");
    const titleEl = $(".drop-title");
    const descEl = $(".drop-desc");
    const ribbonEl = $(".drop-ribbon");
    const ctaEl = $(".drop-copy .btn");
    const eyebrowEl = $(".drop-copy .eyebrow");
    const timerEl = $(".drop-timer");

    if (!events || !events.length) {
      // Clean fallback state when no live event exists
      if (eyebrowEl) eyebrowEl.textContent = "Weekly releases";
      if (titleEl) titleEl.textContent = "Next Sticker Drop Incoming";
      if (descEl) descEl.textContent = "We create and drop limited-edition artist sticker packs every week. Follow along and explore our active catalog in the meantime.";
      if (ribbonEl) ribbonEl.textContent = "DROPS";
      if (ctaEl) {
        ctaEl.textContent = "Explore All Stickers →";
        ctaEl.setAttribute("href", "shop.html");
      }
      if (timerEl) timerEl.style.display = "none";
      if (dropTimerInterval) clearInterval(dropTimerInterval);
      return;
    }

    const drop = events[0];

    if (eyebrowEl) eyebrowEl.textContent = "This week only";
    if (titleEl) titleEl.textContent = drop.title;
    if (descEl) descEl.textContent = drop.description;
    if (ribbonEl) ribbonEl.textContent = drop.ribbon || "LIMITED DROP";
    if (ctaEl) {
      ctaEl.textContent = (drop.cta || "Shop The Drop") + " →";
      ctaEl.setAttribute("href", drop.ctaLink || "shop.html");
    }
    if (timerEl) timerEl.style.display = "flex";

    const daysEl = $("#timerDays");
    const hoursEl = $("#timerHours");
    const minsEl = $("#timerMins");

    function tick() {
      const diff = Math.max(0, drop.endsAt - Date.now());
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / (1000 * 60)) % 60);

      if (daysEl) daysEl.textContent = String(days).padStart(2, "0");
      if (hoursEl) hoursEl.textContent = String(hours).padStart(2, "0");
      if (minsEl) minsEl.textContent = String(mins).padStart(2, "0");

      if (diff <= 0) clearInterval(dropTimerInterval);
    }

    tick();
    clearInterval(dropTimerInterval);
    dropTimerInterval = setInterval(tick, 60 * 1000);
  }

  /* =========================================================
     5. GLOBAL EVENT DELEGATION FOR PRODUCTS
     ========================================================= */

  function initProductEvents() {
    document.addEventListener("click", async (e) => {
      // Add to Cart
      const addBtn = e.target.closest("[data-add-to-cart]");
      if (addBtn) {
        const pId = addBtn.dataset.addToCart;
        const products = await getProducts();
        const product = products.find(p => p.id === pId);
        if (product) {
          cart.addItem(product, 1);
          addBtn.classList.add("is-added");
          const origHtml = addBtn.innerHTML;
          addBtn.innerHTML = "Added ✓";
          setTimeout(() => {
            addBtn.classList.remove("is-added");
            addBtn.innerHTML = origHtml;
          }, 1200);
        }
        return;
      }

      // Wishlist toggle
      const wishBtn = e.target.closest("[data-wishlist-id]");
      if (wishBtn) {
        const pId = wishBtn.dataset.wishlistId;
        const isNowAdded = wishlist.toggle(pId);
        wishBtn.classList.toggle("is-active", isNowAdded);
        wishBtn.setAttribute("aria-pressed", String(isNowAdded));
        return;
      }
    });
  }

  /* =========================================================
     6. INITIALIZE HOME PAGE
     ========================================================= */

  function initHome() {
    initProductEvents();

    getHeroData().then(renderHero);
    getCategories().then(renderCategoriesPreview);
    getProducts().then(renderTrendingProducts);
    getEvents().then(renderDropSection);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }

})();
