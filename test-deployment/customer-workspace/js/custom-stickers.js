/* =========================================================
   CHIPAKK — Custom Stickers Studio Module
   js/custom-stickers.js
   
   CUSTOM STICKER BUILDER ENGINE:
   - Step 1: Artwork file upload dropzone & image preview
   - Step 2: Cut style selector (Die Cut, Kiss Cut, Holographic, Clear)
   - Step 3: Size & finish selector
   - Step 4: Quantity tier selection with volume discounts
   - Live price calculator & sticky summary
   - Add custom order bundle to shared cart
   ========================================================= */

(function () {
  "use strict";

  const {
    cart,
    formatPrice,
    showToast,
    openCart,
    $,
    $$
  } = window.CHIPAKK;

  // Builder State
  let customState = {
    uploadedFileName: null,
    uploadedPreviewUrl: null,
    cutType: "Die Cut",
    finish: "Glossy",
    size: '3" x 3"',
    quantity: 50,
    price: 1499
  };

  // Tiered Pricing Matrix
  const PRICING_TIERS = {
    10: { price: 499, unit: 49.9, discount: "Standard" },
    25: { price: 899, unit: 35.9, discount: "Save 28%" },
    50: { price: 1499, unit: 29.9, discount: "Save 40% • POPULAR" },
    100: { price: 2499, unit: 24.9, discount: "Save 50%" },
    250: { price: 4999, unit: 19.9, discount: "Save 60%" },
    500: { price: 8499, unit: 16.9, discount: "Save 66% • PRO PACK" }
  };

  function updatePricing() {
    const tier = PRICING_TIERS[customState.quantity] || PRICING_TIERS[50];
    let basePrice = tier.price;

    // Cut type multiplier
    if (customState.cutType === "Holographic") basePrice = Math.round(basePrice * 1.25);
    if (customState.cutType === "Clear Vinyl") basePrice = Math.round(basePrice * 1.15);

    // Size multiplier
    if (customState.size === '4" x 4"') basePrice = Math.round(basePrice * 1.2);

    customState.price = basePrice;

    // Update UI Summary Elements
    const sumCut = $("#sumCut");
    const sumFinish = $("#sumFinish");
    const sumSize = $("#sumSize");
    const sumQty = $("#sumQty");
    const sumUnit = $("#sumUnitPrice");
    const sumTotal = $("#sumTotalPrice");

    if (sumCut) sumCut.textContent = customState.cutType;
    if (sumFinish) sumFinish.textContent = customState.finish;
    if (sumSize) sumSize.textContent = customState.size;
    if (sumQty) sumQty.textContent = `${customState.quantity} pcs`;
    if (sumUnit) sumUnit.textContent = formatPrice(Math.round(basePrice / customState.quantity)) + "/each";
    if (sumTotal) sumTotal.textContent = formatPrice(basePrice);
  }

  function initDropzone() {
    const dropzone = $("#artworkDropzone");
    const fileInput = $("#artworkFileInput");
    const previewBox = $("#artworkPreviewBox");
    const previewThumb = $("#artworkPreviewThumb");
    const fileNameEl = $("#artworkFileName");
    const removeBtn = $("#removeArtworkBtn");

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length) {
        handleFile(e.target.files[0]);
      }
    });

    function handleFile(file) {
      if (!file.type.startsWith("image/") && !file.name.endsWith(".pdf") && !file.name.endsWith(".svg")) {
        showToast("Please upload an image, SVG, or PDF file.");
        return;
      }

      customState.uploadedFileName = file.name;
      if (fileNameEl) fileNameEl.textContent = file.name;

      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          customState.uploadedPreviewUrl = evt.target.result;
          if (previewThumb) previewThumb.src = evt.target.result;
          if (previewBox) previewBox.style.display = "flex";
        };
        reader.readAsDataURL(file);
      } else {
        if (previewThumb) previewThumb.src = "assets/images/logo.png";
        if (previewBox) previewBox.style.display = "flex";
      }

      showToast(`Artwork "${file.name}" uploaded successfully!`);
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        customState.uploadedFileName = null;
        customState.uploadedPreviewUrl = null;
        fileInput.value = "";
        if (previewBox) previewBox.style.display = "none";
        showToast("Artwork removed");
      });
    }
  }

  function initCutSelection() {
    const cards = $$(".cut-option-card");
    cards.forEach(card => {
      card.addEventListener("click", () => {
        cards.forEach(c => c.classList.remove("is-active"));
        card.classList.add("is-active");
        customState.cutType = card.dataset.cutType || "Die Cut";
        updatePricing();
      });
    });
  }

  function initSizeAndFinish() {
    const sizeBtns = $$(".size-pill-btn");
    sizeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        sizeBtns.forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        customState.size = btn.dataset.sizeVal || '3" x 3"';
        updatePricing();
      });
    });

    const finishBtns = $$(".finish-pill-btn");
    finishBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        finishBtns.forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        customState.finish = btn.dataset.finishVal || "Glossy";
        updatePricing();
      });
    });
  }

  function initQuantitySelection() {
    const tierBtns = $$(".tier-pill-btn");
    tierBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        tierBtns.forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        customState.quantity = Number(btn.dataset.qtyVal) || 50;
        updatePricing();
      });
    });
  }

  function initAddToCart() {
    const addBtn = $("#addCustomToCartBtn");
    if (!addBtn) return;

    addBtn.addEventListener("click", () => {
      const customItem = {
        id: "custom_pack_" + Date.now(),
        name: `Custom ${customState.cutType} (${customState.quantity} pcs)`,
        price: customState.price,
        image: customState.uploadedPreviewUrl || "🎨",
        materials: [customState.finish],
        sizes: [customState.size]
      };

      cart.addItem(customItem, 1, { material: customState.finish, size: customState.size });
      openCart();
    });
  }

  function initCustomStudio() {
    initDropzone();
    initCutSelection();
    initSizeAndFinish();
    initQuantitySelection();
    initAddToCart();
    updatePricing();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCustomStudio);
  } else {
    initCustomStudio();
  }

})();
