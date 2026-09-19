/* =========================================================
   CHIPAKK — Checkout Module
   js/checkout.js

   CHECKOUT FLOW ENGINE (PHASE 5):
   - Synchronized live cart items from localStorage
   - Live backend coupon validation via POST /api/coupons/validate
   - Dynamic shipping and GST calculation from store settings API
   - Strict contact & delivery address validation (Indian phone & PIN)
   - Auto-fill from Firebase Auth profile and saved shipping address
   - Persistent shipping address snapshot (chipakk_shipping_address_v1)
   - Honest Order Review & Launch Staging Modal (Zero fake orders/IDs)
   ========================================================= */

(function () {
  "use strict";

  const {
    cart,
    formatPrice,
    showToast,
    escapeHtml,
    escapeAttr,
    $,
    $$
  } = window.CHIPAKK;

  let appliedCoupon = null;
  let selectedShipping = "standard"; // "standard" or "express"
  let selectedPayment = "upi";
  let isSubmitting = false;
  let pendingOnlineOrder = null;
  let activeIdempotencyKey = null;

  function extractCheckoutErrorMessage(errObj, fallback = "An unexpected error occurred") {
    if (!errObj) return fallback;
    if (typeof errObj === "string") return errObj;
    if (typeof errObj === "object") {
      if (errObj.error) {
        if (typeof errObj.error === "string") return errObj.error;
        if (typeof errObj.error === "object" && errObj.error.message) return String(errObj.error.message);
      }
      if (errObj.message) {
        if (typeof errObj.message === "string") return errObj.message;
        if (typeof errObj.message === "object" && errObj.message.message) return String(errObj.message.message);
      }
    }
    return fallback;
  }

  window.addEventListener("chipakk-cart-updated", () => {
    pendingOnlineOrder = null;
    activeIdempotencyKey = null;
  });

  function normalizeIndianPhoneNumber(input) {
    if (!input && input !== 0) {
      return { valid: false, phone: null };
    }
    const digits = String(input).replace(/\D/g, "");
    if (digits.length === 10) {
      if (/^[6-9]/.test(digits)) {
        return { valid: true, phone: digits };
      }
      return { valid: false, phone: null };
    }
    if (digits.length === 11 && digits.startsWith("0")) {
      const candidate = digits.slice(1);
      if (/^[6-9]/.test(candidate)) {
        return { valid: true, phone: candidate };
      }
      return { valid: false, phone: null };
    }
    if (digits.length === 12 && digits.startsWith("91")) {
      const candidate = digits.slice(2);
      if (/^[6-9]/.test(candidate)) {
        return { valid: true, phone: candidate };
      }
      return { valid: false, phone: null };
    }
    return { valid: false, phone: null };
  }

  /* =========================================================
     1. CALCULATE ORDER TOTALS
     ========================================================= */

  function calculateTotals() {
    const subtotal = cart.getSubtotal();
    let discount = 0;
    let shippingCharge = 0;

    // Dynamic settings from CHIPAKK.DATA.settings (populated via GET /api/settings)
    const settings = window.CHIPAKK?.DATA?.settings || {};
    const freeShippingThreshold = typeof settings.freeShippingThreshold === "number"
      ? settings.freeShippingThreshold
      : 300;
    const standardShippingFee = typeof settings.shippingFee === "number"
      ? settings.shippingFee
      : 50;
    const gstRate = typeof settings.gstRate === "number"
      ? settings.gstRate
      : 18;

    // Shipping calculation: Free shipping evaluated strictly on GROSS merchandise subtotal
    shippingCharge = (freeShippingThreshold > 0 && subtotal >= freeShippingThreshold) ? 0 : standardShippingFee;

    // Coupon discount calculation
    if (appliedCoupon) {
      // Check minimum order value requirement
      if (appliedCoupon.minOrderValueRupees && subtotal < appliedCoupon.minOrderValueRupees) {
        appliedCoupon = null;
        const msgEl = $("#couponMessage");
        if (msgEl) {
          msgEl.style.display = "block";
          msgEl.style.color = "#991b1b";
          msgEl.textContent = "Coupon removed: Cart subtotal is below minimum order requirement.";
        }
      } else if (appliedCoupon.discountType === "percent") {
        discount = Math.round((subtotal * appliedCoupon.discountValue) / 100);
        if (appliedCoupon.maxDiscountRupees && discount > appliedCoupon.maxDiscountRupees) {
          discount = appliedCoupon.maxDiscountRupees;
        }
      } else if (appliedCoupon.discountType === "fixed") {
        discount = Math.min(subtotal, appliedCoupon.discountRupees || appliedCoupon.discountValue);
      }
    }

    const discountedSubtotal = Math.max(0, subtotal - discount);
    const finalTotal = discountedSubtotal + shippingCharge;
    const gstPct = gstRate / 100;
    const gstPortion = Math.round(finalTotal * gstPct / (1 + gstPct)); // GST inclusive portion

    return {
      subtotal,
      discount,
      shippingCharge,
      finalTotal,
      gstPortion,
      gstRate,
      freeShippingThreshold,
      standardShippingFee
    };
  }

  /* =========================================================
     2. RENDER ORDER SUMMARY
     ========================================================= */

  function renderCheckoutSummary() {
    const itemsContainer = $("#checkoutItemsList");
    const subtotalEl = $("#checkoutSubtotal");
    const discountRow = $("#checkoutDiscountRow");
    const discountEl = $("#checkoutDiscountAmount");
    const shippingEl = $("#checkoutShipping");
    const taxEl = $("#checkoutTax");
    const totalEl = $("#checkoutTotal");
    const placeBtn = $("#placeOrderBtn");

    if (!itemsContainer) return;

    const items = cart.items;

    if (items.length === 0) {
      itemsContainer.innerHTML = `
        <div style="text-align: center; padding: 24px 0;">
          <span style="font-size: 36px;">🛒</span>
          <p style="font-weight: 700; margin: 10px 0;">Your cart is empty.</p>
          <a href="shop.html" class="btn btn-primary" style="font-size: 13px; padding: 10px 18px;">Shop Stickers →</a>
        </div>
      `;
      if (subtotalEl) subtotalEl.textContent = "₹0";
      if (shippingEl) shippingEl.textContent = "₹0";
      if (taxEl) taxEl.textContent = "₹0";
      if (totalEl) totalEl.textContent = "₹0";
      if (placeBtn) placeBtn.disabled = true;
      return;
    }

    if (placeBtn) placeBtn.disabled = false;

    // Render list of cart items
    itemsContainer.innerHTML = items.map(item => {
      const isImgUrl = typeof item.image === "string" && (item.image.startsWith("http") || item.image.includes("/"));
      return `
        <div class="checkout-item-row">
          <div class="checkout-item-left">
            <div class="checkout-item-thumb">
              ${isImgUrl
                ? `<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;" />`
                : (item.image || "⚡")
              }
            </div>
            <div>
              <div style="font-weight: 700;">${escapeHtml(item.name)}</div>
              <div style="font-size: 12px; color: #666;">${escapeHtml(item.material || 'Glossy')} • Qty: ${item.qty}</div>
            </div>
          </div>
          <div style="font-weight: 700;">${formatPrice(item.price * item.qty)}</div>
        </div>
      `;
    }).join("");

    const totals = calculateTotals();

    if (subtotalEl) subtotalEl.textContent = formatPrice(totals.subtotal);

    if (discountRow && discountEl) {
      if (totals.discount > 0) {
        discountRow.style.display = "flex";
        discountEl.textContent = `-${formatPrice(totals.discount)}`;
      } else {
        discountRow.style.display = "none";
      }
    }

    if (shippingEl) {
      shippingEl.textContent = totals.shippingCharge === 0 ? "FREE" : formatPrice(totals.shippingCharge);
    }

    if (taxEl) taxEl.textContent = formatPrice(totals.gstPortion);
    if (totalEl) totalEl.textContent = formatPrice(totals.finalTotal);
  }

  /* =========================================================
     3. LIVE BACKEND COUPON VALIDATION
     ========================================================= */

  function initCoupons() {
    const couponInput = $("#couponInput");
    const applyBtn = $("#applyCouponBtn");
    const msgEl = $("#couponMessage");

    if (!applyBtn || !couponInput) return;

    applyBtn.addEventListener("click", async () => {
      const code = couponInput.value.trim().toUpperCase();
      if (!code) {
        showToast("Please enter a promo code");
        return;
      }

      const subtotal = cart.getSubtotal();
      if (subtotal <= 0) {
        showToast("Add items to your cart before applying a coupon.");
        return;
      }

      applyBtn.disabled = true;
      applyBtn.textContent = "Checking...";

      try {
        let result = null;
        if (typeof window.CHIPAKK?.validateCouponApi === "function") {
          result = await window.CHIPAKK.validateCouponApi(code, subtotal);
        } else if (typeof window.CHIPAKK?.api?.validateCoupon === "function") {
          result = await window.CHIPAKK.api.validateCoupon(code, subtotal);
        }

        const isSuccess = (result && (result.success || result.valid)) && (result.data || result.coupon);
        if (isSuccess) {
          const couponData = result.data || result.coupon;
          appliedCoupon = {
            code: couponData.code || code,
            discountType: couponData.discount_type || "percent",
            discountValue: typeof couponData.discount_value === "number" ? couponData.discount_value : 0,
            discountRupees: typeof couponData.discount_rupees === "number" ? couponData.discount_rupees : 0,
            minOrderValueRupees: typeof couponData.min_order_value_rupees === "number" ? couponData.min_order_value_rupees : 0,
            maxDiscountRupees: typeof couponData.max_discount_amount_rupees === "number" ? couponData.max_discount_amount_rupees : null,
            label: couponData.discount_type === "percent"
              ? `${couponData.discount_value}% OFF`
              : `₹${couponData.discount_rupees || couponData.discount_value} OFF`
          };

          if (msgEl) {
            msgEl.style.display = "block";
            msgEl.style.color = "#166534";
            msgEl.textContent = `Coupon "${appliedCoupon.code}" applied! (${appliedCoupon.label})`;
          }
          showToast(`Coupon applied: ${appliedCoupon.label}`);
          renderCheckoutSummary();
        } else {
          appliedCoupon = null;
          const errMsg = extractCheckoutErrorMessage(result, "Invalid or expired coupon code.");
          if (msgEl) {
            msgEl.style.display = "block";
            msgEl.style.color = "#991b1b";
            msgEl.textContent = errMsg;
          }
          showToast(errMsg, "error");
          renderCheckoutSummary();
        }
      } catch (err) {
        console.warn("Coupon validation error:", err);
        appliedCoupon = null;
        if (msgEl) {
          msgEl.style.display = "block";
          msgEl.style.color = "#991b1b";
          msgEl.textContent = "Unable to validate coupon at this time. Please try again.";
        }
        showToast("Coupon validation error", "error");
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = "Apply";
      }
    });
  }

  /* =========================================================
     4. SHIPPING & PAYMENT TOGGLE
     ========================================================= */

  function initShippingAndPayment() {
    selectedShipping = "standard";

    // Shipping options
    const standardRadio = $("#shipStandard");
    standardRadio?.addEventListener("change", () => {
      selectedShipping = "standard";
      renderCheckoutSummary();
    });

    // Payment method cards
    const paymentCards = $$(".payment-card");
    paymentCards.forEach(card => {
      card.addEventListener("click", () => {
        paymentCards.forEach(c => c.classList.remove("is-active"));
        card.classList.add("is-active");
        selectedPayment = card.dataset.paymentMethod || "upi";
      });
    });
  }

  /* =========================================================
     5. ADDRESS & CONTACT VALIDATION + ORDER PLACEMENT
     ========================================================= */

  function initPlaceOrder() {
    const placeBtn = $("#placeOrderBtn");
    const modal = $("#orderSuccessModal");
    const closeModalBtn = $("#closeOrderModalBtn");

    if (!placeBtn) return;

    placeBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      if (isSubmitting) return;

      if (cart.items.length === 0) {
        showToast("Your cart is empty!");
        return;
      }

      // Input field extraction
      const email = $("#custEmail")?.value.trim() || "";
      const rawPhone = $("#custPhone")?.value.trim() || "";
      const name = $("#custName")?.value.trim() || "";
      const address = $("#custAddress")?.value.trim() || "";
      const city = $("#custCity")?.value.trim() || "";
      const state = $("#custState")?.value.trim() || "";
      const pin = $("#custPin")?.value.trim() || "";
      const cleanPin = pin.replace(/\s+/g, "");

      // 1. Validate Email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        showToast("Please enter a valid email address.", "error");
        $("#custEmail")?.focus();
        return;
      }

      // 2. Validate Phone (Clean Indian 10-digit format)
      const phoneValidation = normalizeIndianPhoneNumber(rawPhone);
      if (!phoneValidation.valid) {
        showToast("Please enter a valid 10-digit Indian mobile number.", "error");
        $("#custPhone")?.focus();
        return;
      }
      const cleanPhone = phoneValidation.phone;

      // 3. Validate Name & Street Address
      if (name.length < 2) {
        showToast("Please enter your full recipient name.", "error");
        $("#custName")?.focus();
        return;
      }

      if (address.length < 5) {
        showToast("Please provide a complete street address.", "error");
        $("#custAddress")?.focus();
        return;
      }

      if (city.length < 2) {
        showToast("Please enter your city.", "error");
        $("#custCity")?.focus();
        return;
      }

      if (state.length < 2) {
        showToast("Please enter your state.", "error");
        $("#custState")?.focus();
        return;
      }

      // 4. Validate PIN Code (Indian 6-digit postal code)
      const pinRegex = /^[1-9][0-9]{5}$/;
      if (!pinRegex.test(cleanPin)) {
        showToast("Please enter a valid 6-digit postal PIN code.", "error");
        $("#custPin")?.focus();
        return;
      }

      // 5. Single-flight submission guard — lock immediately before any asynchronous operations
      isSubmitting = true;
      placeBtn.disabled = true;
      placeBtn.textContent = selectedPayment === "cod" ? "Placing Order…" : "Initiating Payment…";

      // If customer previously created an order that is pending online payment and hasn't changed cart/address, reuse it!
      if (selectedPayment !== "cod" && pendingOnlineOrder && pendingOnlineOrder.id) {
        await launchOnlinePayment(pendingOnlineOrder, {
          name,
          email,
          phone: cleanPhone,
          city,
          state,
          cleanPin
        });
        return;
      }

      // Verify Cart against Live Catalog (if available)
      try {
        if (typeof window.CHIPAKK?.getProducts === "function") {
          const liveProducts = await window.CHIPAKK.getProducts();
          if (Array.isArray(liveProducts) && liveProducts.length > 0) {
            const liveMap = new Map(liveProducts.map(p => [String(p.id), p]));
            let priceChanged = false;
            for (const item of cart.items) {
              if (item.is_custom) continue;
              const liveProd = liveMap.get(String(item.id));
              if (liveProd && liveProd.in_stock === false) {
                showToast(`"${item.name}" is currently out of stock.`, "error");
                isSubmitting = false;
                placeBtn.disabled = false;
                placeBtn.textContent = "Place Order 🚀";
                return;
              }
              if (liveProd && typeof liveProd.price === 'number' && liveProd.price !== item.price) {
                item.price = liveProd.price;
                priceChanged = true;
              }
            }
            if (priceChanged) {
              cart.save();
              renderOrderReview();
              showToast("Some item prices updated. Please review your total.", "info");
              isSubmitting = false;
              placeBtn.disabled = false;
              placeBtn.textContent = "Place Order 🚀";
              return;
            }
          }
        }
      } catch (catErr) {
        console.warn("Catalog stock verification skipped:", catErr);
      }

      // 6. Submit Order to Real Backend API
      try {
        if (!activeIdempotencyKey) {
          activeIdempotencyKey = 'chk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        }

        const orderPayload = {
          idempotency_key: activeIdempotencyKey,
          items: cart.items.map(item => {
            const isCustom = Boolean(item.is_custom || !item.id || isNaN(parseInt(item.id, 10)) || String(item.id).startsWith("custom_"));
            const numProdId = isCustom ? null : parseInt(item.id, 10);
            return {
              product_id: numProdId,
              variant_id: item.variantId && !isNaN(parseInt(item.variantId, 10)) ? parseInt(item.variantId, 10) : null,
              quantity: item.qty,
              is_custom: isCustom,
              name: item.name,
              price: item.price,
              variant_options: (item.materials && item.sizes) ? `Finish: ${item.materials[0] || 'Glossy'}, Size: ${item.sizes[0] || '3"'}` : (item.variantOptions || null),
              custom_design_data: item.custom_design_data || null
            };
          }),
          shipping_address: {
            name,
            phone: cleanPhone,
            email,
            address,
            city,
            state,
            pincode: cleanPin,
            country: "India"
          },
          coupon_code: appliedCoupon ? appliedCoupon.code : null,
          shipping_method: "standard",
          payment_method: selectedPayment.toUpperCase()
        };

        let response = null;
        if (typeof window.CHIPAKK?.createOrderApi === "function") {
          response = await window.CHIPAKK.createOrderApi(orderPayload);
        } else if (typeof window.CHIPAKK?.api?.createOrder === "function") {
          response = await window.CHIPAKK.api.createOrder(orderPayload);
        }

        // Handle both unwrapped payload ({ id, order_number, ... }) and wrapped envelope ({ success: true, data: { ... } })
        const realOrder = (response && response.data) ? response.data : response;

        if (!realOrder || !realOrder.id) {
          const errMsg = extractCheckoutErrorMessage(response, "Failed to place order. Please check your details and try again.");
          showToast(errMsg, "error");
          isSubmitting = false;
          placeBtn.disabled = false;
          placeBtn.textContent = "Place Order 🚀";
          return;
        }

        // 7. Persist Local Shipping Address Snapshot for re-orders
        const shippingAddressSnapshot = {
          name,
          email,
          phone: cleanPhone,
          address,
          city,
          state,
          pin: cleanPin,
          paymentPreference: selectedPayment,
          updatedAt: new Date().toISOString()
        };
        try {
          localStorage.setItem("chipakk_shipping_address_v1", JSON.stringify(shippingAddressSnapshot));
        } catch (err) {}

        // 8. Handle Payment Method: COD vs Online Gateway
        if (selectedPayment === "cod") {
          // Cash on Delivery — Clear cart and show COD confirmation
          cart.clear();
          isSubmitting = false;
          pendingOnlineOrder = null;
          activeIdempotencyKey = null;
          placeBtn.disabled = false;
          placeBtn.textContent = "Place Order 🚀";
          showConfirmationModal(realOrder, {
            isCod: true,
            customerName: name,
            customerPhone: cleanPhone,
            city,
            state,
            cleanPin
          });
        } else {
          // Store created online order for retry deduplication
          pendingOnlineOrder = realOrder;
          // Online Payment (UPI, Card, Net Banking) via Razorpay
          await launchOnlinePayment(realOrder, {
            name,
            email,
            phone: cleanPhone,
            city,
            state,
            cleanPin
          });
        }
      } catch (orderErr) {
        console.error("Order placement error:", orderErr);
        showToast(extractCheckoutErrorMessage(orderErr, "Network error while placing order."), "error");
        isSubmitting = false;
        placeBtn.disabled = false;
        placeBtn.textContent = "Place Order 🚀";
      }
    });

    /**
     * Launch Razorpay Online Gateway Checkout
     */
    async function launchOnlinePayment(realOrder, customerData) {
      isSubmitting = true;
      placeBtn.disabled = true;
      placeBtn.textContent = "Opening Payment Gateway…";

      try {
        // Step A: Request Gateway Payment Order from backend
        let payRes = null;
        if (window.CHIPAKK?.createPaymentOrderApi) {
          payRes = await window.CHIPAKK.createPaymentOrderApi(realOrder.id);
        } else if (window.CHIPAKK?.api?.createPaymentOrder) {
          payRes = await window.CHIPAKK.api.createPaymentOrder(realOrder.id);
        }

        // Handle unwrapped vs wrapped envelope
        const paymentData = (payRes && payRes.data) ? payRes.data : payRes;

        if (!paymentData || (!paymentData.gateway_order_id && !paymentData.already_paid)) {
          if (payRes?.code === "GATEWAY_NOT_CONFIGURED" || paymentData?.code === "GATEWAY_NOT_CONFIGURED") {
            showToast("Online payment gateway is in test mode. Order recorded as Pending Payment.", "info");
            showConfirmationModal(realOrder, {
              isPending: true,
              canRetry: true,
              customerData,
              note: "Payment gateway credentials are being configured on server. Your order #CHP-... has been securely recorded."
            });
            isSubmitting = false;
            placeBtn.disabled = false;
            placeBtn.textContent = "Place Order 🚀";
            return;
          }
          throw new Error((payRes && payRes.error) || (paymentData && paymentData.error) || "Unable to initiate payment with gateway.");
        }

        // If order was already paid
        if (paymentData.already_paid) {
          cart.clear();
          isSubmitting = false;
          showConfirmationModal(realOrder, {
            isPaid: true,
            customerData
          });
          return;
        }

        // Step B: Load Razorpay Checkout Script if not present
        await loadRazorpayScript();

        if (!window.Razorpay) {
          throw new Error("Could not load payment checkout interface. Please check your network connection.");
        }

        // Step C: Initialize Razorpay Checkout Modal
        placeBtn.disabled = true;
        placeBtn.textContent = "Payment in progress…";

        const rzpOptions = {
          key: paymentData.key_id,
          amount: paymentData.amount, // in paise
          currency: paymentData.currency || "INR",
          name: "CHIPAKK",
          description: `Order #${realOrder.order_number}`,
          image: "assets/images/logo.png",
          order_id: paymentData.gateway_order_id,
          prefill: {
            name: customerData.name || paymentData.customer_name || "",
            email: customerData.email || paymentData.customer_email || "",
            contact: customerData.phone || paymentData.customer_phone || ""
          },
          theme: {
            color: "#0055ff" // CHIPAKK Blue
          },
          handler: async function (response) {
            // Step D: Server-side cryptographic signature verification
            placeBtn.disabled = true;
            placeBtn.textContent = "Verifying Payment…";

            try {
              let verifyRes = null;
              const verifyPayload = {
                order_id: realOrder.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              };

              if (window.CHIPAKK?.verifyPaymentApi) {
                verifyRes = await window.CHIPAKK.verifyPaymentApi(verifyPayload);
              } else if (window.CHIPAKK?.api?.verifyPayment) {
                verifyRes = await window.CHIPAKK.api.verifyPayment(verifyPayload);
              }

              // Handle unwrapped vs wrapped envelope
              const verifiedData = (verifyRes && verifyRes.data) ? verifyRes.data : verifyRes;

              if (verifiedData && (verifiedData.payment_status === "paid" || verifiedData.success === true)) {
                // 100% SERVER VERIFIED PAYMENT SUCCESS
                cart.clear();
                isSubmitting = false;
                pendingOnlineOrder = null;
                activeIdempotencyKey = null;
                showToast("Payment verified successfully! 🎉", "success");
                showConfirmationModal(realOrder, {
                  isPaid: true,
                  paymentId: response.razorpay_payment_id,
                  customerData
                });
              } else {
                isSubmitting = false;
                placeBtn.disabled = false;
                placeBtn.textContent = "Retry Payment 🚀";
                showToast("Payment status is pending verification.", "info");
                showConfirmationModal(realOrder, {
                  isPending: true,
                  customerData
                });
              }
            } catch (verifyErr) {
              console.error("Signature verification error:", verifyErr);
              showToast("Payment verification failed: " + verifyErr.message, "error");
              isSubmitting = false;
              placeBtn.disabled = false;
              placeBtn.textContent = "Retry Payment 🚀";
              showConfirmationModal(realOrder, {
                isFailed: true,
                canRetry: true,
                customerData,
                errorMsg: verifyErr.message
              });
            }
          },
          modal: {
            ondismiss: function () {
              // Customer dismissed or cancelled popup without completing payment
              isSubmitting = false;
              placeBtn.disabled = false;
              placeBtn.textContent = "Retry Payment 🚀";
              showToast("Payment not completed. Your order has been saved.", "info");
              showConfirmationModal(realOrder, {
                isDismissed: true,
                canRetry: true,
                customerData
              });
            }
          }
        };

        const rzpInstance = new window.Razorpay(rzpOptions);
        rzpInstance.on("payment.failed", function (failResp) {
          console.warn("Payment failed at gateway:", failResp.error);
          isSubmitting = false;
          placeBtn.disabled = false;
          placeBtn.textContent = "Retry Payment 🚀";
          showToast("Payment failed: " + (failResp.error?.description || "Transaction declined"), "error");
          showConfirmationModal(realOrder, {
            isFailed: true,
            canRetry: true,
            customerData,
            errorMsg: failResp.error?.description
          });
        });

        rzpInstance.open();
      } catch (payErr) {
        console.error("Payment initiation error:", payErr);
        isSubmitting = false;
        placeBtn.disabled = false;
        placeBtn.textContent = "Place Order 🚀";
        showToast(payErr.message || "Failed to start payment.", "error");
        showConfirmationModal(realOrder, {
          isFailed: true,
          canRetry: true,
          customerData,
          errorMsg: payErr.message
        });
      }
    }

    /**
     * Dynamically load Razorpay SDK script
     */
    function loadRazorpayScript() {
      return new Promise((resolve, reject) => {
        if (window.Razorpay) {
          return resolve(true);
        }
        const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
        if (existing) {
          existing.addEventListener("load", () => resolve(true));
          existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay script.")));
          return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error("Failed to load Razorpay script."));
        document.body.appendChild(script);
      });
    }

    /**
     * Show Order Confirmation Modal with dynamic payment states
     */
    function showConfirmationModal(realOrder, options = {}) {
      const modal = $("#orderSuccessModal");
      const titleEl = $("#successModalTitle");
      const bannerEl = $("#successStatusBanner");
      const statusTitleEl = $("#successStatusTitle");
      const statusTextEl = $("#successStatusText");
      const orderNumberBadge = $("#successOrderNumber");
      const subtotalEl = $("#successOrderSubtotal");
      const shippingEl = $("#successOrderShipping");
      const discountRow = $("#successDiscountRow");
      const discountEl = $("#successOrderDiscount");
      const totalEl = $("#successOrderTotal");
      const deliveryEl = $("#successDeliverySnapshot");
      const retryBtn = $("#retryPaymentBtn");

      if (orderNumberBadge) orderNumberBadge.textContent = realOrder.order_number;

      const isStore2 = parseInt(realOrder.store_id, 10) === 2;
      const subtotalRupees = realOrder.subtotal_rupees !== undefined ? realOrder.subtotal_rupees : (isStore2 ? Math.round((realOrder.subtotal || 0) / 100) : (realOrder.subtotal || 0));
      if (subtotalEl) subtotalEl.textContent = formatPrice(subtotalRupees);

      const shippingRupees = realOrder.shipping_charge_rupees !== undefined ? realOrder.shipping_charge_rupees : (isStore2 ? Math.round((realOrder.shipping_charge || 0) / 100) : (realOrder.shipping_charge || 0));
      if (shippingEl) shippingEl.textContent = shippingRupees === 0 ? "FREE" : formatPrice(shippingRupees);

      const discountRupees = realOrder.discount_total_rupees !== undefined ? realOrder.discount_total_rupees : (isStore2 ? Math.round((realOrder.discount_total || 0) / 100) : (realOrder.discount_total || 0));
      if (discountRow && discountEl) {
        if (discountRupees > 0) {
          discountRow.style.display = "flex";
          discountEl.textContent = `-${formatPrice(discountRupees)}`;
        } else {
          discountRow.style.display = "none";
        }
      }

      const grandTotalRupees = realOrder.total_price_rupees !== undefined ? realOrder.total_price_rupees : (isStore2 ? Math.round((realOrder.total_price || 0) / 100) : (realOrder.total_price || 0));
      if (totalEl) totalEl.textContent = formatPrice(grandTotalRupees);

      if (deliveryEl) {
        const c = options.customerData || {
          name: options.customerName || options.name,
          city: options.city,
          state: options.state,
          cleanPin: options.cleanPin || options.pincode || options.pin,
          phone: options.customerPhone || options.phone
        };
        if (c && (c.name || c.city || c.cleanPin)) {
          deliveryEl.textContent = `${escapeHtml(c.name || "")}, ${escapeHtml(c.city || "")}, ${escapeHtml(c.state || "")} — ${escapeHtml(c.cleanPin || "")} (Ph: ${escapeHtml(c.phone || "")})`;
        }
      }

      // Configure Status Banner & Retry Button
      if (options.isPaid) {
        if (titleEl) titleEl.textContent = "Payment Successful! 🎉";
        if (bannerEl) {
          bannerEl.style.background = "#f0fdf4";
          bannerEl.style.borderColor = "#16a34a";
        }
        if (statusTitleEl) {
          statusTitleEl.style.color = "#166534";
          statusTitleEl.textContent = "✓ Payment Status: PAID (Razorpay)";
        }
        if (statusTextEl) {
          statusTextEl.style.color = "#14532d";
          statusTextEl.textContent = `Your payment of ${formatPrice(grandTotalRupees)} has been verified and captured. Payment ID: ${options.paymentId || "Captured"}. Your order is now moving to production!`;
        }
        if (retryBtn) retryBtn.style.display = "none";
      } else if (options.isCod) {
        if (titleEl) titleEl.textContent = "Order Placed Successfully!";
        if (bannerEl) {
          bannerEl.style.background = "#fefce8";
          bannerEl.style.borderColor = "#ca8a04";
        }
        if (statusTitleEl) {
          statusTitleEl.style.color = "#854d0e";
          statusTitleEl.textContent = "💵 Payment Method: Cash on Delivery (Pending)";
        }
        if (statusTextEl) {
          statusTextEl.style.color = "#713f12";
          statusTextEl.textContent = "Your order has been recorded into the CHIPAKK production queue. Payment will be collected at your doorstep upon delivery.";
        }
        if (retryBtn) retryBtn.style.display = "none";
      } else if (options.isDismissed) {
        if (titleEl) titleEl.textContent = "Payment Incomplete";
        if (bannerEl) {
          bannerEl.style.background = "#fffbeb";
          bannerEl.style.borderColor = "#f59e0b";
        }
        if (statusTitleEl) {
          statusTitleEl.style.color = "#b45309";
          statusTitleEl.textContent = "⚠️ Payment Status: Not Completed";
        }
        if (statusTextEl) {
          statusTextEl.style.color = "#92400e";
          statusTextEl.textContent = "You closed the payment popup before completing payment. Your order has been saved in your account. You can complete payment now or view it later.";
        }
        if (retryBtn) {
          retryBtn.style.display = "block";
          retryBtn.textContent = "Retry Online Payment Now ⚡";
          retryBtn.onclick = () => {
            modal.style.display = "none";
            launchOnlinePayment(realOrder, options.customerData || {});
          };
        }
      } else if (options.isFailed) {
        if (titleEl) titleEl.textContent = "Payment Failed";
        if (bannerEl) {
          bannerEl.style.background = "#fef2f2";
          bannerEl.style.borderColor = "#ef4444";
        }
        if (statusTitleEl) {
          statusTitleEl.style.color = "#991b1b";
          statusTitleEl.textContent = "✕ Payment Status: FAILED";
        }
        if (statusTextEl) {
          statusTextEl.style.color = "#7f1d1d";
          statusTextEl.textContent = (options.errorMsg || "The transaction could not be completed by your bank.") + " Your order has been saved. Please try paying again or use a different payment method.";
        }
        if (retryBtn) {
          retryBtn.style.display = "block";
          retryBtn.textContent = "Try Payment Again ⚡";
          retryBtn.onclick = () => {
            modal.style.display = "none";
            launchOnlinePayment(realOrder, options.customerData || {});
          };
        }
      } else {
        // Pending
        if (titleEl) titleEl.textContent = "Payment Verification Pending";
        if (bannerEl) {
          bannerEl.style.background = "#fefce8";
          bannerEl.style.borderColor = "#ca8a04";
        }
        if (statusTitleEl) {
          statusTitleEl.style.color = "#854d0e";
          statusTitleEl.textContent = "⏳ Payment Status: Verification Pending";
        }
        if (statusTextEl) {
          statusTextEl.style.color = "#713f12";
          statusTextEl.textContent = options.note || "Your payment is being confirmed. Your order status will update as soon as the gateway confirmation is received.";
        }
        if (retryBtn && options.canRetry) {
          retryBtn.style.display = "block";
          retryBtn.textContent = "Retry Online Payment ⚡";
          retryBtn.onclick = () => {
            modal.style.display = "none";
            launchOnlinePayment(realOrder, options.customerData || {});
          };
        } else if (retryBtn) {
          retryBtn.style.display = "none";
        }
      }

      if (modal) {
        modal.style.display = "flex";
      }
    }

    // Close modal handlers
    if (closeModalBtn && modal) {
      closeModalBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.style.display = "none";
        }
      });
    }
  }

  /* =========================================================
     6. AUTHENTICATION & SAVED ADDRESS PRE-FILLING
     ========================================================= */

  function initCheckoutAuthAndAutoFill() {
    const banner = $("#checkoutAuthBanner");
    const emailInput = $("#custEmail");
    const nameInput = $("#custName");
    const phoneInput = $("#custPhone");
    const addressInput = $("#custAddress");
    const cityInput = $("#custCity");
    const stateInput = $("#custState");
    const pinInput = $("#custPin");

    // Load saved address from localStorage if available
    try {
      const savedRaw = localStorage.getItem("chipakk_shipping_address_v1");
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved && typeof saved === "object") {
          if (nameInput && !nameInput.value && saved.name) nameInput.value = saved.name;
          if (emailInput && !emailInput.value && saved.email) emailInput.value = saved.email;
          if (phoneInput && !phoneInput.value && saved.phone) phoneInput.value = saved.phone;
          if (addressInput && !addressInput.value && saved.address) addressInput.value = saved.address;
          if (cityInput && !cityInput.value && saved.city) cityInput.value = saved.city;
          if (stateInput && !stateInput.value && saved.state) stateInput.value = saved.state;
          if (pinInput && !pinInput.value && saved.pin) pinInput.value = saved.pin;
        }
      }
    } catch (e) {}

    async function renderCheckoutAuthState(user) {
      if (user) {
        // Enforce Admin vs Customer Isolation: verify via /customer/me
        try {
          const meData = await fetchAuthenticated("/customer/me");
          if (meData && meData.is_admin) {
            // User is an Administrator — do NOT prefill admin identity on customer checkout
            renderSignedOutCheckout();
            return;
          }
        } catch (_) {}

        const displayName = window.CHIPAKK?.auth?.getDisplayName
          ? window.CHIPAKK.auth.getDisplayName(user)
          : (user.displayName || user.email);

        if (banner) {
          banner.style.background = "#f0fdf4";
          banner.style.borderColor = "#16a34a";
          banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="auth-status-dot" style="background:#16a34a;"></span>
              <span>Signed in as <strong>${escapeHtml(displayName)}</strong></span>
            </div>
            <a href="account.html" style="font-size: 12px; color: #166534; font-weight: 700;">Manage Account →</a>
          `;
        }
        if (emailInput && !emailInput.value && user.email) {
          emailInput.value = user.email;
        }
        if (nameInput && !nameInput.value && user.displayName) {
          nameInput.value = user.displayName;
        }

        // Fetch saved addresses and render address selector for signed-in customer
        try {
          const fetchAddressesFn = window.CHIPAKK?.getCustomerAddressesApi || window.CHIPAKK?.api?.getAddresses;
          if (fetchAddressesFn) {
            const addresses = await fetchAddressesFn();
            if (Array.isArray(addresses) && addresses.length > 0) {
              const addressSection = $("#custAddress")?.closest(".checkout-card") || $("#custAddress")?.parentElement;
              if (addressSection && !$("#checkoutAddressSelector")) {
                const selectorWrapper = document.createElement("div");
                selectorWrapper.id = "checkoutAddressSelectorWrapper";
                selectorWrapper.style.cssText = "margin-bottom: 16px; background: var(--off-white); border: 2px solid var(--black); border-radius: var(--radius-sm); padding: 12px;";
                selectorWrapper.innerHTML = `
                  <label for="checkoutAddressSelector" style="font-weight: 700; font-size: 13px; display: block; margin-bottom: 6px; color: var(--black);">
                    📍 Select Saved Address (${addresses.length} available)
                  </label>
                  <select id="checkoutAddressSelector" style="width: 100%; border: 2px solid var(--black); border-radius: var(--radius-sm); padding: 8px 12px; font-family: inherit; font-size: 13px; font-weight: 600; background: #fff; cursor: pointer;">
                    <option value="">-- Choose a saved delivery address --</option>
                    ${addresses.map(a => `
                      <option value="${escapeAttr(String(a.id))}" ${a.is_default ? "selected" : ""}>
                        ${escapeHtml(a.type ? a.type.toUpperCase() : "HOME")} ${a.is_default ? "(Default)" : ""} — ${escapeHtml(a.full_name)}, ${escapeHtml(a.city)} (${escapeHtml(a.postal_code)})
                      </option>
                    `).join("")}
                  </select>
                `;

                addressSection.insertBefore(selectorWrapper, addressSection.firstChild);

                const selector = $("#checkoutAddressSelector");
                const autoFillAddr = (selectedId) => {
                  const addr = addresses.find(a => String(a.id) === String(selectedId));
                  if (!addr) return;
                  if (nameInput) nameInput.value = addr.full_name || "";
                  if (phoneInput) phoneInput.value = addr.phone || "";
                  if (addressInput) addressInput.value = [addr.address_line1, addr.address_line2].filter(Boolean).join(", ");
                  if (cityInput) cityInput.value = addr.city || "";
                  if (stateInput) stateInput.value = addr.state || "";
                  if (pinInput) pinInput.value = addr.postal_code || "";
                  showToast("Saved delivery address applied!");
                };

                selector?.addEventListener("change", (e) => {
                  if (e.target.value) autoFillAddr(e.target.value);
                });

                // Auto fill default address on load if present
                const defaultAddr = addresses.find(a => a.is_default) || addresses[0];
                if (defaultAddr && (!addressInput || !addressInput.value)) {
                  autoFillAddr(defaultAddr.id);
                }
              }
            }
          }
        } catch (addrErr) {
          console.warn("[CHIPAKK Checkout] Saved address load notice:", addrErr.message);
        }

      } else {
        renderSignedOutCheckout();
      }
    }

    function renderSignedOutCheckout() {
      if (banner) {
        banner.style.background = "#eff6ff";
        banner.style.borderColor = "#2563eb";
        banner.innerHTML = `
          <span>Already have a CHIPAKK account?</span>
          <a href="account.html">Sign in for faster checkout →</a>
        `;
      }
    }

    if (window.CHIPAKK?.auth?.onAuthStateChanged) {
      window.CHIPAKK.auth.onAuthStateChanged(renderCheckoutAuthState);
    } else {
      window.addEventListener("chipakk-auth-changed", (e) => {
        renderCheckoutAuthState(e.detail?.user);
      });
    }
  }

  /* =========================================================
     7. INITIALIZATION
     ========================================================= */

  function initCheckout() {
    renderCheckoutSummary();
    initCoupons();
    initShippingAndPayment();
    initPlaceOrder();
    initCheckoutAuthAndAutoFill();

    // Listen for cart changes across drawers or tabs
    window.addEventListener("chipakk-cart-updated", renderCheckoutSummary);

    // Re-render when store settings finish loading from the backend API
    window.addEventListener("chipakk-settings-updated", renderCheckoutSummary);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCheckout);
  } else {
    initCheckout();
  }

})();
