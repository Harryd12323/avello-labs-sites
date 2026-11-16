// Problem pages (built by scripts/site.py problems) and the homepage's welcome video.
// Videos: a thumbnail with a play button; YouTube's no-cookie player only loads when someone presses play.
// Free guide form: checks Cloudflare Turnstile, then our alerts Worker emails the guide (POST /guide). The
// download link shows on the page whatever happens with the email.
(function () {
  var script = document.currentScript;
  var endpoint = script && script.dataset.endpoint, sitekey = script && script.dataset.sitekey;

  // Video spots (no video yet) stay hidden, except in a preview opened with ?spots.
  if (/[?&]spots\b/.test(location.search)) {
    document.querySelectorAll(".video-spot").forEach(function (el) { el.hidden = false; });
  }

  document.querySelectorAll(".video-facade").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var frame = document.createElement("iframe");
      frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(btn.dataset.video) + "?autoplay=1&rel=0";
      frame.title = btn.getAttribute("aria-label").replace(/^Play the video: /, "");
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.className = "video-frame";
      btn.replaceWith(frame);
      frame.focus();
    });
  });

  var form = document.querySelector(".guide-form");
  if (!form) return;
  var box = form.closest(".guide-box"), done = box.querySelector(".guide-done"), note = box.querySelector(".guide-note");
  var btn = form.querySelector('button[type="submit"]'), error = form.querySelector(".tool-error");
  var emailing = !!(endpoint && sitekey);
  var widget = null, pending = false;

  function loadTurnstile() {
    if (!emailing || widget !== null || document.getElementById("cf-turnstile-api")) return;
    window.onGuideTurnstile = function () {
      widget = window.turnstile.render(form.querySelector(".guide-turnstile"), {
        sitekey: sitekey, action: "guide", appearance: "interaction-only",
        callback: function () { if (pending) { pending = false; submit(); } },
        "error-callback": function () { fail("We couldn't confirm you're not a bot. Please refresh the page and try again."); }
      });
    };
    var s = document.createElement("script");
    s.id = "cf-turnstile-api";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onGuideTurnstile";
    s.async = true;
    document.head.appendChild(s);
  }
  // Load the bot check as soon as they start on the form, so it's ready by the time they press the button.
  form.addEventListener("focusin", loadTurnstile, { once: true });

  function fail(text) { error.textContent = text; btn.disabled = false; }
  function finish(text) {
    note.textContent = text;
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }

  function submit() {
    error.textContent = "";
    var email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { fail("Please enter a valid email address."); form.elements.email.focus(); return; }
    // Honeypot: real visitors never see or tick this box. Show the download without sending anything.
    if (form.elements.botcheck.checked || !emailing) { finish(emailing ? "" : "Here's your guide."); return; }

    btn.disabled = true;
    var token = widget !== null ? window.turnstile.getResponse(widget) : "";
    if (!token) { pending = true; loadTurnstile(); error.textContent = "One moment…"; return; }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: form.dataset.guide, page: form.dataset.page, email: email, name: form.elements.name.value.trim(),
                             newsletter: form.elements.newsletter.checked, tips: form.elements.tips.checked, turnstile: token })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        finish(d.ok ? "Sent! Check your inbox for an email from Avello Labs. You can also download it here."
          : d.reason === "duplicate" ? "We already emailed you this guide today. You can download it here."
          : "We couldn't email it just now, but you can download it here.");
      })
      .catch(function () { finish("We couldn't email it just now, but you can download it here."); });
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
})();
