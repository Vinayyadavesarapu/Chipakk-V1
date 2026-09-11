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
      : 0;
    const standardShippingFee = typeof settings.shippingFee === "number" 
      ? settings.shippingFee 
      : 50;
    const gstRate = typeof settings.gstRate === "number" 
      ? settings.gstRate 
      : 18;

    // Shipping calculation
    if (selectedShipping === "express") {
      shippingCharge = 99;
    } else {
      shippingCharge = (freeShippingThreshold <= 0 || subtotal >= freeShippingThreshold) ? 0 : standardShippingFee;
    }

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
      } else if (appliedCoupon.discountType === "free_shipping") {
        discount = shippingCharge;
        shippingCharge = 0;
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

        if (result && result.success && result.data) {
          const couponData = result.data;
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
          const errMsg = result?.error || "Invalid or expired coupon code.";
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
    // Shipping options
    const standardRadio = $("#shipStandard");
    const expressRadio = $("#shipExpress");

    standardRadio?.addEventListener("change", () => {
      selectedShipping = "standard";
      renderCheckoutSummary();
    });

    expressRadio?.addEventListener("change", () => {
      selectedShipping = "express";
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

      // 1. Validate Email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        showToast("Please enter a valid email address.", "error");
        $("#custEmail")?.focus();
        return;
      }

      // 2. Validate Phone (Clean Indian 10-digit format)
      const cleanPhone = rawPhone.replace(/^(\+91|91|0)/, "").replace(/[\s-]/g, "");
      const phoneRegex = /^[6-9]\d{9}$/;
      if (!phoneRegex.test(cleanPhone)) {
        showToast("Please enter a valid 10-digit Indian mobile number.", "error");
        $("#custPhone")?.focus();
        return;
      }

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
      if (!pinRegex.test(pin)) {
        showToast("Please enter a valid 6-digit postal PIN code.", "error");
        $("#custPin")?.focus();
        return;
      }

      // 5. Verify Cart against Live Catalog (if available)
      try {
        if (typeof window.CHIPAKK?.getProducts === "function") {
          const liveProducts = await window.CHIPAKK.getProducts();
          if (Array.isArray(liveProducts) && liveProducts.length > 0) {
            const liveMap = new Map(liveProducts.map(p => [p.id, p]));
            for (const item of cart.items) {
              const liveProd = liveMap.get(item.id);
              if (liveProd && liveProd.in_stock === false) {
                showToast(`"${item.name}" is currently out of stock.`, "error");
                return;
              }
            }
          }
        }
      } catch (catErr) {
        console.warn("Catalog stock verification skipped:", catErr);
      }

      // 6. Submit Order to Real Backend API
      placeBtn.disabled = true;
      placeBtn.textContent = selectedPayment === "cod" ? "Placing Order…" : "Initiating Payment…";

      try {
        const orderPayload = {
          items: cart.items.map(item => ({
            product_id: parseInt(item.id, 10),
            variant_id: item.variantId ? parseInt(item.variantId, 10) : null,
            quantity: item.qty
          })),
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
          payment_method: selectedPayment.toUpperCase()
        };

        let response = null;
        if (typeof window.CHIPAKK?.createOrderApi === "function") {
          response = await window.CHIPAKK.createOrderApi(orderPayload);
        } else if (typeof window.CHIPAKK?.api?.createOrder === "function") {
          response = await window.CHIPAKK.api.createOrder(orderPayload);
        }

        if (!response || !response.success || !response.data) {
          const errMsg = response?.error || "Failed to place order. Please check your details and try again.";
          showToast(errMsg, "error");
          placeBtn.disabled = false;
          placeBtn.textContent = "Place Order 🚀";
          return;
        }

        const realOrder = response.data;

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
          showConfirmationModal(realOrder, {
            isCod: true,
            customerName: name,
            customerPhone: cleanPhone,
            city,
            state,
            cleanPin
          });
        } else {
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
        showToast(orderErr.message || "Network error while placing order.", "error");
      } finally {
        placeBtn.disabled = false;
        placeBtn.textContent = "Place Order 🚀";
      }
    });

    /**
     * Launch Razorpay Online Gateway Checkout
     */
    async function launchOnlinePayment(realOrder, customerData) {
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

        if (!payRes || !payRes.success || !payRes.data) {
          if (payRes?.code === "GATEWAY_NOT_CONFIGURED") {
            showToast("Online payment gateway is in test mode. Order recorded as Pending Payment.", "info");
            showConfirmationModal(realOrder, {
              isPending: true,
              canRetry: true,
              customerData,
              note: "Payment gateway credentials are being configured on server. Your order #CHP-... has been securely recorded."
            });
            return;
          }
          throw new Error(payRes?.error || "Unable to initiate payment with gateway.");
        }

        const paymentData = payRes.data;

        // If order was already paid
        if (paymentData.already_paid) {
          cart.clear();
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

              if (verifyRes && verifyRes.success && verifyRes.data?.payment_status === "paid") {
                // 100% SERVER VERIFIED PAYMENT SUCCESS
                cart.clear();
                showToast("Payment verified successfully! 🎉", "success");
                showConfirmationModal(realOrder, {
                  isPaid: true,
                  paymentId: response.razorpay_payment_id,
                  customerData
                });
              } else {
                showToast("Payment status is pending verification.", "info");
                showConfirmationModal(realOrder, {
                  isPending: true,
                  customerData
                });
              }
            } catch (verifyErr) {
              console.error("Signature verification error:", verifyErr);
              showToast("Payment verification failed: " + verifyErr.message, "error");
              showConfirmationModal(realOrder, {
                isFailed: true,
                canRetry: true,
                customerData,
                errorMsg: verifyErr.message
              });
            } finally {
              placeBtn.disabled = false;
              placeBtn.textContent = "Place Order 🚀";
            }
          },
          modal: {
            ondismiss: function () {
              // Customer dismissed or cancelled popup without completing payment
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
        showToast(payErr.message || "Failed to start payment.", "error");
        showConfirmationModal(realOrder, {
          isFailed: true,
          canRetry: true,
          customerData,
          errorMsg: payErr.message
        });
      } finally {
        placeBtn.disabled = false;
        placeBtn.textContent = "Place Order 🚀";
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

      const subtotalRupees = realOrder.subtotal_rupees !== undefined ? realOrder.subtotal_rupees : Math.round((realOrder.subtotal || 0) / 100);
      if (subtotalEl) subtotalEl.textContent = formatPrice(subtotalRupees);

      const shippingRupees = realOrder.shipping_charge_rupees !== undefined ? realOrder.shipping_charge_rupees : Math.round((realOrder.shipping_charge || 0) / 100);
      if (shippingEl) shippingEl.textContent = shippingRupees === 0 ? "FREE" : formatPrice(shippingRupees);

      const discountRupees = realOrder.discount_total_rupees !== undefined ? realOrder.discount_total_rupees : Math.round((realOrder.discount_total || 0) / 100);
      if (discountRow && discountEl) {
        if (discountRupees > 0) {
          discountRow.style.display = "flex";
          discountEl.textContent = `-${formatPrice(discountRupees)}`;
        } else {
          discountRow.style.display = "none";
        }
      }

      const grandTotalRupees = realOrder.total_price_rupees !== undefined ? realOrder.total_price_rupees : Math.round((realOrder.total_price || 0) / 100);
      if (totalEl) totalEl.textContent = formatPrice(grandTotalRupees);

      if (deliveryEl && options.customerData) {
        const c = options.customerData;
        deliveryEl.textContent = `${escapeHtml(c.name || "")}, ${escapeHtml(c.city || "")}, ${escapeHtml(c.state || "")} — ${escapeHtml(c.cleanPin || "")} (Ph: ${escapeHtml(c.phone || "")})`;
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

    function renderCheckoutAuthState(user) {
      if (user) {
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
      } else {
        if (banner) {
          banner.style.background = "#eff6ff";
          banner.style.borderColor = "#2563eb";
          banner.innerHTML = `
            <span>Already have a CHIPAKK account?</span>
            <a href="account.html">Sign in for faster checkout →</a>
          `;
        }
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
