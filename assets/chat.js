// Avello Labs chat assistant: the chat window. Talks to our Cloudflare Worker (worker/), which talks to
// Claude. The conversation lives only in this browser tab (sessionStorage) and is gone when the tab closes.
// Confirmed leads are sent from the browser through Web3Forms. No tracking, no third-party scripts.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var endpoint = (local && script.dataset.devEndpoint) || script.dataset.endpoint;
  var formsKey = script.dataset.web3forms;
  if (!endpoint) return;

  var MAX_CHARS = 600, MAX_TURNS = 20, STORE = "avello-chat-v1";
  var EMAIL = "harris@avellolabs.com";
  var GREETING = "Hi! I can answer questions about SEO, AEO, website care and custom web apps, or pass a message to Harris. What can I help with?";

  // items: {kind: "user"|"bot"|"notice"|"lead", text, failed, lead, sent}
  var state = load() || { items: [], open: false };

  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode: chat still works, just isn't kept */ }
  }
  function turns() {
    return state.items
      .filter(function (i) { return (i.kind === "user" && !i.failed) || i.kind === "bot"; })
      .map(function (i) { return { role: i.kind === "user" ? "user" : "assistant", content: i.text }; });
  }

  // ---------- Build the widget ----------
  var icon = function (path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  };
  var root = document.createElement("div");
  root.className = "chat";
  root.innerHTML =
    '<button class="chat-launcher" type="button" aria-expanded="false" aria-controls="chat-panel">' +
      icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>') +
      '<span class="chat-launcher-label">Ask us</span></button>' +
    '<section class="chat-panel" id="chat-panel" role="dialog" aria-labelledby="chat-title" hidden>' +
      '<header class="chat-head">' +
        '<div class="chat-title"><h2 id="chat-title">Avello Labs assistant</h2><p>AI answers from our website</p></div>' +
        '<button class="chat-icon-btn" type="button" data-act="clear" aria-label="Clear chat">' + icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>') + "</button>" +
        '<button class="chat-icon-btn" type="button" data-act="close" aria-label="Close chat">' + icon('<path d="M6 6l12 12M18 6L6 18"/>') + "</button>" +
      "</header>" +
      '<div class="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
      '<form class="chat-form" novalidate>' +
        '<label class="sr-only" for="chat-input">Your message</label>' +
        '<textarea id="chat-input" rows="1" maxlength="' + MAX_CHARS + '" placeholder="Ask a question…" autocomplete="off"></textarea>' +
        '<button class="chat-send" type="submit" aria-label="Send message">' + icon('<path d="M5 12h14M13 6l6 6-6 6"/>') + "</button>" +
      "</form>" +
      '<p class="chat-count" aria-live="polite"></p>' +
      '<p class="chat-note">AI assistant. Messages may be reviewed. See <a href="/privacy/#chat">Privacy</a>.</p>' +
    "</section>";
  document.body.appendChild(root);

  var launcher = root.querySelector(".chat-launcher"), panel = root.querySelector(".chat-panel"),
      log = root.querySelector(".chat-log"), form = root.querySelector(".chat-form"),
      input = root.querySelector("#chat-input"), sendBtn = root.querySelector(".chat-send"),
      count = root.querySelector(".chat-count");
  var busy = false;
  var narrow = window.matchMedia("(max-width: 39.99rem)");

  // ---------- Rendering ----------
  // Turns plain text into nodes, linking emails and avellolabs.com addresses. Never uses innerHTML for message text.
  function richText(el, text) {
    var re = /(https:\/\/avellolabs\.com\/[\w\-\/#]*|[\w.+-]+@[\w-]+\.[\w.]+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,]+$/, "");
      el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = url.indexOf("@") > -1 ? "mailto:" + url : url;
      a.textContent = url;
      el.appendChild(a);
      last = m.index + url.length;
    }
    el.appendChild(document.createTextNode(text.slice(last)));
  }

  function bubble(kind, text) {
    var div = document.createElement("div");
    div.className = "chat-msg " + kind;
    var who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = kind === "user" ? "You: " : kind === "bot" ? "Assistant: " : "";
    div.appendChild(who);
    richText(div, text);
    return div;
  }

  // Every lead field, in order, as [label, value]. Website and phone are optional.
  function leadFields(lead) {
    return [
      ["Name", lead.name],
      ["Email", lead.email],
      ["Business", lead.business],
      ["Website", lead.website],
      ["Phone", lead.phone],
      ["Main goal", lead.goal || lead.need]
    ];
  }

  function leadCard(item, index) {
    var card = document.createElement("div");
    card.className = "chat-lead";
    var h = document.createElement("p");
    h.className = "chat-lead-title";
    h.textContent = item.sent ? "Sent to Harris" : "Check your details";
    card.appendChild(h);
    var dl = document.createElement("dl");
    leadFields(item.lead).forEach(function (f) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = f[0];
      dd.textContent = f[1] || "Not given";
      if (!f[1]) dd.className = "chat-empty";
      dl.appendChild(dt); dl.appendChild(dd);
    });
    card.appendChild(dl);
    if (!item.sent) {
      var row = document.createElement("div");
      row.className = "chat-lead-actions";
      var send = document.createElement("button");
      send.type = "button"; send.className = "chat-lead-send"; send.textContent = "Send to Harris";
      send.addEventListener("click", function () { sendLead(index, send); });
      var edit = document.createElement("button");
      edit.type = "button"; edit.className = "chat-lead-edit"; edit.textContent = "Edit details";
      edit.addEventListener("click", function () {
        input.value = "Please change my ";
        input.focus();
        autosize();
      });
      row.appendChild(send); row.appendChild(edit);
      card.appendChild(row);
    }
    return card;
  }

  function render() {
    log.textContent = "";
    log.appendChild(bubble("bot", GREETING));
    state.items.forEach(function (item, i) {
      if (item.kind === "lead") {
        // Only the most recent unsent card stays actionable.
        var newer = state.items.slice(i + 1).some(function (j) { return j.kind === "lead"; });
        if (!newer || item.sent) log.appendChild(leadCard(item, i));
        return;
      }
      var b = bubble(item.kind, item.text);
      if (item.failed) {
        b.classList.add("failed");
        var tag = document.createElement("span");
        tag.className = "chat-failed";
        tag.textContent = " (not sent)";
        b.appendChild(tag);
      }
      log.appendChild(b);
    });
    if (busy) {
      var t = document.createElement("div");
      t.className = "chat-msg bot chat-typing";
      t.innerHTML = '<span class="sr-only">Assistant is typing</span><i></i><i></i><i></i>';
      log.appendChild(t);
    }
    var full = turns().length >= MAX_TURNS;
    input.disabled = busy || full;
    sendBtn.disabled = busy || full;
    if (full) {
      input.placeholder = "This chat is full. Clear it to start again.";
    } else {
      input.placeholder = "Ask a question…";
    }
    log.scrollTop = log.scrollHeight;
  }

  function notice(text) {
    state.items.push({ kind: "notice", text: text });
  }

  // ---------- Talking to the Worker ----------
  function send(text) {
    state.items.push({ kind: "user", text: text });
    busy = true;
    save(); render();
    var userItem = state.items[state.items.length - 1];
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turns() })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
      })
      .then(function (res) {
        if (res.ok && res.data.reply) {
          state.items.push({ kind: "bot", text: res.data.reply });
          if (res.data.lead) state.items.push({ kind: "lead", lead: res.data.lead, sent: false });
        } else {
          userItem.failed = true;
          notice(res.data.reply || "Sorry, something went wrong. You can email " + EMAIL + ".");
        }
      })
      .catch(function () {
        userItem.failed = true;
        notice("I couldn't reach the assistant. Please check your connection, or email " + EMAIL + ".");
      })
      .then(function () {
        busy = false;
        save(); render();
        if (!input.disabled) input.focus();
      });
  }

  function sendLead(index, button) {
    var item = state.items[index];
    button.disabled = true;
    button.textContent = "Sending…";
    var data = {
      access_key: formsKey,
      subject: (local ? "[TEST from localhost] " : "") + "New lead via chat assistant",
      from_name: "Avello Labs website",
      name: item.lead.name,
      email: item.lead.email,
      business: item.lead.business,
      website: item.lead.website || "Not given",
      phone: item.lead.phone || "Not given",
      main_goal: item.lead.goal || item.lead.need,
      source: "via chat assistant"
    };
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (d) { return r.ok && d.success; }); })
      .then(function (ok) {
        if (!ok) throw new Error("not sent");
        item.sent = true;
        notice("Sent! Harris will reply to " + item.lead.email + ".");
      })
      .catch(function () {
        notice("Sorry, that didn't send. Please try again, or email " + EMAIL + " directly.");
      })
      .then(function () { save(); render(); });
  }

  // ---------- Open, close, input ----------
  function setOpen(open, focus) {
    state.open = open;
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    root.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("chat-locked", open && narrow.matches);
    save();
    if (open) {
      render();
      if (focus !== false) input.focus();
    } else if (focus !== false) {
      launcher.focus();
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    var left = MAX_CHARS - input.value.length;
    count.textContent = left <= 100 ? left + " characters left" : "";
  }

  launcher.addEventListener("click", function () { setOpen(!state.open); });
  root.querySelector('[data-act="close"]').addEventListener("click", function () { setOpen(false); });
  root.querySelector('[data-act="clear"]').addEventListener("click", function () {
    state.items = [];
    save(); render();
    input.focus();
  });
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    autosize();
    send(text.slice(0, MAX_CHARS));
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener("input", autosize);
  narrow.addEventListener("change", function () {
    document.documentElement.classList.toggle("chat-locked", state.open && narrow.matches);
  });

  // Reopen after moving between pages, but not on phones, where the chat covers the whole screen.
  if (state.open && !narrow.matches) setOpen(true, false);
  else if (state.open) { state.open = false; save(); }
})();
