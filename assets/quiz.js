// The website quiz on /tools/. Four questions pick one of four guides (PDFs in /resources/). With email
// switched on (data-sitekey set), the visitor's answers and email go to our alerts Worker, which checks
// Cloudflare Turnstile, emails them the guide and emails us their answers. The download link shows on the
// page either way. The questions and the choice match alerts-worker/src/quiz.ts; change both together.
(function () {
  var script = document.currentScript;
  var endpoint = script.dataset.endpoint, sitekey = script.dataset.sitekey;
  var root = document.getElementById("quiz");
  if (!root) return;

  var QUESTIONS = [
    { q: "Do you have a website now?", a: ["No", "Yes, but it's old or I don't like it", "Yes, and it works fine"] },
    { q: "What's the biggest problem?", a: ["People can't find us on Google or in AI answers", "People visit but don't call",
      "Nobody keeps the site updated", "We do too much admin by hand"] },
    { q: "What should your site mainly do?", a: ["Show off our work", "Get calls and bookings", "Sell products", "Help run the business"] },
    { q: "Who looks after your site today?", a: ["Nobody", "Me, when I have time", "A developer or agency", "Not sure"] }
  ];
  var GUIDES = {
    "get-found": "Get found on Google and in AI answers",
    "more-calls": "A website that turns visitors into calls",
    "site-health": "Keep your website healthy",
    "custom-tools": "Stop doing it by hand"
  };
  // No website yet means starting with the site itself; otherwise the biggest problem decides.
  function pickGuide(answers) {
    if (answers[0] === 0) return "more-calls";
    return ["get-found", "more-calls", "site-health", "custom-tools"][answers[1]];
  }

  var form = root.querySelector("form"), questions = form.querySelector(".quiz-questions");
  var send = form.querySelector(".quiz-send"), btn = form.querySelector('button[type="submit"]');
  var error = form.querySelector(".tool-error"), result = root.querySelector(".quiz-result");

  QUESTIONS.forEach(function (item, i) {
    var fs = document.createElement("fieldset");
    fs.className = "quiz-q";
    var legend = document.createElement("legend");
    legend.textContent = (i + 1) + ". " + item.q;
    fs.appendChild(legend);
    item.a.forEach(function (answer, j) {
      var label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
      input.type = "radio"; input.name = "q" + i; input.value = j;
      span.textContent = answer;
      label.appendChild(input); label.appendChild(span);
      fs.appendChild(label);
    });
    questions.appendChild(fs);
  });

  // Without a Turnstile site key, emailing is off: the quiz just shows the guide to download.
  var emailing = !!(sitekey && endpoint);
  if (!emailing) { send.hidden = true; btn.firstChild.nodeValue = "Show my guide "; }

  var widget = null, pending = false;
  function loadTurnstile() {
    if (!emailing || widget !== null || document.getElementById("cf-turnstile-api")) return;
    window.onQuizTurnstile = function () {
      widget = window.turnstile.render(form.querySelector(".quiz-turnstile"), {
        sitekey: sitekey, action: "quiz", appearance: "interaction-only",
        callback: function () { if (pending) { pending = false; submit(); } },
        "error-callback": function () { fail("We couldn't confirm you're not a bot. Please refresh the page and try again."); }
      });
    };
    var s = document.createElement("script");
    s.id = "cf-turnstile-api";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onQuizTurnstile";
    s.async = true;
    document.head.appendChild(s);
  }
  form.addEventListener("focusin", loadTurnstile);
  form.addEventListener("change", loadTurnstile);

  function answers() {
    return QUESTIONS.map(function (_, i) {
      var picked = form.querySelector('input[name="q' + i + '"]:checked');
      return picked ? Number(picked.value) : null;
    });
  }
  function fail(text) { error.textContent = text; btn.disabled = false; }

  function showResult(guide, note) {
    result.querySelector(".quiz-title").textContent = GUIDES[guide];
    var link = result.querySelector(".quiz-download");
    link.href = "/resources/" + guide + ".pdf";
    result.querySelector(".quiz-note").textContent = note;
    var tool = guide === "custom-tools";
    result.querySelector(".quiz-offer").href = tool ? "/?offer=tool#contact" : "/#contact";
    result.querySelector(".quiz-offer-text").textContent = tool
      ? "Want to talk it through? Book a free 20-minute call and we'll tell you honestly whether a custom tool is worth it. No obligation."
      : "Want a hand? Book a free 20-minute review and we'll walk you through the 3 fixes that would get you more calls. No obligation.";
    result.querySelector(".quiz-offer").textContent = tool ? "Get my free call" : "Get my free review";
    form.hidden = true;
    result.hidden = false;
    result.focus();
  }

  function submit() {
    error.textContent = "";
    var a = answers();
    var missing = a.indexOf(null);
    if (missing !== -1) { fail("Please answer question " + (missing + 1) + "."); return; }
    var guide = pickGuide(a);
    if (!emailing) { showResult(guide, ""); return; }

    var email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { fail("Please enter a valid email address."); form.elements.email.focus(); return; }
    // Honeypot: real visitors never see or tick this box. Show the guide without sending anything.
    if (form.elements.botcheck.checked) { showResult(guide, ""); return; }

    btn.disabled = true;
    var token = widget !== null ? window.turnstile.getResponse(widget) : "";
    if (!token) { pending = true; loadTurnstile(); error.textContent = "One moment…"; return; }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: a, email: email, name: form.elements.name.value.trim(),
                             newsletter: form.elements.newsletter.checked, turnstile: token })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        showResult(guide, d.ok ? "We've also emailed it to " + email + "."
          : d.reason === "duplicate" ? "We already emailed you a guide today, so we haven't sent this one. You can download it here."
          : "We couldn't email it just now, but you can download it here.");
      })
      .catch(function () { showResult(guide, "We couldn't email it just now, but you can download it here."); });
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
})();
