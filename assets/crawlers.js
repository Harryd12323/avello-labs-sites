// AI crawler check: sends a site address to our check Worker, which reads that site's robots.txt and
// says which AI and search bots are allowed in. Rule-based, nothing stored. Text is set with textContent.
(function () {
  var script = document.currentScript;
  var endpoint = script.dataset.endpoint;
  var form = document.getElementById("cr-form");
  if (!form || !endpoint) return;
  var input = document.getElementById("cr-url"), btn = document.getElementById("cr-btn"), err = document.getElementById("cr-error"),
      status = document.getElementById("cr-status"), results = document.getElementById("cr-results");
  var label = btn.textContent;

  var GROUPS = [
    ["ai-search", "AI search and answers", "These find pages to show in AI answers. Blocking them makes it much less likely you'll be recommended."],
    ["user", "Visits when someone asks", "These fetch a page when a person asks an AI tool about it."],
    ["search", "Search engines", "Classic search crawlers. Google's and Bing's also feed AI Overviews and Copilot."],
    ["training", "AI training", "These collect pages that may be used to train AI models. Blocking them is a fair choice and doesn't keep you out of AI search."],
    ["token", "AI training opt-outs", "Not bots. These tokens tell Google and Apple whether your pages can be used for AI training."]
  ];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function headline(d) {
    var s = d.summary;
    if (d.status === "unreachable") return ["We couldn't load your robots.txt.",
      "When robots.txt fails to load, many crawlers treat the whole site as blocked until it works again. Check that yourbusiness.com/robots.txt opens in a browser."];
    if (d.status === "missing") return ["No robots.txt, so every bot is allowed in.",
      "That's fine for most small businesses. Adding a robots.txt that points to your sitemap is still a good idea."];
    var blocked = s.aiSearch.total - s.aiSearch.allowed;
    if (blocked > 0) return [blocked + " of " + s.aiSearch.total + " AI search bots are blocked.",
      "That can keep your business out of AI answers. See how to fix it below."];
    var trainingBlocked = s.training.total - s.training.allowed;
    return ["AI search bots can reach your site.",
      trainingBlocked ? "You're blocking " + trainingBlocked + " of " + s.training.total + " training bots, which is a fair choice and doesn't affect AI search." :
                        "Training bots are allowed too. You can block those without hurting AI search, if you'd rather they didn't use your pages."];
  }

  function render(d) {
    results.textContent = "";
    var sum = el("div", "cr-summary");
    var hl = headline(d);
    var h = el("h2", null, hl[0]);
    h.id = "cr-results-h";
    h.tabIndex = -1;
    sum.appendChild(h);
    sum.appendChild(el("p", null, hl[1]));
    var meta = el("p", "cr-meta");
    meta.appendChild(document.createTextNode("Read: "));
    var a = el("a", null, d.finalRobotsUrl);
    a.href = d.finalRobotsUrl;
    a.rel = "noopener nofollow";
    meta.appendChild(a);
    meta.appendChild(document.createTextNode(" · checked for the page " + d.path + " · bot list last reviewed " + d.reviewed));
    sum.appendChild(meta);
    results.appendChild(sum);

    GROUPS.forEach(function (g) {
      var bots = d.bots.filter(function (b) { return b.category === g[0]; });
      if (!bots.length) return;
      var sec = el("section", "cr-group");
      sec.appendChild(el("h3", null, g[1]));
      sec.appendChild(el("p", null, g[2]));
      var list = el("ul", "cr-list");
      bots.forEach(function (b) {
        var li = el("li", "cr-bot " + (b.allowed ? "allowed" : "blocked"));
        li.appendChild(el("span", "cr-pill " + (b.allowed ? "allowed" : "blocked"), b.allowed ? "✓ Allowed" : "✕ Blocked"));
        var name = el("div", "cr-name");
        name.appendChild(el("code", null, b.token));
        name.appendChild(el("span", null, b.company));
        li.appendChild(name);
        var body = el("div");
        body.appendChild(el("p", "cr-what", b.what));
        var rule = el("p", "cr-rule");
        if (b.rule) {
          rule.appendChild(document.createTextNode("Matched "));
          rule.appendChild(el("code", null, b.rule));
          if (b.group) rule.appendChild(document.createTextNode(" in the " + (b.group === "*" ? "\"*\" (all bots)" : b.group) + " section. "));
          else rule.appendChild(document.createTextNode(". "));
        } else {
          rule.appendChild(document.createTextNode(d.status === "found" ? "No rule applies, so it's allowed. " : ""));
        }
        var docs = el("a", null, "Docs");
        docs.href = b.docs;
        docs.rel = "noopener";
        rule.appendChild(docs);
        body.appendChild(rule);
        li.appendChild(body);
        list.appendChild(li);
      });
      sec.appendChild(list);
      results.appendChild(sec);
    });
    results.hidden = false;
    h.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    var url = input.value.trim();
    if (!url) { err.textContent = "Please enter your website's address."; input.focus(); return; }
    btn.disabled = true;
    btn.textContent = "Checking…";
    status.className = "tool-status busy";
    status.textContent = "Reading your robots.txt…";
    results.hidden = true;
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok && res.data.bots) render(res.data);
        else err.textContent = res.data.message || "Something went wrong. Please try again.";
      })
      .catch(function () { err.textContent = "We couldn't reach the checker. Please check your connection and try again."; })
      .then(function () { status.textContent = ""; status.className = "tool-status"; btn.disabled = false; btn.textContent = label; });
  });
})();
