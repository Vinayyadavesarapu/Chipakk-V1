/* =========================================================
   CHIPAKK — Media Module (single source of truth for images)
   js/media.js

   Everything in the storefront that shows a picture goes through
   this module:

     resolve(raw)        -> absolute, safe URL (or "" when raw is not an image ref)
     imgHtml(opts)       -> one canonical <img> markup string
     placeholderHtml()   -> markup shown when there is genuinely no image
     installFallback(d)  -> ONE delegated error handler for every <img data-media>

   Why one module: the previous code resolved image URLs in ~10 places
   with different rules, stored the resolved URL inside the persisted cart,
   and used inline onerror="" strings that differed per page.

   UMD: works in the browser (window.CHIPAKK_MEDIA) and in Node (tests).
   ========================================================= */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CHIPAKK_MEDIA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Hosts that are the *storefront*, never the file host. Backend uploads are
  // served by the API origin only, so a "/uploads/..." path on any of these
  // hosts is a mis-resolved URL and is rewritten to the API origin.
  var STOREFRONT_HOSTS = /^(www\.)?chipakk\.shop$|^(www\.)?themarshans\.shop$|^localhost$|^127\.0\.0\.1$/i;
  var IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;
  var SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function apiOriginFrom(apiBase) {
    var base = String(apiBase || "").trim();
    return base.replace(/\/+$/, "").replace(/\/api$/i, "");
  }

  // Collapse duplicate slashes in a *path* (never touches the "://" of a URL).
  // Returns "" when the path tries to traverse upwards (".." segments).
  function cleanPath(p) {
    var out = [];
    var bad = false;
    String(p).split("/").forEach(function (seg) {
      if (seg === "" || seg === ".") return;
      if (seg === ".." || seg.toLowerCase() === "%2e%2e") { bad = true; return; }
      out.push(seg);
    });
    return bad ? "" : "/" + out.join("/");
  }

  function driveToDirect(url) {
    var m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m && m[1] ? "https://drive.google.com/uc?export=view&id=" + m[1] : null;
  }

  /**
   * createMedia({ apiBase }) -> media API bound to one API origin.
   */
  function createMedia(config) {
    config = config || {};
    var apiOrigin = apiOriginFrom(config.apiBase);

    /**
     * Resolve any stored image reference to a URL the browser can request.
     * Returns "" when `raw` is empty, an emoji/text, or unsafe.
     */
    function resolve(raw) {
      if (typeof raw !== "string") return "";
      var s = raw.trim();
      if (!s) return "";

      // Unsafe schemes never become an <img src>
      if (/^\s*(javascript|vbscript|file|about):/i.test(s)) return "";

      // Inline data / blob: only raster previews (custom-sticker preview).
      // Backend-hosted product images are never returned as base64.
      if (/^data:/i.test(s)) return SAFE_DATA_IMAGE.test(s) ? s : "";
      if (/^blob:/i.test(s)) return s;

      // Google Drive share links -> direct view
      if (/drive\.google\.com/i.test(s)) {
        var direct = driveToDirect(s);
        if (direct) return direct;
      }

      // Protocol-relative ("//cdn.example.com/a.png"). A leading "//" followed by a
      // non-hostname ("//uploads//x.webp") is a doubled slash in a path, not a host.
      if (s.indexOf("//") === 0) {
        if (/^\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/|$)/i.test(s) || /^\/\/localhost(:\d+)?(\/|$)/i.test(s)) s = "https:" + s;
        else s = s.replace(/^\/+/, "/");
      }

      // Absolute http(s)
      if (/^https?:\/\//i.test(s)) {
        var u;
        try { u = new URL(s); } catch (e) { return ""; }
        var path = cleanPath(u.pathname || "/");
        if (!path) return "";
        if (/^\/uploads\//i.test(path) && STOREFRONT_HOSTS.test(u.hostname) && apiOrigin) {
          // stale / mis-resolved: uploads live on the API origin only
          return apiOrigin + path + (u.search || "");
        }
        var apiHost = "";
        try { apiHost = new URL(apiOrigin).hostname; } catch (e) { /* no api origin configured */ }
        if (u.protocol === "http:" && apiHost && u.hostname === apiHost) u.protocol = "https:";
        u.pathname = path;
        return u.toString();
      }

      // Site-relative static assets shipped with the storefront
      if (/^\/?assets\//i.test(s)) return s.replace(/^\/+/, "");

      // Backend paths: /uploads/x.webp, uploads/x.webp, ./uploads/x.webp
      var rel = s.split("#")[0];
      var qi = rel.indexOf("?");
      var query = qi >= 0 ? rel.slice(qi) : "";
      var pathOnly = qi >= 0 ? rel.slice(0, qi) : rel;

      var looksLikePath = pathOnly.indexOf("/") >= 0 || IMAGE_EXT.test(pathOnly);
      if (!looksLikePath) return ""; // emoji / plain text such as "⚡"

      var p = cleanPath(pathOnly);
      if (!p) return ""; // traversal attempt
      if (!/^\/uploads\//i.test(p)) {
        // bare filename (product-123.webp) => an upload
        if (pathOnly.indexOf("/") < 0) p = "/uploads" + p;
      }
      if (!apiOrigin) return p.replace(/^\/+/, ""); // no API origin known: keep page-relative
      return apiOrigin + p + query;
    }

    function isImageRef(raw) {
      return resolve(raw) !== "";
    }

    function resolveFirst(list) {
      if (!Array.isArray(list)) return resolve(list);
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var candidate = typeof item === "string" ? item : (item && (item.image_url || item.external_url || item.url || item.src));
        var r = resolve(candidate);
        if (r) return r;
      }
      return "";
    }

    /** The visual shown when a product/category genuinely has no usable image. */
    function placeholderHtml(opts) {
      opts = opts || {};
      var label = opts.alt ? String(opts.alt) : "Image not available";
      return '<span class="img-placeholder' + (opts.cls ? " " + escapeHtml(opts.cls) : "") +
        '" role="img" aria-label="' + escapeHtml(label) + '" data-media-state="placeholder"></span>';
    }

    /**
     * Canonical <img>. `src` may be a raw stored value; it is resolved here.
     * opts: { src, alt, cls, width, height, priority, lazy, sizes, style }
     */
    function imgHtml(opts) {
      opts = opts || {};
      var url = resolve(opts.src);
      if (!url) return placeholderHtml({ alt: opts.alt, cls: opts.cls });
      var a = ['src="' + escapeHtml(url) + '"', 'alt="' + escapeHtml(opts.alt || "") + '"', "data-media"];
      if (opts.cls) a.push('class="' + escapeHtml(opts.cls) + '"');
      if (opts.width) a.push('width="' + parseInt(opts.width, 10) + '"');
      if (opts.height) a.push('height="' + parseInt(opts.height, 10) + '"');
      if (opts.priority) { a.push('loading="eager"'); a.push('fetchpriority="high"'); }
      else if (opts.lazy !== false) a.push('loading="lazy"');
      a.push('decoding="async"');
      if (opts.fallbackSrc) a.push('data-fallback-src="' + escapeHtml(opts.fallbackSrc) + '"');
      if (opts.sizes) a.push('sizes="' + escapeHtml(opts.sizes) + '"');
      if (opts.style) a.push('style="' + escapeHtml(opts.style) + '"');
      return "<img " + a.join(" ") + " />";
    }

    return { apiOrigin: apiOrigin, resolve: resolve, resolveFirst: resolveFirst, isImageRef: isImageRef, imgHtml: imgHtml, placeholderHtml: placeholderHtml };
  }

  /**
   * ONE delegated handler for every <img data-media> on the page.
   * - error events do not bubble, so it listens in the capture phase
   * - each image is replaced at most once (data-failed) => no onerror loop
   * - the replacement is a <span>, which cannot fire another image error
   */
  function installFallback(doc, onFail) {
    if (!doc || doc.__chipakkMediaFallback) return;
    doc.__chipakkMediaFallback = true;
    doc.addEventListener("error", function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-media")) return;
      if (img.getAttribute("data-failed") === "1") return;
      // Optional one-shot alternative (e.g. the bundled hero fallback) before the placeholder.
      var alt = img.getAttribute("data-fallback-src");
      if (alt && img.getAttribute("data-fallback-used") !== "1") {
        img.setAttribute("data-fallback-used", "1");
        img.setAttribute("src", alt);
        return;
      }
      img.setAttribute("data-failed", "1");
      var failedSrc = img.currentSrc || img.getAttribute("src") || "";
      try {
        var ph = doc.createElement("span");
        ph.className = "img-placeholder" + (img.className ? " " + img.className : "");
        ph.setAttribute("role", "img");
        ph.setAttribute("aria-label", img.getAttribute("alt") || "Image not available");
        ph.setAttribute("data-media-state", "placeholder");
        ph.setAttribute("data-failed-src", failedSrc);
        if (img.parentNode) img.parentNode.replaceChild(ph, img);
      } catch (e) { /* element already detached by a re-render */ }
      if (typeof onFail === "function") onFail(failedSrc);
    }, true);
  }

  return { createMedia: createMedia, installFallback: installFallback, escapeHtml: escapeHtml };
});
