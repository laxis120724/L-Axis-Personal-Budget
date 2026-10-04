import { getRate, convertCents, formatCurrency, fallbackCurrencies, getCurrencies } from "./currency.js";

export function initializeTransactionCurrency(form, signal, base, shared = false) {
    const amount = form.elements.namedItem("amount"), date = form.elements.namedItem("date");
    const wrapper = document.createElement("div"); wrapper.className = "money-field money-field--full";
    const label = document.createElement("label"); label.textContent = "Amount currency";
    const select = document.createElement("select"); select.name = "inputCurrency"; select.id = "transaction-input-currency";
    label.htmlFor = select.id;
    const preview = document.createElement("p"); preview.className = "currency-conversion-preview"; preview.setAttribute("role", "status");
    wrapper.append(label, select, preview); amount.closest(".money-field").after(wrapper);
    let request = 0, editing = false;
    const submit = form.querySelector('[type="submit"]');
    function buttonAmount(cents, code) {
        if (!submit || submit.disabled) return;
        submit.textContent = (editing ? "Update transaction" : "Save transaction")
            + (shared && cents > 0 ? " · " + formatCurrency(cents, code) : "");
    }
    function options(rows) {
        const chosen = select.value || base();
        if (!rows.some(row => row.code === chosen)) rows = [...rows, { code: chosen, name: chosen }];
        select.replaceChildren(...rows.map(row => { const option = document.createElement("option"); option.value = row.code; option.textContent = row.code + " — " + row.name; return option; }));
        select.value = chosen;
    }
    async function update() {
        const revision = ++request;
        const cents = Math.round(Number(amount.value) * 100), code = base();
        if (!(cents > 0) || !Number.isSafeInteger(cents)) { preview.textContent = "Wallet currency: " + code; buttonAmount(0, code); return; }
        if (select.value === code) {
            preview.textContent = "Recorded as " + formatCurrency(cents, code);
            buttonAmount(cents, code);
            // Highlight the member's own equivalent even when entering wallet units.
            const own = globalThis.window?.CurrencyDisplay?.get().currency;
            if (!shared || !own || own === code) return;
            try {
                const rate = await getRate(code, own, date.value);
                if (revision === request && !signal.aborted) preview.textContent += " · ≈ " + formatCurrency(convertCents(cents, rate.rate), own);
            } catch { if (revision === request && !signal.aborted) preview.textContent += " · Conversion unavailable"; }
            return;
        }
        buttonAmount(0, code);
        preview.textContent = "Converting to " + code + "…";
        try {
            const rate = await getRate(select.value, code, date.value);
            if (revision === request && !signal.aborted) {
                const converted = convertCents(cents, rate.rate);
                preview.textContent = "≈ " + formatCurrency(converted, code) + " · rate " + rate.date;
                buttonAmount(converted, code);
            }
        } catch { if (revision === request && !signal.aborted) preview.textContent = "Conversion unavailable. Try again before saving."; }
    }
    options(fallbackCurrencies());
    // Personal entries always use the permanent main currency.
    wrapper.hidden = !shared;
    for (const input of [select, amount, date]) input.addEventListener(input === amount ? "input" : "change", update, { signal });
    getCurrencies().then(rows => { if (!signal.aborted) { options(rows); update(); } }).catch(() => {});
    return { open(record) {
        editing = Boolean(record);
        const chosen = editing ? base() : globalThis.window?.CurrencyDisplay?.get().currency || base();
        if (![...select.options].some(option => option.value === chosen)) {
            const option = document.createElement("option"); option.value = option.textContent = chosen; select.append(option);
        }
        select.value = shared ? chosen : base(); update();
    } };
}
