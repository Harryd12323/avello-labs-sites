// Avello Labs free website check: sends the visitor's URL to our check Worker (check-worker/), shows the
// score and fixes, and, if they ask for the full report, sends a lead to us through Web3Forms.
// No AI, no tracking, no third-party scripts. Message text is always set with textContent.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var endpoint = (local && script.dataset.devEndpoint) || script.dataset.endpoint;
  var formsKey = script.dataset.web3forms;
  var alertsUrl = script.dataset.alerts;
  var form = document.getElementById("check-form");
  if (!form || !endpoint) return;

  var input = document.getElementById("check-url"), btn = document.getElementById("check-btn"),
      errorBox = document.getElementById("check-error"), status = document.getElementById("check-status"),
      results = document.getElementById("check-results");
  var btnLabel = btn.innerHTML;
  var last = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var ICON = { pass: "✓", warn: "!", fail: "✕", unknown: "?" };
  var WORD = { pass: "Passed", warn: "Could be better", fail: "Needs fixing", unknown: "Couldn't check" };
  var ORDER = { fail: 0, warn: 1, unknown: 2, pass: 3 };

  function verdict(score) {
    if (score >= 90) return "Great shape. Just a few details to polish.";
    if (score >= 70) return "A solid base, with a few fixes that would help.";
    if (score >= 50) return "Some important basics need attention.";
    return "Lots of quick wins available.";
  }

  function ring(score) {
    var r = 52, c = 2 * Math.PI * r, ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("class", "check-ring");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<defs><linearGradient id="check-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4D74F2"/><stop offset=".55" stop-color="#62AFF9"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>' +
      '<circle cx="60" cy="60" r="' + r + '" class="track"/>' +
      '<circle cx="60" cy="60" r="' + r + '" class="value" stroke-dasharray="' + (c * score / 100).toFixed(1) + " " + c.toFixed(1) + '"/>' +
      '<text x="60" y="66" text-anchor="middle" class="num">' + score + "</text>";
    return svg;
  }

  function render(data) {
    last = data;
    results.textContent = "";
    var head = el("div", "check-summary");
    head.appendChild(ring(data.score));
    var sum = el("div", "check-summary-text");
    var h = el("h2", null, "Your score: " + data.score + " out of 100");
    h.id = "results-h";
    h.tabIndex = -1;
    sum.appendChild(h);
    sum.appendChild(el("p", "check-verdict", verdict(data.score)));
    var checked = el("p", "check-url");
    checked.appendChild(document.createTextNode("Checked: "));
    checked.appendChild(el("span", null, data.finalUrl));
    sum.appendChild(checked);
    var counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
    data.checks.forEach(function (c) { counts[c.status]++; });
    var pills = el("p", "check-counts");
    [["fail", counts.fail + " to fix"], ["warn", counts.warn + " to improve"], ["pass", counts.pass + " passed"]].forEach(function (p) {
      pills.appendChild(el("span", "check-pill " + p[0], p[1]));
    });
    sum.appendChild(pills);
    head.appendChild(sum);
    results.appendChild(head);

    (data.notes || []).forEach(function (n) { results.appendChild(el("p", "check-note", n)); });

    var list = el("ol", "check-list");
    data.checks.slice().sort(function (a, b) { return ORDER[a.status] - ORDER[b.status]; }).forEach(function (c) {
      var li = el("li", "check-item " + c.status);
      var icon = el("span", "check-icon", ICON[c.status]);
      icon.setAttribute("aria-hidden", "true");
      li.appendChild(icon);
      var body = el("div", "check-body");
      var top = el("p", "check-top");
      top.appendChild(el("strong", null, c.label));
      top.appendChild(el("span", "check-word", WORD[c.status] + (c.status === "unknown" ? "" : " · " + c.points + "/" + c.max)));
      body.appendChild(top);
      body.appendChild(el("p", "check-detail", c.detail));
      if (c.fix) {
        var fix = el("p", "check-fix");
        fix.appendChild(el("strong", null, "How to fix: "));
        fix.appendChild(document.createTextNode(c.fix));
        body.appendChild(fix);
      }
      li.appendChild(body);
      list.appendChild(li);
    });
    results.appendChild(list);
    results.appendChild(reportForm());
    results.hidden = false;
    h.focus();
  }

  // Optional "Email me the full report" form: a lead to us through Web3Forms, plus a Telegram alert through
  // the alerts Worker. We check the site by hand and email the report ourselves.
  function reportForm() {
    var box = el("div", "check-report");
    box.appendChild(el("h2", null, "Want the full report?"));
    box.appendChild(el("p", null, "Optional. Leave your details and we'll check your site by hand, then email you a full SEO + AEO report within 1 to 2 business days. Free, no obligation."));
    var f = el("form", "check-report-form");
    f.noValidate = true;
    f.innerHTML =
      '<div class="hp" aria-hidden="true"><label for="r-botcheck">Leave this box unticked</label><input type="checkbox" id="r-botcheck" name="botcheck" tabindex="-1" autocomplete="off"></div>' +
      '<div class="grid2">' +
        '<div class="field"><label for="r-name">Your name</label><input id="r-name" name="name" autocomplete="name" maxlength="80" required></div>' +
        '<div class="field"><label for="r-email">Email</label><input id="r-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" required></div>' +
      "</div>" +
      '<div class="field"><label for="r-website">Website</label><input id="r-website" name="website" type="url" inputmode="url" autocomplete="url" maxlength="200" required></div>' +
      '<p class="err" id="r-err"></p>' +
      '<button class="btn" type="submit">Email me the full report</button>' +
      '<p class="form-status" id="r-status" role="status" aria-live="polite"></p>' +
      '<p class="form-note">Your details and this check\'s results are sent to us through Web3Forms. See our <a class="text-link" href="/privacy/#check">privacy policy</a>.</p>';
    f.website.defaultValue = last.finalUrl;
    f.addEventListener("submit", function (e) { e.preventDefault(); sendReport(f); });
    box.appendChild(f);
    return box;
  }

  function sendReport(f) {
    var err = f.querySelector("#r-err"), st = f.querySelector("#r-status"), b = f.querySelector('button[type="submit"]');
    var name = f.name.value.trim(), email = f.email.value.trim(), website = f.website.value.trim();
    err.textContent = !name ? "Please enter your name." : !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? "Please enter a valid email address." :
                      !website ? "Please enter your website's address." : "";
    if (err.textContent) return;
    if (f.botcheck.checked) { st.className = "form-status ok"; st.textContent = "Thanks! We'll email your full report within 1 to 2 business days."; return; }
    // The alert's site and score come from the signed ticket, so a different address typed here goes in the note.
    var otherSite = website.replace(/\/+$/, "") !== last.finalUrl.replace(/\/+$/, "") ? website : "";
    var host = "";
    try { host = new URL(last.finalUrl).hostname; } catch (e) { host = last.finalUrl; }
    var issues = last.checks.filter(function (c) { return c.status !== "pass"; })
      .map(function (c) { return (c.status === "fail" ? "[FIX] " : c.status === "warn" ? "[IMPROVE] " : "[UNKNOWN] ") + c.label + ": " + c.detail; });
    var data = {
      access_key: formsKey,
      subject: (local ? "[TEST from localhost] " : "") + "Free SEO + AEO report request: " + host,
      from_name: "Avello Labs website check",
      name: name,
      email: email,
      website: website,
      website_checked: last.finalUrl,
      score: last.score + "/100",
      issues_found: issues.length ? issues.join("\n") : "None, every check passed",
      source: "via website check"
    };
    b.disabled = true;
    st.className = "form-status";
    st.textContent = "Sending…";
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (d) { return r.ok && d.success; }); })
      .catch(function () { return false; })
      .then(function (ok) {
        // Email is the main path; the Telegram alert goes out in the background either way.
        sendAlert({ ticket: last.ticket, name: name, email: email, business: "",
                    note: otherSite ? "Website given: " + otherSite : "", emailSent: ok });
        if (ok) {
          f.reset();
          st.className = "form-status ok";
          st.textContent = "Thanks, " + name + "! We'll email your full report to " + email + " within 1 to 2 business days.";
        } else {
          st.className = "form-status bad";
          st.textContent = "Sorry, that didn't send. Please try again, or email harris@avellolabs.com.";
        }
        b.disabled = false;
      });
  }

  // Asks our alerts Worker to send us a Telegram alert. Fire-and-forget: it never affects what the
  // visitor sees, and it only works with the signed ticket the check Worker issued for this result.
  function sendAlert(payload) {
    if (!alertsUrl || !payload.ticket) return;
    try {
      fetch(alertsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true })
        .catch(function () {});
    } catch (e) { /* alerts are best effort */ }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = input.value.trim();
    errorBox.textContent = "";
    if (!url) { errorBox.textContent = "Please enter your website's address."; input.focus(); return; }
    btn.disabled = true;
    btn.textContent = "Checking…";
    status.className = "check-status busy";
    status.textContent = "Checking your site. This usually takes 5 to 15 seconds.";
    results.hidden = true;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
      signal: ctrl.signal
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        status.textContent = "";
        status.className = "check-status";
        if (res.ok && typeof res.data.score === "number") render(res.data);
        else errorBox.textContent = res.data.message || "Something went wrong. Please try again.";
      })
      .catch(function () {
        status.textContent = "";
        status.className = "check-status";
        errorBox.textContent = "We couldn't reach the checker. Please check your connection and try again.";
      })
      .then(function () { clearTimeout(timer); btn.disabled = false; btn.innerHTML = btnLabel; });
  });
})();
