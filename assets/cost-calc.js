// The "how much is your website costing you" calculator on /tools/website-cost-calculator/. Uses only the
// visitor's own numbers; nothing is sent anywhere. Plan prices come from the #plan-prices element sync writes.
(function () {
  var form = document.getElementById("calc");
  if (!form) return;
  var out = document.getElementById("calc-results");
  var pricesEl = document.getElementById("plan-prices");
  var prices = {};
  try { prices = JSON.parse(pricesEl ? pricesEl.getAttribute("data-prices") : "{}") || {}; } catch (e) { prices = {}; }

  function num(name) {
    var v = parseFloat(form.elements[name].value);
    return isFinite(v) && v >= 0 ? v : null;
  }
  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function money2(n) {
    return n < 10 ? "$" + n.toFixed(2) : money(n);
  }
  function row(label, value, note) {
    return '<div class="calc-row"><span>' + label + '</span><b>' + value + "</b>" + (note ? "<small>" + note + "</small>" : "") + "</div>";
  }

  function update() {
    var visitors = num("visitors"), leads = num("leads"), customers = num("customers"), value = num("value");
    if (value === null || customers === null) {
      out.innerHTML = '<p class="calc-empty">Fill in your numbers and the results show up here. Nothing is sent anywhere. It all stays in your browser.</p>';
      return;
    }
    var html = "";
    var monthly = customers * value;
    html += row("What your website brings in now", money(monthly) + " a month", money(monthly * 12) + " a year, from your numbers");
    if (visitors) html += row("Each visitor is worth", money2(monthly / visitors), "So every visitor who gives up and leaves costs you about this much");
    if (leads) html += row("Each call or message is worth", money2(monthly / leads), "So one missed message, like from a broken form, costs you about this much");
    if (value > 0) {
      html += row("One more customer a month is worth", money(value * 12) + " a year", "If your site turned just one more visitor a month into a customer");
      var pro = prices.Pro;
      if (pro) {
        var label = "Our Pro care plan is " + money(pro) + " a month. It's covered by";
        if (pro <= value) {
          html += row(label, "1 new customer a month", "With " + money(value - pro) + " left over each month");
        } else {
          html += row(label, "1 new customer every " + Math.ceil(pro / value) + " months", "From your own numbers");
        }
      }
    }
    out.innerHTML = html;
  }

  form.addEventListener("input", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); update(); });
  update();
})();
