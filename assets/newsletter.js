// Newsletter signup boxes (footer and tool pages). The signup is emailed to Avello Labs through Web3Forms,
// which is the main path, then a Telegram alert is requested from our alerts Worker in the background with a
// signed ticket. The ticket is fetched when someone starts filling in the form, not on every page view.
(function () {
  var script = document.currentScript;
  var ticketUrl = script.dataset.ticket, alertsUrl = script.dataset.alerts, formsKey = script.dataset.web3forms;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var EMAIL = "harris@avellolabs.com";

  document.querySelectorAll("form.nl-form").forEach(function (form) {
    var status = form.querySelector(".form-status"), btn = form.querySelector('button[type="submit"]');
    var consentText = form.querySelector(".nl-consent span").textContent;
    var ticket = null, asked = false;

    function getTicket() {
      if (asked || !ticketUrl) return;
      asked = true;
      fetch(ticketUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { ticket = d.ticket || null; })
        .catch(function () { /* alerts are best effort; the email still goes through */ });
    }
    form.addEventListener("focusin", getTicket);

    function show(kind, text) {
      status.className = "form-status " + kind;
      status.textContent = text;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim(), email = form.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { show("bad", "Please enter a valid email address."); form.elements.email.focus(); return; }
      if (!form.elements.consent.checked) { show("bad", "Please tick the box to confirm you'd like the newsletter."); form.elements.consent.focus(); return; }
      if (form.elements.botcheck.checked) { form.reset(); show("ok", "Thanks, you're signed up."); return; }

      btn.disabled = true;
      show("", "Signing you up…");
      var data = {
        access_key: formsKey,
        subject: (local ? "[TEST from localhost] " : "") + "New newsletter signup",
        from_name: "Avello Labs website",
        name: name || "Not given",
        email: email,
        page: location.pathname,
        consent: "Yes. They ticked: " + consentText,
        consent_time: new Date().toISOString(),
        source: "newsletter signup"
      };
      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json().then(function (d) { return r.ok && d.success; }); })
        .catch(function () { return false; })
        .then(function (ok) {
          if (ticket && alertsUrl) {
            try {
              fetch(alertsUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket: ticket, name: name, email: email, page: location.pathname, consent: true, emailSent: ok }),
                keepalive: true
              }).catch(function () {});
            } catch (err) { /* alerts are best effort */ }
            ticket = null;
            asked = false;
          }
          if (ok) {
            form.reset();
            show("ok", "Thanks, you're signed up. Look out for our first email.");
          } else {
            show("bad", "Sorry, that didn't go through. Please try again, or email " + EMAIL + ".");
          }
          btn.disabled = false;
        });
    });
  });
})();
