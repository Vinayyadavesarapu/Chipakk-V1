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
    renderProductGrid,
    categoryMediaHtml,
    loader,
    media,
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
      const rawImg = slideData.image_url || slideData.image || "assets/images/hero.png";
      const cleanImg = (!rawImg || rawImg.includes("hero-fallback.svg") || rawImg.includes("hero-banner-1.png")) ? "assets/images/hero.png" : rawImg;
      const imgSrc = media.resolve(cleanImg) || "assets/images/hero.png";
      const imgAltRaw = slideData.imageAlt || slideData.title || "CHIPAKK Sticker Culture";

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
              <!-- Neo-Brutalist Doodles, Scribbles & Accents -->
              <svg class="hero-scribble scribble-1" viewBox="0 0 80 80" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round">
                <path d="M10 10 L70 70 M70 10 L10 70"/>
              </svg>
              <svg class="hero-scribble scribble-2" viewBox="0 0 100 40" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round">
                <path d="M2 20 Q 20 2, 38 20 T 74 20 T 98 20"/>
              </svg>

              <!-- Main Artwork Photo Frame -->
              <div class="hero-photo-frame">
                ${media.imgHtml({ src: imgSrc, alt: imgAltRaw, cls: "hero-photo-img", width: 600, height: 600, priority: true, fallbackSrc: "assets/images/hero-fallback.svg" })}
              </div>

              <!-- Hand-Drawn Stickers, Speech Bubbles & Accents -->
              <div class="hero-doodle doodle-bubble">Small stickers.<br />Big personality.</div>
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

  function renderCategoriesPreview(categories) {
    const grid = $("#categoriesGrid");
    if (!grid) return;

    const list = (categories || []).filter(c => c.active !== false).slice(0, 8);
    grid.innerHTML = list.map(c => `
      <a href="shop.html?category=${encodeURIComponent(c.slug)}" class="category-card" data-category-id="${escapeAttr(c.id)}">
        <span class="cat-icon-wrap" aria-hidden="true">${categoryMediaHtml(c)}</span>
        <span class="cat-name">${escapeHtml(c.name)}</span>
        <span style="font-size:11px;color:#777;margin-top:2px;">${Number(c.productCount) || 0}+ designs</span>
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

    grid.innerHTML = renderProductGrid(finalProducts, { isWishlisted: (p) => wishlist.has(p.id) });
  }

  /* =========================================================
     4. NEW DROP & PROMOTION SECTION
     ========================================================= */

  let dropCountdownUnsub = null;
  function renderDropSection(events) {
    const dropSection = $("#drop");
    const titleEl = $(".drop-title");
    const descEl = $(".drop-desc");
    const badgeEl = $(".drop-badge");
    const ribbonEl = $(".drop-ribbon");
    const cardTitleEl = $(".drop-card-title");
    const ctaEl = $(".drop-copy .btn");
    const eyebrowEl = $(".drop-copy .eyebrow");
    const timerEl = $(".drop-timer");
    const daysEl = $("#timerDays");
    const hoursEl = $("#timerHours");
    const minsEl = $("#timerMins");
    const secsEl = $("#timerSecs");

    if (dropCountdownUnsub) {
      dropCountdownUnsub();
      dropCountdownUnsub = null;
    }

    const countdown = typeof window !== "undefined" ? window.CHIPAKK_COUNTDOWN : null;

    // Locate active event or genuine store sale setting
    const eventList = Array.isArray(events) ? events : [];
    const activeEvent = eventList.find(e => e && e.active && e.endsAt && e.endsAt > Date.now()) || null;

    let genuineEndsAt = null;
    if (activeEvent && activeEvent.endsAt) {
      genuineEndsAt = activeEvent.endsAt;
    } else if (typeof window !== "undefined") {
      if (window.CHIPAKK_SALE_END) {
        const parsedWindow = new Date(window.CHIPAKK_SALE_END).getTime();
        if (!isNaN(parsedWindow) && parsedWindow > Date.now()) genuineEndsAt = parsedWindow;
      } else if (window.CHIPAKK_DATA && window.CHIPAKK_DATA.settings && window.CHIPAKK_DATA.settings.saleEndTime) {
        const parsedSettings = new Date(window.CHIPAKK_DATA.settings.saleEndTime).getTime();
        if (!isNaN(parsedSettings) && parsedSettings > Date.now()) genuineEndsAt = parsedSettings;
      }
    }

    if (genuineEndsAt) {
      if (countdown) countdown.setTarget(genuineEndsAt);
      if (eyebrowEl) eyebrowEl.textContent = activeEvent && activeEvent.eventType === "SALE" ? "LIMITED-TIME SALE" : "SPECIAL PROMOTION";
      if (titleEl) titleEl.textContent = activeEvent?.title || "SPECIAL STICKER SALE";
      if (descEl) descEl.textContent = activeEvent?.description || "Special promotional pricing available across select stickers and collections.";
      if (badgeEl) badgeEl.textContent = "⚡ SALE EVENT";
      if (cardTitleEl) cardTitleEl.textContent = "STICKER SALE";
      if (ribbonEl) ribbonEl.textContent = "SALE";
      if (ctaEl) {
        ctaEl.textContent = (activeEvent?.cta || "EXPLORE ALL STICKERS") + " →";
        ctaEl.setAttribute("href", activeEvent?.ctaLink || "shop.html");
      }
    } else {
      // Clean, honest unconfigured state (no fake deadlines, no fake discounts, no fake weekly releases)
      if (countdown) countdown.setTarget(null);
      if (eyebrowEl) eyebrowEl.textContent = "SPECIAL PROMOTION";
      if (titleEl) titleEl.textContent = "YOUR VIBE. YOUR STICKERS.";
      if (descEl) descEl.textContent = "From everyday essentials to your favorite aesthetic, discover stickers that make every surface a little more you.";
      if (badgeEl) badgeEl.textContent = "⚡ SPECIAL PROMOTION";
      if (cardTitleEl) cardTitleEl.textContent = "STICKER DEALS";
      if (ribbonEl) ribbonEl.textContent = "PROMO";
      if (timerEl) timerEl.style.display = "none";
      if (ctaEl) {
        ctaEl.textContent = "EXPLORE ALL STICKERS →";
        ctaEl.setAttribute("href", "shop.html");
      }
    }

    if (countdown && typeof countdown.subscribe === "function") {
      dropCountdownUnsub = countdown.subscribe(function (state) {
        if (!state || !state.isValid) {
          if (timerEl) timerEl.style.display = "none";
          return;
        }

        if (state.isExpired) {
          if (timerEl) timerEl.style.display = "none";
          if (descEl) {
            descEl.textContent = "This promotional sale has ended. Stay tuned for upcoming special offers!";
          }
          return;
        }

        if (timerEl) timerEl.style.display = "flex";
        if (daysEl) daysEl.textContent = String(state.days).padStart(2, "0");
        if (hoursEl) hoursEl.textContent = String(state.hours).padStart(2, "0");
        if (minsEl) minsEl.textContent = String(state.minutes).padStart(2, "0");
        if (secsEl) secsEl.textContent = String(state.seconds).padStart(2, "0");
      });
      countdown.start();
    }
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
          const triggerAdded = () => {
            addBtn.classList.add("is-added");
            const origHtml = addBtn.innerHTML;
            addBtn.innerHTML = "Added ✓";
            setTimeout(() => {
              addBtn.classList.remove("is-added");
              addBtn.innerHTML = origHtml;
            }, 1200);
          };
          const added = cart.addItem(product, 1, { onAdded: triggerAdded });
          if (added) {
            triggerAdded();
          }
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
     6. PROMO VIDEO OBSERVER & CONTROLLER
     ========================================================= */

  function initPromoVideo() {
    const video = document.getElementById("promoVideo");
    if (!video) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let isSourceAttached = false;
    function attachSource() {
      if (isSourceAttached) return;
      isSourceAttached = true;
      const source = video.querySelector("source[data-src]");
      if (source && source.dataset.src) {
        source.src = source.dataset.src;
        video.load();
      } else if (video.dataset.src) {
        video.src = video.dataset.src;
        video.load();
      }
    }

    function playVideo() {
      if (prefersReducedMotion.matches) return;
      attachSource();
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay policy or low power mode - poster remains cleanly visible
        });
      }
    }

    function pauseVideo() {
      if (!video.paused) {
        video.pause();
      }
    }

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            playVideo();
          } else {
            pauseVideo();
          }
        });
      }, {
        root: null,
        rootMargin: "200px 0px", // Preload slightly before scrolling into view
        threshold: 0.15
      });

      observer.observe(video);
    } else {
      // Fallback: attach source and attempt play
      playVideo();
    }

    if (prefersReducedMotion.addEventListener) {
      prefersReducedMotion.addEventListener("change", (e) => {
        if (e.matches) {
          pauseVideo();
        }
      });
    }
  }

  /* =========================================================
     7. INITIALIZE HOME PAGE
     ========================================================= */

  function initHome() {
    // Critical initial content = categories + trending products. The static hero is already in
    // the HTML and events are decorative, so neither holds the loader.
    const releaseLoader = loader.hold("home-content");
    initProductEvents();
    initPromoVideo();

    Promise.allSettled([
      getCategories().then(renderCategoriesPreview),
      getProducts().then(renderTrendingProducts)
    ]).then((results) => {
      results.forEach((r) => { if (r.status === "rejected") console.error("[CHIPAKK Home] Section failed to render:", r.reason); });
    }).finally(releaseLoader);

    getHeroData().then(renderHero).catch((err) => console.error("[CHIPAKK Home] Hero failed to render:", err));
    getEvents().then(renderDropSection).catch((err) => console.error("[CHIPAKK Home] Drop section failed to render:", err));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHome);
  } else {
    initHome();
  }

})();
