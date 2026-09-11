/* =========================================================
   CHIPAKK — Customer Account Module
   js/account.js
   
   AUTHENTICATED ACCOUNT ENGINE:
   - Real Firebase Authentication lifecycle
   - Dual-state interface: Sign In / Sign Up vs Customer Dashboard
   - Dynamic user profile population
   - Order history loaded from customer account records
   - Order tracking & detail modal
   - Wishlist manager with "Move to Cart"
   - Real Firebase sign out without purging cart/wishlist
   ========================================================= */

(function () {
  "use strict";

  const {
    cart,
    wishlist,
    getProducts,
    formatPrice,
    renderProductCard,
    showToast,
    escapeHtml,
    escapeAttr,
    auth,
    $,
    $$
  } = window.CHIPAKK;

  // Customer order history (retrieves real stored orders, never seeds fake mock data)
  function getOrders() {
    try {
      const raw = localStorage.getItem("chipakk_orders_v1");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /* =========================================================
     1. AUTH UI & FORM CONTROLLER
     ========================================================= */

  function initAuthForms() {
    const tabSignIn = $("#tabBtnSignIn");
    const tabSignUp = $("#tabBtnSignUp");
    const panelSignIn = $("#panelSignIn");
    const panelSignUp = $("#panelSignUp");

    function switchAuthTab(target) {
      if (target === "signup") {
        tabSignIn?.classList.remove("is-active");
        tabSignUp?.classList.add("is-active");
        tabSignIn?.setAttribute("aria-selected", "false");
        tabSignUp?.setAttribute("aria-selected", "true");
        panelSignIn?.classList.remove("is-active");
        panelSignUp?.classList.add("is-active");
      } else {
        tabSignUp?.classList.remove("is-active");
        tabSignIn?.classList.add("is-active");
        tabSignUp?.setAttribute("aria-selected", "false");
        tabSignIn?.setAttribute("aria-selected", "true");
        panelSignUp?.classList.remove("is-active");
        panelSignIn?.classList.add("is-active");
      }
      clearAuthErrors();
    }

    tabSignIn?.addEventListener("click", () => switchAuthTab("signin"));
    tabSignUp?.addEventListener("click", () => switchAuthTab("signup"));

    // --- Sign In Handler ---
    const signInForm = $("#signInForm");
    signInForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthErrors();

      const email = $("#signInEmail")?.value.trim();
      const password = $("#signInPassword")?.value;
      const submitBtn = $("#signInSubmitBtn");
      const errorBox = $("#signInError");

      if (!email) {
        showFieldError("fieldSignInEmail", "signInEmailError", "Please enter your email address.");
        return;
      }
      if (!validateEmail(email)) {
        showFieldError("fieldSignInEmail", "signInEmailError", "Please enter a valid email address.");
        return;
      }
      if (!password) {
        showFieldError("fieldSignInPassword", "signInPasswordError", "Please enter your password.");
        return;
      }

      setButtonLoading(submitBtn, true, "Signing In…");

      try {
        await window.CHIPAKK.auth.signIn(email, password);
        showToast("Welcome back to CHIPAKK!");
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || "Failed to sign in. Please try again.";
          errorBox.style.display = "block";
        }
      } finally {
        setButtonLoading(submitBtn, false, "Sign In to CHIPAKK →");
      }
    });

    // --- Sign Up Handler ---
    const signUpForm = $("#signUpForm");
    signUpForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthErrors();

      const name = $("#signUpName")?.value.trim();
      const email = $("#signUpEmail")?.value.trim();
      const password = $("#signUpPassword")?.value;
      const confirmPassword = $("#signUpConfirmPassword")?.value;
      const submitBtn = $("#signUpSubmitBtn");
      const errorBox = $("#signUpError");

      let hasError = false;

      if (!name || name.length < 2) {
        showFieldError("fieldSignUpName", "signUpNameError", "Please enter your full name.");
        hasError = true;
      }
      if (!email || !validateEmail(email)) {
        showFieldError("fieldSignUpEmail", "signUpEmailError", "Please enter a valid email address.");
        hasError = true;
      }
      if (!password || password.length < 6) {
        showFieldError("fieldSignUpPassword", "signUpPasswordError", "Password must be at least 6 characters.");
        hasError = true;
      }
      if (password && confirmPassword !== password) {
        showFieldError("fieldSignUpConfirm", "signUpConfirmError", "Passwords do not match.");
        hasError = true;
      }

      if (hasError) return;

      setButtonLoading(submitBtn, true, "Creating Account…");

      try {
        await window.CHIPAKK.auth.signUp(name, email, password);
        showToast("Account created! Welcome to CHIPAKK.");
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || "Failed to create account. Please try again.";
          errorBox.style.display = "block";
        }
      } finally {
        setButtonLoading(submitBtn, false, "Create Customer Account →");
      }
    });
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function showFieldError(fieldId, errorId, message) {
    const field = $(`#${fieldId}`);
    const errorEl = $(`#${errorId}`);
    if (field) field.classList.add("has-error");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }
  }

  function clearAuthErrors() {
    $$(".form-field").forEach((f) => f.classList.remove("has-error"));
    $$(".auth-field-error").forEach((e) => {
      e.textContent = "";
      e.style.display = "none";
    });
    const signInError = $("#signInError");
    const signUpError = $("#signUpError");
    if (signInError) { signInError.textContent = ""; signInError.style.display = "none"; }
    if (signUpError) { signUpError.textContent = ""; signUpError.style.display = "none"; }
  }

  function setButtonLoading(btn, isLoading, text) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.textContent = text;
    if (isLoading) {
      btn.style.opacity = "0.75";
      btn.style.cursor = "not-allowed";
    } else {
      btn.style.opacity = "";
      btn.style.cursor = "";
    }
  }

  /* =========================================================
     2. DASHBOARD TABS & DATA POPULATION
     ========================================================= */

  function initTabs() {
    const tabBtns = $$(".account-nav-btn[data-tab]");
    const tabPanes = $$(".account-tab-content");

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.dataset.tab;
        tabBtns.forEach((b) => b.classList.remove("is-active"));
        tabPanes.forEach((p) => p.classList.remove("is-active"));

        btn.classList.add("is-active");
        const activePane = $(`#tab-${targetTab}`);
        if (activePane) activePane.classList.add("is-active");

        if (targetTab === "wishlist") renderWishlistTab();
        if (targetTab === "addresses") renderAddressesTab();
      });
    });
  }

  function populateUserProfile(user) {
    if (!user) return;

    const displayName = window.CHIPAKK?.auth?.getDisplayName ? window.CHIPAKK.auth.getDisplayName(user) : (user.displayName || "CHIPAKK Member");
    const email = user.email || "";
    const firstInitial = displayName ? displayName.charAt(0).toUpperCase() : "🧑‍🚀";

    const nameEl = $("#accountUserDisplayName");
    const emailEl = $("#accountUserEmail");
    const avatarEl = $("#accountAvatar");
    const addrNameEl = $("#defaultAddressName");
    const profileNameInput = $("#profileDisplayName");
    const profileEmailInput = $("#profileEmail");

    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = email;
    if (avatarEl) avatarEl.textContent = firstInitial.match(/[A-Z0-9]/) ? firstInitial : "🧑‍🚀";
    if (addrNameEl) addrNameEl.textContent = displayName;
    if (profileNameInput) profileNameInput.value = user.displayName || "";
    if (profileEmailInput) profileEmailInput.value = email;
  }

  function initProfileUpdates() {
    const updateBtn = $("#profileUpdateBtn");
    const nameInput = $("#profileDisplayName");

    updateBtn?.addEventListener("click", async () => {
      const newName = nameInput?.value.trim();
      const currentUser = window.CHIPAKK?.auth?.getCurrentUser();

      if (!currentUser) return;
      if (!newName) {
        showToast("Please enter a valid display name.", "error");
        return;
      }

      setButtonLoading(updateBtn, true, "Saving…");
      try {
        if (currentUser.updateProfile) {
          await currentUser.updateProfile({ displayName: newName });
        }
        populateUserProfile(currentUser);
        showToast("Profile name updated!");
      } catch (err) {
        showToast("Unable to update profile right now.", "error");
      } finally {
        setButtonLoading(updateBtn, false, "Update Profile");
      }
    });
  }

  /* =========================================================
     3. RENDER ORDERS LIST & TRACKING MODAL
     ========================================================= */

  function getOrderStatusCustomerMessage(status, paymentStatus = "") {
    const s = String(status || "").toLowerCase().trim();
    const p = String(paymentStatus || "").toLowerCase().trim();

    if (s === "cancelled") return "Order was cancelled";
    if (s === "failed" || p === "failed") return "Payment failed — please try again";
    if (s === "refunded" || p === "refunded") return "Refund processed to original payment method";
    if (s === "delivered") return "Delivered successfully! Enjoy your stickers!";
    if (s === "shipped") return "Handed over to courier — tracking active";
    if (s === "ready_to_ship" || s === "packed") return "Packed in protective rigid mailer — awaiting courier pickup";
    if (s === "processing" || s === "printing" || s === "cutting") return "Stickers are being custom printed & precision die-cut";
    if (s === "paid" || s === "confirmed" || p === "paid" || p === "completed") return "Payment verified — preparing for production";
    return "Payment pending or order confirmation in progress";
  }

  async function renderOrdersTab() {
    const listEl = $("#accountOrdersList");
    if (!listEl) return;

    listEl.innerHTML = `
      <div style="text-align: center; padding: 32px; font-weight: 600; color: #666;">
        Loading your orders…
      </div>
    `;

    let orders = [];
    try {
      if (window.CHIPAKK?.getCustomerOrdersApi) {
        orders = await window.CHIPAKK.getCustomerOrdersApi();
      } else if (window.CHIPAKK?.api?.getCustomerOrders) {
        orders = await window.CHIPAKK.api.getCustomerOrders();
      }
    } catch (err) {
      console.warn("Could not fetch remote orders:", err);
      orders = getOrders();
    }

    if (!orders || orders.length === 0) {
      orders = getOrders();
    }

    if (!orders || orders.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 48px 20px; border: var(--border-w) solid var(--black); border-radius: var(--radius-md); background: var(--off-white); box-shadow: 2px 2px 0 var(--black);">
          <span style="font-size: 44px; display: block; margin-bottom: 12px;">📦</span>
          <h3 style="font-family: var(--font-display); font-size: 18px; text-transform: uppercase; margin: 0 0 6px;">No Orders Placed Yet</h3>
          <p style="font-size: 13px; color: #555; margin: 0 0 18px; line-height: 1.4;">
            Your orders and live tracking details will appear here after your first purchase.
          </p>
          <a href="shop.html" class="btn btn-primary" style="font-size: 13px; padding: 10px 20px;">Browse Stickers →</a>
        </div>
      `;
      return;
    }

    listEl.innerHTML = orders.map((ord) => {
      const orderNum = ord.order_number || ord.orderId || `CHP-${ord.id || "0000"}`;
      const dateVal = ord.created_at || ord.date || Date.now();
      const dateStr = new Date(dateVal).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const fulfillStatus = ord.fulfillment_status || ord.status || "PROCESSING";
      const statusClass = fulfillStatus === "DELIVERED" ? "status-delivered" : (fulfillStatus === "SHIPPED" ? "status-shipped" : "status-processing");
      const orderTotal = ord.total_price_inr ?? ord.total ?? 0;
      const rawPayStatus = (ord.payment_status || "").toLowerCase();
      const rawPayMethod = (ord.payment_method || "").toUpperCase();
      let paymentNote = "Pending Payment";
      let paymentColor = "#b45309";

      if (rawPayStatus === "paid" || rawPayStatus === "completed") {
        paymentNote = `PAID (${rawPayMethod || "Online"})`;
        paymentColor = "#15803d";
      } else if (rawPayStatus === "failed") {
        paymentNote = "PAYMENT FAILED";
        paymentColor = "#b91c1c";
      } else if (rawPayMethod === "COD") {
        paymentNote = "Cash on Delivery (Pending)";
        paymentColor = "#854d0e";
      }
      const items = ord.items || [];
      const customerStatusMessage = getOrderStatusCustomerMessage(fulfillStatus, ord.payment_status);

      return `
        <div class="order-card" data-order-id="${escapeAttr(String(ord.id || ord.orderId || orderNum))}">
          <div class="order-card-header">
            <div>
              <strong style="font-family: var(--font-display); font-size: 16px;">Order #${escapeHtml(orderNum)}</strong>
              <div style="font-size: 12px; color: #666; margin-top: 2px;">Placed on ${escapeHtml(dateStr)} • <span style="color: ${paymentColor}; font-weight: 700;">${escapeHtml(paymentNote)}</span></div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="order-status-tag ${statusClass}">${escapeHtml(fulfillStatus)}</span>
              <strong style="font-size: 16px;">${formatPrice(orderTotal)}</strong>
            </div>
          </div>

          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 12px; font-weight: 700; color: #1e293b; margin-top: 10px;">
            ℹ️ ${escapeHtml(customerStatusMessage)}
          </div>

          <!-- Items Preview Rail -->
          <div style="display: flex; gap: 10px; margin: 14px 0; overflow-x: auto; padding-bottom: 4px;">
            ${items.map((item) => `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--white); border: 1px solid var(--black); border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                <span style="font-size: 18px;">${typeof item.image === 'string' && item.image.startsWith('http') ? '⚡' : (item.image || '⚡')}</span>
                <span>${escapeHtml(item.product_title || item.name || 'Sticker')} (x${item.quantity || item.qty || 1})</span>
              </div>
            `).join("")}
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
            <button type="button" class="btn btn-secondary view-order-btn" data-view-order="${escapeAttr(String(ord.id || ord.orderId || orderNum))}" style="font-size: 12px; padding: 8px 14px;">
              View Details & Track →
            </button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".view-order-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderIdentifier = btn.dataset.viewOrder;
        let targetOrder = orders.find((o) => String(o.id) === orderIdentifier || String(o.orderId) === orderIdentifier || String(o.order_number) === orderIdentifier);
        
        if (targetOrder && targetOrder.id && (!targetOrder.items || targetOrder.items.length === 0)) {
          try {
            const getOrderFn = window.CHIPAKK?.getCustomerOrderByIdApi || window.CHIPAKK?.api?.getCustomerOrderById;
            if (getOrderFn) {
              const fullOrder = await getOrderFn(targetOrder.id);
              if (fullOrder) targetOrder = fullOrder;
            }
          } catch (e) {
            console.warn("Could not fetch full order details:", e);
          }
        }
        if (targetOrder) showOrderModal(targetOrder);
      });
    });
  }

  function showOrderModal(order) {
    const modal = $("#orderTrackingModal");
    if (!modal) return;

    const orderNum = order.order_number || order.orderId || `CHP-${order.id || "0000"}`;
    $("#trackModalOrderId").textContent = orderNum;
    $("#trackModalStatus").textContent = order.fulfillment_status || order.status || "PROCESSING";

    const msgEl = $("#trackModalStatusMessage");
    if (msgEl) {
      msgEl.textContent = getOrderStatusCustomerMessage(order.fulfillment_status || order.status, order.payment_status);
    }
    
    const paymentEl = $("#trackModalPayment");
    if (paymentEl) {
      const rawPayStatus = (order.payment_status || "").toLowerCase();
      const rawPayMethod = (order.payment_method || "").toUpperCase();
      if (rawPayStatus === "paid" || rawPayStatus === "completed") {
        paymentEl.textContent = `PAID (${rawPayMethod || "Online"})`;
        paymentEl.style.color = "#15803d";
      } else if (rawPayStatus === "failed") {
        paymentEl.textContent = "FAILED";
        paymentEl.style.color = "#b91c1c";
      } else if (rawPayMethod === "COD") {
        paymentEl.textContent = "Cash on Delivery (Pending)";
        paymentEl.style.color = "#854d0e";
      } else {
        paymentEl.textContent = `Pending Payment (${rawPayMethod || "Online"})`;
        paymentEl.style.color = "#b45309";
      }
    }

    const orderTotal = order.total_price_inr ?? order.total ?? 0;
    $("#trackModalTotal").textContent = formatPrice(orderTotal);
    $("#trackModalCourier").textContent = order.courier_name || (order.tracking_number ? "BlueDart Express" : "Standard Shipping (Awaiting Dispatch)");
    $("#trackModalTrackingNo").textContent = order.tracking_number || "Will be assigned once package is dispatched";

    // Shipping address snapshot
    const addrEl = $("#trackModalAddress");
    if (addrEl) {
      let addr = order.shipping_address;
      if (typeof addr === "string") {
        try { addr = JSON.parse(addr); } catch(e) {}
      }
      if (addr && (addr.full_name || addr.name)) {
        const line1 = addr.address_line1 || addr.address || "";
        const line2 = addr.address_line2 ? `, ${addr.address_line2}` : "";
        const cityState = `${addr.city || ""}, ${addr.state || ""} — ${addr.postal_code || addr.pin || ""}`;
        const phone = addr.phone ? `<br />Phone: ${escapeHtml(addr.phone)}` : "";
        addrEl.innerHTML = `<strong>${escapeHtml(addr.full_name || addr.name)}</strong><br />${escapeHtml(line1)}${escapeHtml(line2)}<br />${escapeHtml(cityState)}${phone}`;
      } else {
        addrEl.textContent = "Delivery address recorded on order";
      }
    }

    const itemsContainer = $("#trackModalItems");
    if (itemsContainer) {
      const items = order.items || [];
      if (items.length === 0) {
        itemsContainer.innerHTML = `<div style="padding: 10px 0; color: #666; font-size: 13px;">Sticker package items included in order.</div>`;
      } else {
        itemsContainer.innerHTML = items.map((item) => {
          const title = item.product_title || item.name || "Sticker";
          const variant = item.variant_name || item.material || "Standard Vinyl";
          const qty = item.quantity || item.qty || 1;
          const price = item.unit_price_inr ?? item.price ?? 0;
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 24px;">${typeof item.image === 'string' && item.image.startsWith('http') ? '⚡' : (item.image || '⚡')}</span>
                <div>
                  <div style="font-weight: 700; font-size: 13px;">${escapeHtml(title)}</div>
                  <div style="font-size: 11px; color: #666;">${escapeHtml(variant)} • Qty: ${qty}</div>
                </div>
              </div>
              <div style="font-weight: 700; font-size: 13px;">${formatPrice(price * qty)}</div>
            </div>
          `;
        }).join("");
      }
    }

    modal.style.display = "flex";
  }

  function initOrderModal() {
    const modal = $("#orderTrackingModal");
    const closeBtn = $("#closeTrackModalBtn");
    if (!modal) return;

    if (closeBtn) closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.style.display = "none";
    });
  }

  /* =========================================================
     4. RENDER WISHLIST TAB
     ========================================================= */

  async function renderWishlistTab() {
    const grid = $("#accountWishlistGrid");
    if (!grid) return;

    const wishIds = wishlist.getAll();
    const allProducts = await getProducts();
    const strWishIds = (wishIds || []).map(String);
    const wishProducts = allProducts.filter((p) => p && p.active !== false && strWishIds.includes(String(p.id)));

    if (wishProducts.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
          <span style="font-size: 40px;">♥</span>
          <p style="font-weight: 700; margin: 10px 0;">Your wishlist is empty.</p>
          <a href="shop.html" class="btn btn-primary" style="font-size: 13px; padding: 10px 18px;">Browse Stickers →</a>
        </div>
      `;
      return;
    }

    grid.innerHTML = wishProducts.map((p) => renderProductCard(p, { mode: "wishlist" })).join("");

    grid.querySelectorAll(".move-to-cart-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pId = btn.dataset.moveCart;
        const target = allProducts.find((x) => String(x.id) === String(pId));
        if (target) {
          cart.addItem(target, 1);
          wishlist.toggle(pId);
          renderWishlistTab();
        }
      });
    });

    grid.querySelectorAll(".remove-wish-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pId = btn.dataset.removeWish;
        wishlist.toggle(pId);
        renderWishlistTab();
      });
    });
  }

  /* =========================================================
     4B. RENDER SAVED ADDRESSES TAB
     ========================================================= */

  let customerAddressesCache = [];

  async function renderAddressesTab() {
    const container = $("#accountAddressContainer");
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #666; font-weight: 600;">
        Loading saved addresses…
      </div>
    `;

    let addresses = [];
    try {
      if (window.CHIPAKK?.getCustomerAddressesApi) {
        addresses = await window.CHIPAKK.getCustomerAddressesApi();
      } else if (window.CHIPAKK?.api?.getCustomerAddresses) {
        addresses = await window.CHIPAKK.api.getCustomerAddresses();
      }
    } catch (err) {
      console.warn("Could not fetch customer addresses:", err);
    }

    customerAddressesCache = Array.isArray(addresses) ? addresses : [];

    const headerBar = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 10px;">
        <span style="font-size: 13px; color: #666; font-weight: 600;">
          ${customerAddressesCache.length} saved address${customerAddressesCache.length === 1 ? '' : 'es'}
        </span>
        <button type="button" class="btn btn-primary" id="addNewAddressBtn" style="font-size: 12px; padding: 8px 16px;">
          + Add New Address
        </button>
      </div>
    `;

    if (customerAddressesCache.length === 0) {
      let localAddr = null;
      try {
        const raw = localStorage.getItem("chipakk_shipping_address_v1");
        if (raw) localAddr = JSON.parse(raw);
      } catch (e) {}

      if (localAddr && localAddr.name && localAddr.address) {
        container.innerHTML = `
          ${headerBar}
          <div style="border: var(--border-w) solid var(--black); border-radius: var(--radius-md); padding: 20px; background: var(--off-white); max-width: 460px; box-shadow: 2px 2px 0 var(--black);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
              <span style="background: var(--yellow); font-family: var(--font-display); font-size: 11px; font-weight: 800; padding: 2px 8px; border: 1px solid var(--black); border-radius: 999px;">RECENT CHECKOUT ADDRESS</span>
            </div>
            <h3 style="font-size: 16px; margin: 0 0 6px; font-weight: 700;">${escapeHtml(localAddr.name)}</h3>
            <p style="font-size: 14px; color: #444; line-height: 1.5; margin: 0 0 10px;">
              ${escapeHtml(localAddr.address)}<br />
              ${escapeHtml(localAddr.city || "")}, ${escapeHtml(localAddr.state || "")} — ${escapeHtml(localAddr.pin || "")}<br />
              ${localAddr.phone ? `Phone: ${escapeHtml(localAddr.phone)}` : ""}
            </p>
            <div style="display: flex; gap: 10px; margin-top: 12px;">
              <a href="checkout.html" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">Use in Checkout →</a>
            </div>
          </div>
        `;
      } else {
        container.innerHTML = `
          ${headerBar}
          <div style="text-align: center; padding: 36px 20px; border: 2px dashed #bbb; border-radius: var(--radius-md); background: var(--off-white); max-width: 460px;">
            <span style="font-size: 36px; display: block; margin-bottom: 8px;">📍</span>
            <strong style="display: block; margin-bottom: 4px; font-size: 15px;">No Saved Addresses Yet</strong>
            <p style="font-size: 13px; color: #666; margin: 0 0 16px; line-height: 1.4;">
              Save your delivery addresses for quick, one-click checkout across CHIPAKK.
            </p>
          </div>
        `;
      }
      wireAddressEvents();
      return;
    }

    const cardsHtml = customerAddressesCache.map((addr) => {
      const isDefault = Boolean(addr.is_default);
      const addrType = (addr.type || "home").toUpperCase();
      const line2 = addr.address_line2 ? `<br />${escapeHtml(addr.address_line2)}` : "";

      return `
        <div style="border: var(--border-w) solid var(--black); border-radius: var(--radius-md); padding: 18px; background: var(--white); box-shadow: 2px 2px 0 var(--black); position: relative; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
              <span style="background: var(--off-white); border: 1px solid var(--black); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">
                ${escapeHtml(addrType)}
              </span>
              ${isDefault ? `<span style="background: var(--yellow); border: 1px solid var(--black); font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px;">★ DEFAULT</span>` : ""}
            </div>
            <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 4px;">${escapeHtml(addr.full_name)}</h3>
            <p style="font-size: 13px; color: #444; line-height: 1.4; margin: 0 0 8px;">
              ${escapeHtml(addr.address_line1)}${line2}<br />
              ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} — ${escapeHtml(addr.postal_code)}<br />
              <span style="font-weight: 600; color: #111;">Phone: ${escapeHtml(addr.phone)}</span>
            </p>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #eee; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary edit-addr-btn" data-addr-id="${escapeAttr(String(addr.id))}" style="font-size: 11px; padding: 6px 12px;">
              Edit
            </button>
            ${!isDefault ? `
              <button type="button" class="btn btn-secondary set-default-addr-btn" data-addr-id="${escapeAttr(String(addr.id))}" style="font-size: 11px; padding: 6px 12px;">
                Set Default
              </button>
            ` : ""}
            <button type="button" class="btn delete-addr-btn" data-addr-id="${escapeAttr(String(addr.id))}" style="font-size: 11px; padding: 6px 10px; color: #991b1b; background: transparent; border: 1px solid #dc2626; margin-left: auto;">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      ${headerBar}
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px;">
        ${cardsHtml}
      </div>
    `;

    wireAddressEvents();
  }

  function wireAddressEvents() {
    const addBtn = $("#addNewAddressBtn");
    addBtn?.addEventListener("click", () => {
      openAddressModal();
    });

    $$(".edit-addr-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.addrId;
        const target = customerAddressesCache.find((a) => String(a.id) === String(id));
        if (target) openAddressModal(target);
      });
    });

    $$(".set-default-addr-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.addrId;
        btn.disabled = true;
        try {
          if (window.CHIPAKK?.updateCustomerAddressApi) {
            await window.CHIPAKK.updateCustomerAddressApi(id, { is_default: true });
          }
          showToast("Default delivery address updated.");
          renderAddressesTab();
        } catch (err) {
          showToast(err.message || "Failed to update default address.", "error");
          btn.disabled = false;
        }
      });
    });

    $$(".delete-addr-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.addrId;
        if (!confirm("Are you sure you want to remove this address?")) return;
        btn.disabled = true;
        try {
          if (window.CHIPAKK?.deleteCustomerAddressApi) {
            await window.CHIPAKK.deleteCustomerAddressApi(id);
          }
          showToast("Address removed.");
          renderAddressesTab();
        } catch (err) {
          showToast(err.message || "Failed to delete address.", "error");
          btn.disabled = false;
        }
      });
    });
  }

  function openAddressModal(addr = null) {
    const modal = $("#customerAddressModal");
    const titleEl = $("#addressModalTitle");
    const errorBox = $("#addressFormError");
    if (!modal) return;

    if (errorBox) { errorBox.textContent = ""; errorBox.style.display = "none"; }

    if (addr) {
      if (titleEl) titleEl.textContent = "Edit Delivery Address";
      const idInput = $("#addressFormId");
      if (idInput) idInput.value = addr.id || "";
      const nameInput = $("#addressFormName");
      if (nameInput) nameInput.value = addr.full_name || "";
      const phoneInput = $("#addressFormPhone");
      if (phoneInput) phoneInput.value = addr.phone || "";
      const line1Input = $("#addressFormLine1");
      if (line1Input) line1Input.value = addr.address_line1 || "";
      const line2Input = $("#addressFormLine2");
      if (line2Input) line2Input.value = addr.address_line2 || "";
      const cityInput = $("#addressFormCity");
      if (cityInput) cityInput.value = addr.city || "";
      const stateInput = $("#addressFormState");
      if (stateInput) stateInput.value = addr.state || "";
      const pinInput = $("#addressFormPin");
      if (pinInput) pinInput.value = addr.postal_code || "";
      const typeInput = $("#addressFormType");
      if (typeInput) typeInput.value = addr.type || "home";
      const defInput = $("#addressFormDefault");
      if (defInput) defInput.checked = Boolean(addr.is_default);
    } else {
      if (titleEl) titleEl.textContent = "Add Delivery Address";
      $("#customerAddressForm")?.reset();
      const idInput = $("#addressFormId");
      if (idInput) idInput.value = "";
      const currentUser = window.CHIPAKK?.auth?.getCurrentUser();
      if (currentUser && currentUser.displayName) {
        const nameInput = $("#addressFormName");
        if (nameInput) nameInput.value = currentUser.displayName;
      }
      const defInput = $("#addressFormDefault");
      if (defInput) defInput.checked = customerAddressesCache.length === 0;
    }

    modal.style.display = "flex";
  }

  function initAddressModal() {
    const modal = $("#customerAddressModal");
    const closeBtn = $("#closeAddressModalBtn");
    const cancelBtn = $("#cancelAddressModalBtn");
    const form = $("#customerAddressForm");
    const saveBtn = $("#saveAddressModalBtn");
    const errorBox = $("#addressFormError");

    function closeModal() {
      if (modal) modal.style.display = "none";
    }

    closeBtn?.addEventListener("click", closeModal);
    cancelBtn?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorBox) { errorBox.textContent = ""; errorBox.style.display = "none"; }

      const id = $("#addressFormId")?.value.trim();
      const fullName = $("#addressFormName")?.value.trim();
      const phone = $("#addressFormPhone")?.value.trim();
      const line1 = $("#addressFormLine1")?.value.trim();
      const line2 = $("#addressFormLine2")?.value.trim();
      const city = $("#addressFormCity")?.value.trim();
      const state = $("#addressFormState")?.value.trim();
      const postalCode = $("#addressFormPin")?.value.trim();
      const type = $("#addressFormType")?.value || "home";
      const isDefault = Boolean($("#addressFormDefault")?.checked);

      function showError(msg) {
        if (errorBox) {
          errorBox.textContent = msg;
          errorBox.style.display = "block";
        } else {
          showToast(msg, "error");
        }
      }

      if (!fullName) {
        showError("Full Name is required.");
        return;
      }
      if (!phone || phone.replace(/\D/g, "").length < 10) {
        showError("Please enter a valid 10-digit phone number.");
        return;
      }
      if (!line1) {
        showError("Address Line 1 is required.");
        return;
      }
      if (!city) {
        showError("City is required.");
        return;
      }
      if (!state) {
        showError("State is required.");
        return;
      }
      if (!postalCode || postalCode.replace(/\D/g, "").length !== 6) {
        showError("Please enter a valid 6-digit PIN code.");
        return;
      }

      const payload = {
        full_name: fullName,
        phone: phone,
        address_line1: line1,
        address_line2: line2 || null,
        city: city,
        state: state,
        postal_code: postalCode,
        country: "IN",
        type: type,
        is_default: isDefault
      };

      setButtonLoading(saveBtn, true, "Saving…");

      try {
        if (id) {
          if (window.CHIPAKK?.updateCustomerAddressApi) {
            await window.CHIPAKK.updateCustomerAddressApi(id, payload);
          }
          showToast("Address updated successfully!");
        } else {
          if (window.CHIPAKK?.createCustomerAddressApi) {
            await window.CHIPAKK.createCustomerAddressApi(payload);
          }
          showToast("New address saved!");
        }
        closeModal();
        renderAddressesTab();
      } catch (err) {
        showError(err.message || "Unable to save address.");
      } finally {
        setButtonLoading(saveBtn, false, "Save Address");
      }
    });
  }

  /* =========================================================
     5. MASTER AUTH STATE LISTENER & SIGN OUT
     ========================================================= */

  function applyAuthState(user) {
    const authContainer = $("#authFormsContainer");
    const dashContainer = $("#accountDashboardContainer");

    if (user) {
      // User is logged in
      if (authContainer) authContainer.style.display = "none";
      if (dashContainer) dashContainer.style.display = "block";
      populateUserProfile(user);
      renderOrdersTab();
      renderAddressesTab();
    } else {
      // User is logged out
      if (dashContainer) dashContainer.style.display = "none";
      if (authContainer) authContainer.style.display = "block";
      clearAuthErrors();
    }
  }

  function initSignOut() {
    const logoutBtn = $("#logoutBtn");
    logoutBtn?.addEventListener("click", async () => {
      try {
        if (window.CHIPAKK?.auth?.signOutUser) {
          await window.CHIPAKK.auth.signOutUser();
        }
        showToast("Signed out successfully.");
      } catch (err) {
        showToast(err.message || "Signed out.");
      }
    });
  }

  /* =========================================================
     6. INIT ACCOUNT
     ========================================================= */

  function initAccount() {
    initAuthForms();
    initTabs();
    initOrderModal();
    initAddressModal();
    initProfileUpdates();
    initSignOut();

    // Listen to real Firebase Auth changes
    if (window.CHIPAKK?.auth?.onAuthStateChanged) {
      window.CHIPAKK.auth.onAuthStateChanged((user) => {
        applyAuthState(user);
      });
    } else {
      window.addEventListener("chipakk-auth-changed", (e) => {
        applyAuthState(e.detail?.user);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAccount);
  } else {
    initAccount();
  }

})();
