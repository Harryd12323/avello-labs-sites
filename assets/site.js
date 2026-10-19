// Avello Labs site script, shared by every page. No tracking, no cookies.
(function () {
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // Mobile menu
  var header = document.querySelector("header.site"), menuBtn = document.getElementById("menu-btn");
  if (header && menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = header.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    header.querySelectorAll(".site-nav a").forEach(function (a) {
      a.addEventListener("click", function () { header.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("open")) {
        header.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); menuBtn.focus();
      }
    });
  }

  // Contact form: sends through Web3Forms, which emails the message to harris@avellolabs.com.
  var form = document.getElementById("contact-form");
  if (form) {
    var btn = document.getElementById("send-btn"), status = document.getElementById("form-status"), btnLabel = btn.innerHTML;
    function show(kind, html) { status.className = "form-status " + kind; status.innerHTML = html; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.name.value.trim(), email = form.email.value.trim(), msg = form.message.value.trim();
      var errs = {
        name: name ? "" : "Please enter your name.",
        email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? "" : "Please enter a valid email address.",
        message: msg ? "" : "Please add a short message."
      };
      Object.keys(errs).forEach(function (k) { document.getElementById("err-" + k).textContent = errs[k]; });
      if (errs.name || errs.email || errs.message) return;

      // Honeypot: real visitors never see or tick this box, so a ticked box means a bot. Pretend it worked.
      if (form.botcheck.checked) { form.reset(); show("ok", "Thanks! Your message is on its way."); return; }

      var key = form.access_key.value.trim();
      if (!key || key.indexOf("YOUR_") === 0) {
        show("bad", 'This form isn\'t switched on yet. Please email <a href="mailto:harris@avellolabs.com">harris@avellolabs.com</a> instead.');
        return;
      }

      btn.disabled = true; btn.textContent = "Sending…"; status.className = "form-status"; status.textContent = "";
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json().then(function (d) { return r.ok && d.success; }); })
        .then(function (ok) {
          if (!ok) throw new Error("not sent");
          form.reset();
          show("ok", "Thanks! Your message is on its way. We'll reply by email soon.");
        })
        .catch(function () {
          show("bad", 'Sorry, your message didn\'t send. Please try again, or email <a href="mailto:harris@avellolabs.com">harris@avellolabs.com</a>.');
        })
        .then(function () { btn.disabled = false; btn.innerHTML = btnLabel; });
    });
  }

  // Concept carousel: native scroll-snap handles touch swipe; arrows and keys step one card at a time.
  var track = document.getElementById("car-track");
  if (track) {
    var prev = document.getElementById("car-prev"), next = document.getElementById("car-next"),
        count = document.getElementById("car-count"), slides = track.querySelectorAll(".slide");
    var step = function () { return slides[0].getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0); };
    var update = function () {
      var max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      count.textContent = Math.min(Math.round(track.scrollLeft / step()) + 1, slides.length) + " of " + slides.length;
    };
    var go = function (dir) { track.scrollBy({ left: dir * step() }); };
    prev.addEventListener("click", function () { go(-1); });
    next.addEventListener("click", function () { go(1); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { e.preventDefault(); track.scrollTo({ left: 0 }); }
      else if (e.key === "End") { e.preventDefault(); track.scrollTo({ left: track.scrollWidth }); }
    });
    track.addEventListener("scroll", function () { requestAnimationFrame(update); }, { passive: true });
    window.addEventListener("resize", update);
    update();

    // Lightbox: loads the full-length shot only when opened, phone or desktop to match the screen.
    var lb = document.getElementById("lightbox"), lbImg = document.getElementById("lb-img"),
        lbTitle = document.querySelector("#lb-title b"), lbScroll = document.getElementById("lb-scroll"),
        phone = window.matchMedia("(max-width: 39.99rem)");
    track.addEventListener("click", function (e) {
      var shot = e.target.closest(".shot");
      if (!shot) return;
      var kind = phone.matches ? "phone" : "desktop";
      lbImg.src = "/work/" + shot.dataset.key + "-" + kind + "-full.webp";
      lbImg.alt = "Full-length " + kind + " screenshot of the " + shot.dataset.kind.toLowerCase() + " concept design";
      lbTitle.textContent = shot.dataset.kind;
      lb.classList.toggle("phone", phone.matches);
      lbScroll.scrollTop = 0;
      lb.showModal();
    });
    document.getElementById("lb-close").addEventListener("click", function () { lb.close(); });
    lb.addEventListener("click", function (e) { if (e.target === lb) lb.close(); });
    lb.addEventListener("close", function () { lbImg.removeAttribute("src"); });
  }
})();
