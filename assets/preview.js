// Search preview tool: draws a Google-style result from the title and description the visitor types, with
// length warnings. Typing never leaves the browser. "Load" asks our check Worker for a page's title and
// description (rule-based, nothing stored). Text is always set with textContent.
(function () {
  var script = document.currentScript;
  var endpoint = script.dataset.endpoint;
  var $ = function (id) { return document.getElementById(id); };
  var title = $("pv-title"), desc = $("pv-desc"), site = $("pv-site");
  if (!title) return;

  // Rough desktop limits: Google trims titles at about 600px of 20px Arial, and descriptions at about 920px of 14px Arial.
  var TITLE_PX = 600, DESC_PX = 920, DESC_PX_MOBILE = 680;
  var ctx = document.createElement("canvas").getContext("2d");
  function px(text, size) { ctx.font = size + "px Arial, Helvetica, sans-serif"; return Math.round(ctx.measureText(text).width); }
  function cut(text, size, max) {
    if (px(text, size) <= max) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (px(text.slice(0, mid) + " ...", size) <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).replace(/\s+\S*$/, "") + " ...";
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function parts() {
    var raw = site.value.trim() || "https://yourbusiness.com/";
    var host = "yourbusiness.com", crumbs = [];
    try {
      var u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
      host = u.hostname.replace(/^www\./, "");
      crumbs = u.pathname.split("/").filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    } catch (e) { /* keep the placeholder */ }
    var name = host.split(".")[0];
    return { host: host, url: ["https://" + host].concat(crumbs).join(" › "), name: name.charAt(0).toUpperCase() + name.slice(1) };
  }

  function card(box, mobile) {
    var t = title.value.replace(/\s+/g, " ").trim(), d = desc.value.replace(/\s+/g, " ").trim(), p = parts();
    box.textContent = "";
    var head = el("div", "serp-site");
    head.appendChild(el("span", "serp-icon", p.name.charAt(0) || "?"));
    var names = el("div");
    names.appendChild(el("div", "serp-name", p.name));
    names.appendChild(el("div", "serp-url", p.url));
    head.appendChild(names);
    box.appendChild(head);
    var h = el("p", "serp-title" + (t ? "" : " serp-empty"), t ? (mobile ? t : cut(t, 20, TITLE_PX)) : "Your page title");
    box.appendChild(h);
    box.appendChild(el("p", "serp-desc" + (d ? "" : " serp-empty"), d ? (mobile ? d : cut(d, 14, DESC_PX)) : "Without a description, Google picks some text from your page."));
  }

  function update() {
    var t = title.value.replace(/\s+/g, " ").trim(), d = desc.value.replace(/\s+/g, " ").trim();
    var tpx = px(t, 20), dpx = px(d, 14);
    $("pv-title-count").innerHTML = "";
    $("pv-title-count").append(el("b", null, t.length + " characters"), " · about " + tpx + " of " + TITLE_PX + " pixels");
    $("pv-desc-count").innerHTML = "";
    $("pv-desc-count").append(el("b", null, d.length + " characters"), " · about " + dpx + " of " + DESC_PX + " pixels");

    var w = [];
    if (!t) w.push(["warn", "Add a title. It's the biggest, clickable line in the result."]);
    else if (tpx > TITLE_PX) w.push(["warn", "Your title is likely to be cut off on desktop. Shorten it or move the important words to the front."]);
    else if (t.length < 30) w.push(["warn", "Your title is short. Say what you do and where, plus your business name."]);
    if (!d) w.push(["warn", "Add a description, or Google will pick some text from the page for you."]);
    else if (dpx > DESC_PX) w.push(["warn", "Your description is likely to be cut off on desktop. Aim for about 120 to 160 characters."]);
    else if (d.length < 70) w.push(["warn", "Your description is short. Give searchers a reason to choose you."]);
    else if (dpx > DESC_PX_MOBILE) w.push(["warn", "Your description fits on desktop, but phones may cut off the end."]);
    if (t && d && t.toLowerCase() === d.toLowerCase()) w.push(["warn", "Your title and description are the same. Use the description to add something new."]);
    if (t && d && !w.length) w.push(["ok", "Both look a good length. Nothing should get cut off on desktop."]);
    var list = $("pv-warnings");
    list.textContent = "";
    w.forEach(function (x) { list.appendChild(el("li", x[0], x[1])); });

    card($("pv-desktop"), false);
    card($("pv-mobile"), true);
  }

  [title, desc, site].forEach(function (i) { i.addEventListener("input", update); });
  update();

  // Load the title and description from a live page.
  var form = $("pv-load"), url = $("pv-url"), btn = $("pv-load-btn"), err = $("pv-error");
  var label = btn.textContent;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    if (!url.value.trim()) { err.textContent = "Enter a page address to load from."; url.focus(); return; }
    if (!endpoint) { err.textContent = "Loading pages isn't available right now. You can still type them in."; return; }
    btn.disabled = true;
    btn.textContent = "Loading…";
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.value.trim() }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) { err.textContent = res.data.message || "That page couldn't be loaded."; return; }
        title.value = res.data.title || "";
        desc.value = res.data.description || "";
        site.value = res.data.finalUrl || "";
        update();
        if (!res.data.title && !res.data.description) err.textContent = "That page has no title or meta description yet. Try writing them here.";
        title.focus();
      })
      .catch(function () { err.textContent = "We couldn't reach the tool. Please check your connection and try again."; })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
