/* =========================================================
   CHIPAKK — Synchronized Countdown Module
   js/countdown.js

   Single source of truth for all countdown timers across the
   storefront (Hero / Promotional Drops & Top Announcement Bar).

   Guarantees:
   - Uses absolute timestamps (wall clock delta), never decremented counters
   - Persists through refresh, background tab throttling, and route navigation
   - Both announcement bar and drop section share one single timer mechanism
   - Validates missing or invalid configurations without inventing fake dates
   - When campaign is unconfigured or expired, enters safe terminal state
   - UMD module (runs in browser and Node.js unit tests)
   ========================================================= */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CHIPAKK_COUNTDOWN = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var timerInterval = null;
  var listeners = [];
  var configuredTarget = null; // Stored epoch ms

  function parseTimestamp(val) {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "number") {
      return isNaN(val) || val <= 0 ? null : Math.floor(val);
    }
    if (typeof val === "string") {
      var s = val.trim();
      if (!s) return null;
      var num = Number(s);
      if (!isNaN(num) && num > 1000000000) return Math.floor(num);
      var d = new Date(s);
      var t = d.getTime();
      return isNaN(t) || t <= 0 ? null : t;
    }
    if (val instanceof Date) {
      var dt = val.getTime();
      return isNaN(dt) || dt <= 0 ? null : dt;
    }
    return null;
  }

  function setTarget(ts) {
    configuredTarget = parseTimestamp(ts);
    notify();
  }

  function getTarget() {
    if (configuredTarget !== null) return configuredTarget;
    // Check global runtime configuration if set by store owner
    if (typeof window !== "undefined") {
      if (window.CHIPAKK_SALE_END) {
        var parsed = parseTimestamp(window.CHIPAKK_SALE_END);
        if (parsed !== null) return parsed;
      }
      if (window.CHIPAKK_DATA && window.CHIPAKK_DATA.campaign && window.CHIPAKK_DATA.campaign.targetTimestamp) {
        var parsedData = parseTimestamp(window.CHIPAKK_DATA.campaign.targetTimestamp);
        if (parsedData !== null) return parsedData;
      }
      if (window.CHIPAKK_DATA && window.CHIPAKK_DATA.settings && window.CHIPAKK_DATA.settings.saleEndTime) {
        var parsedSettings = parseTimestamp(window.CHIPAKK_DATA.settings.saleEndTime);
        if (parsedSettings !== null) return parsedSettings;
      }
    }
    return null;
  }

  function getTimeRemaining(nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var target = getTarget();

    if (target === null) {
      return {
        total: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: false,
        isValid: false,
        formatted: "--:--:--:--"
      };
    }

    var diff = target - now;

    if (diff <= 0) {
      return {
        total: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: true,
        isValid: true,
        formatted: "00d 00h 00m 00s"
      };
    }

    var totalSeconds = Math.floor(diff / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    var pad = function (n) { return String(n).padStart(2, "0"); };
    var formatted = pad(days) + "d " + pad(hours) + "h " + pad(minutes) + "m " + pad(seconds) + "s";

    return {
      total: diff,
      days: days,
      hours: hours,
      minutes: minutes,
      seconds: seconds,
      isExpired: false,
      isValid: true,
      formatted: formatted
    };
  }

  function notify() {
    var state = getTimeRemaining();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](state);
      } catch (err) {
        if (typeof console !== "undefined" && console.error) {
          console.error("[CHIPAKK_COUNTDOWN] Listener error:", err);
        }
      }
    }
    if (state.isValid && state.isExpired && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function start() {
    if (timerInterval) return;
    notify();
    timerInterval = setInterval(notify, 1000);
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) notify();
      });
    }
  }

  function stop() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function subscribe(fn) {
    if (typeof fn === "function") {
      listeners.push(fn);
      fn(getTimeRemaining());
    }
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function reset() {
    stop();
    configuredTarget = null;
    listeners = [];
  }

  return {
    parseTimestamp: parseTimestamp,
    setTarget: setTarget,
    getTarget: getTarget,
    getTimeRemaining: getTimeRemaining,
    start: start,
    stop: stop,
    subscribe: subscribe,
    notify: notify,
    reset: reset
  };
});
