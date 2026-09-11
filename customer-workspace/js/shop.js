/* =========================================================
   CHIPAKK — Shop Page Module
   js/shop.js
   
   E-COMMERCE CATALOG ENGINE:
   - URL-aware category and search filtering (?category=..., ?search=...)
   - Dynamic category filter pills
   - Sorting: Featured, Price Low/High, Top Rated
   - CHIPAKK product cards with Wishlist and Add to Cart
   - Pagination / Load More
   ========================================================= */

(function () {
  "use strict";

  const {
    getProducts,
    getCategories,
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

  let allProducts = [];
  let allCategories = [];
  let currentCategory = "all";
  let currentSearch = "";
  let currentSort = "featured";
  let visibleCount = 8;
  const PAGE_SIZE = 8;

  /* =========================================================
     1. PARSE URL PARAMS
     ========================================================= */

  function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    currentCategory = params.get("category") || "all";
    currentSearch = params.get("search") || "";
    currentSort = params.get("sort") || "featured";
  }

  function updateUrl(push = true) {
    const params = new URLSearchParams();
    if (currentCategory && currentCategory !== "all") params.set("category", currentCategory);
    if (currentSearch) params.set("search", currentSearch);
    if (currentSort && currentSort !== "featured") params.set("sort", currentSort);

    const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    if (push) {
      window.history.pushState({ category: currentCategory, search: currentSearch, sort: currentSort }, "", newUrl);
    } else {
      window.history.replaceState({ category: currentCategory, search: currentSearch, sort: currentSort }, "", newUrl);
    }
  }

  /* =========================================================
     2. RENDER CATEGORY PILLS
     ========================================================= */

  function renderCategoryPills() {
    const container = $("#categoryPills");
    if (!container) return;

    let html = `
      <button type="button" class="filter-pill ${currentCategory === 'all' ? 'is-active' : ''}" data-cat-slug="all">
        ALL STICKERS
      </button>
    `;

    allCategories.forEach(cat => {
      const isActive = currentCategory === cat.slug;
      html += `
        <button type="button" class="filter-pill ${isActive ? 'is-active' : ''}" data-cat-slug="${escapeAttr(cat.slug)}">
          ${escapeHtml(cat.name)}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  /* =========================================================
     3. FILTER & SORT PRODUCTS
     ========================================================= */

  function getFilteredProducts() {
    let list = Array.isArray(allProducts) ? [...allProducts].filter(p => p && p.active !== false) : [];

    // Filter by Category
    if (currentCategory && currentCategory !== "all") {
      const activeCat = allCategories.find(c => c.slug === currentCategory);
      if (activeCat) {
        list = list.filter(p => 
          (p.categoryId !== undefined && String(p.categoryId) === String(activeCat.id)) ||
          (p.categorySlug && p.categorySlug === activeCat.slug) ||
          (p.categoryName && activeCat.name && p.categoryName.toLowerCase() === activeCat.name.toLowerCase())
        );
      } else {
        list = list.filter(p => p.categorySlug && p.categorySlug === currentCategory);
      }
    }

    // Filter by Search Query
    if (currentSearch) {
      const q = currentSearch.toLowerCase().trim();
      list = list.filter(p => {
        return (p.name && p.name.toLowerCase().includes(q)) ||
               (p.description && p.description.toLowerCase().includes(q)) ||
               (Array.isArray(p.tags) && p.tags.some(t => String(t).toLowerCase().includes(q))) ||
               (p.categoryName && p.categoryName.toLowerCase().includes(q));
      });
    }

    // Sorting
    switch (currentSort) {
      case "price-asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case "featured":
      default:
        // Prioritize real backend featured products, then authentic rating
        list.sort((a, b) => {
          const aFeat = (a.featured === true || a.featured === 1) ? 1 : 0;
          const bFeat = (b.featured === true || b.featured === 1) ? 1 : 0;
          if (bFeat !== aFeat) return bFeat - aFeat;
          return (b.rating || 0) - (a.rating || 0);
        });
        break;
    }

    return list;
  }

  /* =========================================================
     4. RENDER CATALOG GRID & CONTROLS
     ========================================================= */

  function renderCatalog() {
    const grid = $("#shopProductGrid");
    const countEl = $("#productCountText");
    const banner = $("#activeSearchBanner");
    const loadMoreBtn = $("#loadMoreBtn");
    if (!grid) return;

    // Search active banner
    if (banner) {
      if (currentSearch) {
        banner.innerHTML = `
          <span>Showing results for: <strong>"${escapeHtml(currentSearch)}"</strong></span>
          <button type="button" id="clearSearchBtn">Clear Filter ✕</button>
        `;
        banner.style.display = "flex";
        $("#clearSearchBtn")?.addEventListener("click", () => {
          currentSearch = "";
          updateUrl();
          renderCatalog();
        });
      } else {
        banner.style.display = "none";
      }
    }

    const filtered = getFilteredProducts();
    const totalCount = filtered.length;

    if (countEl) {
      countEl.textContent = `Showing ${Math.min(visibleCount, totalCount)} of ${totalCount} stickers`;
    }

    if (totalCount === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--white); border: var(--border-w) solid var(--black); border-radius: var(--radius-lg); box-shadow: var(--shadow-hard);">
          <div style="font-size: 56px; margin-bottom: 12px;">🔍</div>
          <h3 style="font-family: var(--font-display); font-size: 26px; text-transform: uppercase;">No stickers match your criteria</h3>
          <p style="color: #666; margin: 10px 0 24px;">Try selecting another category or clear your search query.</p>
          <button type="button" class="btn btn-primary" id="resetCatalogFiltersBtn">Reset All Filters</button>
        </div>
      `;
      $("#resetCatalogFiltersBtn")?.addEventListener("click", () => {
        currentCategory = "all";
        currentSearch = "";
        currentSort = "featured";
        const sortSelect = $("#shopSortSelect");
        if (sortSelect) sortSelect.value = "featured";
        updateUrl();
        renderCategoryPills();
        renderCatalog();
      });
      if (loadMoreBtn) loadMoreBtn.style.display = "none";
      return;
    }

    const visibleItems = filtered.slice(0, visibleCount);

    grid.innerHTML = visibleItems.map(p => renderProductCard(p, { isWishlisted: wishlist.has(p.id) })).join("");

    // Load more button state
    if (loadMoreBtn) {
      if (visibleCount < totalCount) {
        loadMoreBtn.style.display = "inline-flex";
        loadMoreBtn.textContent = `Load More Stickers (${totalCount - visibleCount} remaining)`;
      } else {
        loadMoreBtn.style.display = "none";
      }
    }
  }

  /* =========================================================
     5. EVENT HANDLERS
     ========================================================= */

  function setupShopEvents() {
    // Category Pills click
    $("#categoryPills")?.addEventListener("click", (e) => {
      const pill = e.target.closest(".filter-pill");
      if (!pill) return;
      currentCategory = pill.dataset.catSlug;
      visibleCount = PAGE_SIZE;
      updateUrl();
      renderCategoryPills();
      renderCatalog();
    });

    // Sort dropdown change
    const sortSelect = $("#shopSortSelect");
    if (sortSelect) {
      sortSelect.value = currentSort;
      sortSelect.addEventListener("change", (e) => {
        currentSort = e.target.value;
        visibleCount = PAGE_SIZE;
        updateUrl();
        renderCatalog();
      });
    }

    // Load More click
    $("#loadMoreBtn")?.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      renderCatalog();
    });

    // Delegated Add to Cart & Wishlist
    document.addEventListener("click", (e) => {
      const addBtn = e.target.closest("[data-add-to-cart]");
      if (addBtn) {
        const pId = addBtn.dataset.addToCart;
        const product = allProducts.find(p => p.id === pId);
        if (product) {
          cart.addItem(product, 1);
          addBtn.classList.add("is-added");
          const origText = addBtn.innerHTML;
          addBtn.innerHTML = "Added ✓";
          setTimeout(() => {
            addBtn.classList.remove("is-added");
            addBtn.innerHTML = origText;
          }, 1200);
        }
        return;
      }

      const wishBtn = e.target.closest("[data-wishlist-id]");
      if (wishBtn) {
        const pId = wishBtn.dataset.wishlistId;
        const isNowAdded = wishlist.toggle(pId);
        wishBtn.classList.toggle("is-active", isNowAdded);
        wishBtn.setAttribute("aria-pressed", String(isNowAdded));
        return;
      }
    });

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      parseUrlParams();
      renderCategoryPills();
      renderCatalog();
    });
  }

  /* =========================================================
     6. INIT SHOP
     ========================================================= */

  async function initShop() {
    parseUrlParams();
    allCategories = await getCategories();
    allProducts = await getProducts();

    renderCategoryPills();
    renderCatalog();
    setupShopEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initShop);
  } else {
    initShop();
  }

})();
