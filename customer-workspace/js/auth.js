/* =========================================================
   CHIPAKK — Customer Authentication Module
   js/auth.js
   
   CENTRALIZED AUTHENTICATION LAYER:
   - Shared customer identity with THE MARSHANS (chipakk-77b99)
   - Browser-compatible Firebase Web Auth SDK
   - Persistent session handling (LOCAL persistence)
   - Friendly customer-facing error translation
   - Safe credential handling (zero private keys/secrets)
   ========================================================= */

(function () {
  "use strict";

  // Production Firebase Web Configuration (Public Client Config)
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB_0DEb67iAWglUi9a1XCbyOTQ6g2eVDzY",
    authDomain: "chipakk-77b99.firebaseapp.com",
    projectId: "chipakk-77b99",
    storageBucket: "chipakk-77b99.firebasestorage.app",
    messagingSenderId: "869954620444",
    appId: "1:869954620444:web:d12ace45869ad233ace3d9",
    measurementId: "G-EQBMDTE656"
  };

  let authInstance = null;
  let currentUser = null;
  let isReady = false;
  const readyCallbacks = [];
  const stateChangeListeners = [];

  // Initialize Firebase App and Auth
  function initFirebase() {
    if (typeof window.firebase === "undefined") {
      console.warn("[CHIPAKK Auth] Firebase SDK not loaded from CDN. Operating in offline/fallback mode.");
      isReady = true;
      flushReady();
      return null;
    }

    try {
      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        window.firebase.initializeApp(FIREBASE_CONFIG);
      }
      authInstance = window.firebase.auth();

      // Ensure standard browser persistence
      if (authInstance && authInstance.setPersistence && window.firebase.auth.Auth && window.firebase.auth.Auth.Persistence) {
        authInstance.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL)
          .catch((err) => {
            console.warn("[CHIPAKK Auth] Persistence setting notice:", err.message);
          });
      }

      // Single authoritative auth state listener
      authInstance.onAuthStateChanged((user) => {
        currentUser = user;
        isReady = true;
        flushReady();

        // Notify all registered state change listeners
        stateChangeListeners.forEach((fn) => {
          try {
            fn(user);
          } catch (e) {
            console.error("[CHIPAKK Auth] Listener error:", e);
          }
        });

        // Dispatch global custom event for any decoupled components
        try {
          window.dispatchEvent(new CustomEvent("chipakk-auth-changed", { detail: { user } }));
        } catch (e) {}
      });

      return authInstance;
    } catch (err) {
      console.error("[CHIPAKK Auth] Initialization error:", err.message);
      isReady = true;
      flushReady();
      return null;
    }
  }

  function flushReady() {
    while (readyCallbacks.length > 0) {
      const cb = readyCallbacks.shift();
      try {
        cb(currentUser);
      } catch (e) {}
    }
  }

  // Promise resolving when initial auth state has been determined
  function isAuthReady() {
    if (isReady) {
      return Promise.resolve(currentUser);
    }
    return new Promise((resolve) => {
      readyCallbacks.push(resolve);
    });
  }

  // Current authenticated user
  function getCurrentUser() {
    return currentUser;
  }

  // Subscribe to auth state changes
  function onAuthStateChanged(callback) {
    if (typeof callback !== "function") return () => {};
    stateChangeListeners.push(callback);

    // If already initialized, trigger callback immediately with current state
    if (isReady) {
      try {
        callback(currentUser);
      } catch (e) {
        console.error("[CHIPAKK Auth] Immediate callback error:", e);
      }
    }

    // Return unregister function
    return function unsubscribe() {
      const idx = stateChangeListeners.indexOf(callback);
      if (idx !== -1) {
        stateChangeListeners.splice(idx, 1);
      }
    };
  }

  // Human-readable error translation (never expose raw internal Firebase errors)
  function mapAuthError(error) {
    if (!error) return "An unexpected error occurred. Please try again.";

    const code = error.code || "";
    const msg = error.message || "";

    switch (code) {
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "That email or password doesn't look right. Please check your credentials.";
      case "auth/email-already-in-use":
        return "An account already exists with this email. Please sign in instead.";
      case "auth/weak-password":
        return "Please choose a stronger password (minimum 6 characters).";
      case "auth/invalid-email":
        return "Please enter a valid email address.";
      case "auth/network-request-failed":
        return "We couldn't connect right now. Please check your connection and try again.";
      case "auth/too-many-requests":
        return "Too many attempts. For security, please wait a few moments before trying again.";
      case "auth/user-disabled":
        return "This account has been disabled. Please contact CHIPAKK support.";
      case "auth/operation-not-allowed":
        return "Email and password sign-in is not enabled. Please contact support.";
      case "auth/requires-recent-login":
        return "Please log in again to continue this action.";
      case "auth/popup-closed-by-user":
        return "Sign-in window was closed before completing.";
      default:
        if (msg && !code) return msg;
        return "Unable to complete authentication. Please try again.";
    }
  }

  // Sign in existing customer
  async function signIn(email, password) {
    if (!authInstance) {
      throw new Error("Authentication service is unavailable. Please refresh and try again.");
    }
    const cleanEmail = (email || "").trim();
    if (!cleanEmail || !password) {
      throw new Error("Please enter both email and password.");
    }
    try {
      const credential = await authInstance.signInWithEmailAndPassword(cleanEmail, password);
      return credential.user;
    } catch (err) {
      const friendlyMsg = mapAuthError(err);
      const mappedError = new Error(friendlyMsg);
      mappedError.code = err.code;
      throw mappedError;
    }
  }

  // Create new customer account with display name
  async function signUp(name, email, password) {
    if (!authInstance) {
      throw new Error("Authentication service is unavailable. Please refresh and try again.");
    }
    const cleanName = (name || "").trim();
    const cleanEmail = (email || "").trim();

    if (!cleanName) {
      throw new Error("Please enter your full name.");
    }
    if (!cleanEmail) {
      throw new Error("Please enter your email address.");
    }
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters long.");
    }

    try {
      const credential = await authInstance.createUserWithEmailAndPassword(cleanEmail, password);
      const user = credential.user;

      // Update user profile with display name
      if (user && user.updateProfile) {
        try {
          await user.updateProfile({
            displayName: cleanName
          });
        } catch (profileErr) {
          console.warn("[CHIPAKK Auth] Notice updating displayName:", profileErr.message);
        }
      }

      return user;
    } catch (err) {
      const friendlyMsg = mapAuthError(err);
      const mappedError = new Error(friendlyMsg);
      mappedError.code = err.code;
      throw mappedError;
    }
  }

  // Sign out customer
  async function signOutUser() {
    if (!authInstance) {
      currentUser = null;
      stateChangeListeners.forEach((fn) => {
        try { fn(null); } catch (e) {}
      });
      return;
    }
    try {
      await authInstance.signOut();
    } catch (err) {
      const friendlyMsg = mapAuthError(err);
      throw new Error(friendlyMsg);
    }
  }

  // Google OAuth sign-in extension point
  async function signInWithGoogle() {
    if (!authInstance || typeof window.firebase === "undefined") {
      throw new Error("Authentication service is unavailable. Please try again.");
    }
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      const credential = await authInstance.signInWithPopup(provider);
      return credential.user;
    } catch (err) {
      console.warn("[CHIPAKK Auth] Google sign-in notice:", err.code);
      const friendlyMsg = mapAuthError(err);
      const mappedError = new Error(friendlyMsg);
      mappedError.code = err.code;
      throw mappedError;
    }
  }

  // Helper to get first name or safe fallback
  function getFirstName(user) {
    if (!user) return "";
    if (user.displayName && user.displayName.trim()) {
      return user.displayName.trim().split(" ")[0];
    }
    if (user.email) {
      const prefix = user.email.split("@")[0];
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
    return "Member";
  }

  // Helper to get full display name
  function getDisplayName(user) {
    if (!user) return "";
    if (user.displayName && user.displayName.trim()) {
      return user.displayName.trim();
    }
    if (user.email) {
      return user.email.split("@")[0];
    }
    return "CHIPAKK Member";
  }

  // Initialize on load
  initFirebase();

  // Export to CHIPAKK namespace
  window.CHIPAKK = window.CHIPAKK || {};
  window.CHIPAKK.auth = {
    getCurrentUser,
    onAuthStateChanged,
    signIn,
    signUp,
    signOutUser,
    signInWithGoogle,
    mapAuthError,
    isAuthReady,
    getFirstName,
    getDisplayName,
    get authInstance() {
      return authInstance;
    }
  };

})();
