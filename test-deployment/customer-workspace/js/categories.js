/* =========================================================
   CHIPAKK — Categories Showcase Module
   js/categories.js
   
   IMAGE-DRIVEN CATEGORIES DISPLAY:
   - Dynamic rendering from getCategories()
   - Product count badges, descriptions, and direct shop links
   ========================================================= */

(function () {
  "use strict";

  const {
    getCategories,
    escapeHtml,
    escapeAttr,
    $
  } = window.CHIPAKK;

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

  async function renderCategoriesPage() {
    const grid = $("#categoriesFullGrid");
    if (!grid) return;

    const categories = await getCategories();

    if (!categories || categories.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--white); border: var(--border-w) solid var(--black); border-radius: var(--radius-lg); box-shadow: var(--shadow-hard);">
          <div style="font-size: 56px; margin-bottom: 12px;">📁</div>
          <h3 style="font-family: var(--font-display); font-size: 24px; text-transform: uppercase;">No Categories Available</h3>
          <p style="color: #666; margin: 8px 0 20px;">New sticker collections are being curated. Check back shortly!</p>
          <a href="shop.html" class="btn btn-primary">Browse All Stickers →</a>
        </div>
      `;
      return;
    }

    grid.innerHTML = categories.map(c => `
      <div class="category-full-card" style="background: var(--white); border: var(--border-w) solid var(--black); border-radius: var(--radius-lg); box-shadow: var(--shadow-hard); padding: 28px; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; transition: transform 0.15s ease;">
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <span class="cat-full-icon-wrap" style="display: inline-flex; width: 68px; height: 68px; align-items: center; justify-content: center; background: var(--off-white); border: 2px solid var(--black); border-radius: var(--radius-md); font-size: 36px; box-shadow: 2px 2px 0 var(--black); overflow: hidden;">
              ${renderCategoryMedia(c)}
            </span>
            <span style="font-family: var(--font-display); font-size: 13px; font-weight: 800; background: var(--yellow); padding: 4px 10px; border: 2px solid var(--black); border-radius: 999px; box-shadow: 2px 2px 0 var(--black);">
              ${c.productCount || 0}+ DESIGNS
            </span>
          </div>
          <h2 style="font-family: var(--font-display); font-size: 24px; text-transform: uppercase; margin-bottom: 8px;">
            ${escapeHtml(c.name)}
          </h2>
          <p style="font-size: 14px; color: #444; line-height: 1.5;">
            ${escapeHtml(c.description || "Discover bold and original sticker designs.")}
          </p>
        </div>
        <div>
          <a href="shop.html?category=${encodeURIComponent(c.slug)}" class="btn btn-primary" style="width: 100%; font-size: 13px; padding: 12px;">
            Explore ${escapeHtml(c.name)} →
          </a>
        </div>
      </div>
    `).join("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderCategoriesPage);
  } else {
    renderCategoriesPage();
  }

})();
