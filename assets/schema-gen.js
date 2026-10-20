// Business schema generator: turns the form into LocalBusiness JSON-LD as the visitor types. Runs only in
// the browser; nothing is sent anywhere. Review and rating fields are deliberately not offered.
(function () {
  var form = document.getElementById("sg-form");
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var code = $("sg-code"), checks = $("sg-checks"), copied = $("sg-copied");
  var DAYS = [["Mo", "Monday"], ["Tu", "Tuesday"], ["We", "Wednesday"], ["Th", "Thursday"], ["Fr", "Friday"], ["Sa", "Saturday"], ["Su", "Sunday"]];

  function val(name) { var f = form.elements[name]; return f ? String(f.value || "").trim() : ""; }
  function isUrl(s) { try { var u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch (e) { return false; } }

  function build() {
    var d = { "@context": "https://schema.org", "@type": val("type") || "LocalBusiness" };
    if (val("name")) d.name = val("name");
    if (val("url")) d.url = val("url");
    if (val("description")) d.description = val("description");
    if (val("telephone")) d.telephone = val("telephone");
    if (val("email")) d.email = val("email");
    if (val("logo")) { d.logo = val("logo"); d.image = val("logo"); }

    var addr = { "@type": "PostalAddress" };
    if (!form.elements.hideStreet.checked && val("street")) addr.streetAddress = val("street");
    if (val("city")) addr.addressLocality = val("city");
    if (val("region")) addr.addressRegion = val("region");
    if (val("postal")) addr.postalCode = val("postal");
    if (val("country")) addr.addressCountry = val("country").toUpperCase();
    if (Object.keys(addr).length > 1) d.address = addr;

    var areas = val("areas").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (areas.length) d.areaServed = areas.map(function (a) { return { "@type": "Place", name: a }; });

    if (form.elements.hoursOn.checked) {
      var specs = [];
      DAYS.forEach(function (day) {
        if (!form.elements["open-" + day[0]].checked) return;
        var from = val("from-" + day[0]), to = val("to-" + day[0]);
        var same = specs.filter(function (s) { return s.opens === from && s.closes === to; })[0];
        if (same) same.dayOfWeek.push(day[1]);
        else specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek: [day[1]], opens: from, closes: to });
      });
      if (specs.length) d.openingHoursSpecification = specs;
    }
    if (val("price")) d.priceRange = val("price");
    var same = val("sameAs").split(/\s+/).filter(Boolean);
    if (same.length) d.sameAs = same;
    return d;
  }

  function audit(d) {
    var w = [];
    if (!d.name) w.push(["warn", "Add your business name. It's required."]);
    if (!d.url) w.push(["warn", "Add your website address."]);
    else if (!isUrl(d.url)) w.push(["warn", "Your website address should start with https://"]);
    if (!d.address || !d.address.addressLocality) w.push(["warn", "Add your town or city. Google needs a location for a local business."]);
    if (d.address && !d.address.streetAddress && !form.elements.hideStreet.checked) w.push(["warn", "Add your street address, or tick the box if you visit customers instead."]);
    if (d.logo && !isUrl(d.logo)) w.push(["warn", "The logo should be a full image address starting with https://"]);
    if (d.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.email)) w.push(["warn", "That email address doesn't look right."]);
    if (d.telephone && (d.telephone.match(/\d/g) || []).length < 7) w.push(["warn", "That phone number looks too short. Include the area code."]);
    (d.sameAs || []).forEach(function (s) { if (!isUrl(s)) w.push(["warn", "This profile link isn't a full web address: " + s]); });
    (d.openingHoursSpecification || []).forEach(function (s) {
      if (!s.opens || !s.closes) w.push(["warn", "Fill in both opening and closing times for " + s.dayOfWeek.join(", ") + "."]);
    });
    if (!w.length) w.push(["ok", "Looks complete. Copy the code and add it to your home page."]);
    return w;
  }

  function update() {
    var d = build();
    code.value = '<script type="application/ld+json">\n' + JSON.stringify(d, null, 2) + "\n</" + "script>";
    checks.textContent = "";
    audit(d).forEach(function (x) { var li = document.createElement("li"); li.className = x[0]; li.textContent = x[1]; checks.appendChild(li); });
    $("sg-street-field").hidden = form.elements.hideStreet.checked;
    $("sg-hours").hidden = !form.elements.hoursOn.checked;
    copied.textContent = "";
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  $("sg-copy").addEventListener("click", function () {
    var done = function () { copied.textContent = "Copied. Paste it into your home page."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code.value).then(done, function () { code.select(); document.execCommand("copy"); done(); });
    } else {
      code.select();
      document.execCommand("copy");
      done();
    }
  });
  update();
})();
