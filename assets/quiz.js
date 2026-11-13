// The website quiz on /tools/. Five questions, one at a time, pick one of four guides (PDFs in /resources/).
// With email switched on (data-sitekey set), a last screen asks where to send it, and the answers and email go
// to our alerts Worker, which checks Cloudflare Turnstile, emails them the guide and emails us their answers.
// The download link shows on the page either way. The questions and the choice match
// alerts-worker/src/quiz.ts; change both together.
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
    { q: "Who looks after your site today?", a: ["Nobody", "Me, when I have time", "A developer or agency", "Not sure"] },
    { q: "When do you want this sorted?", a: ["ASAP", "In the next month or two", "Just exploring"] }
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

  var form = root.querySelector("form"), stage = form.querySelector(".quiz-stage"), send = form.querySelector(".quiz-send");
  var count = form.querySelector(".quiz-count"), bar = form.querySelector(".quiz-bar span"), back = form.querySelector(".quiz-back");
  var btn = send.querySelector('button[type="submit"]'), error = send.querySelector(".tool-error");
  var result = root.querySelector(".quiz-result");
  // Without a Turnstile site key, emailing is off: the quiz shows the guide right after the last question.
  var emailing = !!(sitekey && endpoint);
  var answers = QUESTIONS.map(function () { return null; });

  var steps = QUESTIONS.map(function (item, i) {
    var step = document.createElement("div");
    step.className = "quiz-step";
    step.hidden = true;
    var h = document.createElement("h3");
    h.tabIndex = -1;
    h.id = "quiz-q" + i;
    h.textContent = item.q;
    var list = document.createElement("div");
    list.className = "quiz-answers";
    list.setAttribute("role", "group");
    list.setAttribute("aria-labelledby", h.id);
    item.a.forEach(function (answer, j) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "quiz-answer";
      b.textContent = answer;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { choose(i, j); });
      list.appendChild(b);
    });
    step.appendChild(h);
    step.appendChild(list);
    stage.appendChild(step);
    return step;
  });
  if (emailing) steps.push(send);

  var current = -1;
  function show(n, direction) {
    if (current >= 0) steps[current].hidden = true;
    current = n;
    var step = steps[n];
    step.hidden = false;
    step.classList.remove("from-left", "from-right");
    if (direction) { void step.offsetWidth; step.classList.add(direction > 0 ? "from-right" : "from-left"); }
    var last = n >= QUESTIONS.length;
    count.textContent = last ? "Last step" : "Question " + (n + 1) + " of " + QUESTIONS.length;
    bar.style.width = ((last ? QUESTIONS.length : n) / QUESTIONS.length * 100) + "%";
    back.hidden = n === 0;
    if (direction) (last ? form.elements.email : step.querySelector("h3")).focus({ preventScroll: true });
  }

  var advancing = false;
  function choose(i, j) {
    if (advancing) return; // a double tap mustn't skip the next question
    advancing = true;
    answers[i] = j;
    steps[i].querySelectorAll(".quiz-answer").forEach(function (b, k) { b.setAttribute("aria-pressed", k === j ? "true" : "false"); });
    loadTurnstile();
    // A short pause so the tap registers visually before the next question slides in.
    setTimeout(function () {
      advancing = false;
      if (i + 1 < QUESTIONS.length) show(i + 1, 1);
      else if (emailing) show(QUESTIONS.length, 1);
      else showResult(pickGuide(answers), "");
    }, 180);
  }
  back.addEventListener("click", function () { if (current > 0) show(current - 1, -1); });

  var widget = null, pending = false;
  function loadTurnstile() {
    if (!emailing || widget !== null || document.getElementById("cf-turnstile-api")) return;
    window.onQuizTurnstile = function () {
      widget = window.turnstile.render(send.querySelector(".quiz-turnstile"), {
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

  function fail(text) { error.textContent = text; btn.disabled = false; }

  function showResult(guide, note) {
    result.querySelector(".quiz-title").textContent = GUIDES[guide];
    result.querySelector(".quiz-download").href = "/resources/" + guide + ".pdf";
    result.querySelector(".quiz-note").textContent = note;
    var tool = guide === "custom-tools", offer = result.querySelector(".quiz-offer");
    offer.href = tool ? "/?offer=tool#contact" : "/#contact";
    offer.textContent = tool ? "Get my free call" : "Get my free review";
    result.querySelector(".quiz-offer-text").textContent = tool
      ? "Want to talk it through? Book a free 20-minute call and we'll tell you honestly whether a custom tool is worth it. No obligation."
      : "Want a hand? Book a free 20-minute review and we'll walk you through the 3 fixes that would get you more calls. No obligation.";
    form.hidden = true;
    result.hidden = false;
    result.focus();
  }

  function submit() {
    error.textContent = "";
    var guide = pickGuide(answers);
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
      body: JSON.stringify({ answers: answers, email: email, name: form.elements.name.value.trim(),
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

  form.addEventListener("submit", function (e) { e.preventDefault(); if (current === QUESTIONS.length) submit(); });
  show(0, 0);
})();
