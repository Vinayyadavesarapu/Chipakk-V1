/* =========================================================
   CHIPAKK — Password Reset Completion Controller
   js/reset-password.js
   ========================================================= */

(function () {
  "use strict";

  const { auth, $, $$, showToast } = window.CHIPAKK;

  function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      mode: params.get("mode") || "",
      oobCode: params.get("oobCode") || params.get("code") || ""
    };
  }

  function setButtonLoading(btn, isLoading, text) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.textContent = text;
  }

  function togglePasswordButtons() {
    $$(".toggle-password-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.target;
        const input = $(`#${targetId}`);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.textContent = isPassword ? "🙈" : "👁️";
      });
    });
  }

  async function initResetPasswordPage() {
    togglePasswordButtons();

    const { oobCode } = parseQueryParams();
    const loadingState = $("#resetLoadingState");
    const form = $("#resetPasswordForm");
    const invalidState = $("#resetInvalidState");
    const successState = $("#resetSuccessState");
    const subtitle = $("#resetSubtitle");
    const errorBox = $("#resetErrorBox");
    const invalidMsg = $("#resetInvalidMsg");

    if (!oobCode) {
      if (loadingState) loadingState.style.display = "none";
      if (invalidState) invalidState.style.display = "block";
      if (invalidMsg) invalidMsg.textContent = "No password reset code was provided in the link.";
      return;
    }

    // Verify Firebase Action Code
    try {
      const email = await auth.verifyPasswordResetCode(oobCode);
      if (loadingState) loadingState.style.display = "none";
      if (form) form.style.display = "block";
      if (subtitle) subtitle.textContent = `Set a new password for ${email}`;
    } catch (err) {
      if (loadingState) loadingState.style.display = "none";
      if (invalidState) invalidState.style.display = "block";
      if (invalidMsg) invalidMsg.textContent = err.message || "This password reset link is invalid or has expired.";
      return;
    }

    // Handle Form Submission
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorBox) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
      }

      const newPassword = $("#newPassword")?.value;
      const confirmPassword = $("#confirmNewPassword")?.value;
      const submitBtn = $("#resetSubmitBtn");

      if (!newPassword || newPassword.length < 6) {
        if (errorBox) {
          errorBox.textContent = "Please enter a password with at least 6 characters.";
          errorBox.style.display = "block";
        }
        return;
      }

      if (newPassword !== confirmPassword) {
        if (errorBox) {
          errorBox.textContent = "Passwords do not match. Please verify.";
          errorBox.style.display = "block";
        }
        return;
      }

      setButtonLoading(submitBtn, true, "Updating Password…");

      try {
        await auth.confirmPasswordReset(oobCode, newPassword);
        if (form) form.style.display = "none";
        if (successState) successState.style.display = "block";
        if (subtitle) subtitle.textContent = "Your password has been reset successfully.";
        showToast("Password updated! You can now sign in.");
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || "Failed to update password. Please try again.";
          errorBox.style.display = "block";
        }
      } finally {
        setButtonLoading(submitBtn, false, "Update Password →");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initResetPasswordPage);
  } else {
    initResetPasswordPage();
  }
})();
