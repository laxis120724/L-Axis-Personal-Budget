import { getTheme } from "./appearance.js";

export function initializeSettings(root, signal, api = globalThis.window?.CurrencyDisplay) {
    const form = root.querySelector("[data-settings-form]"), status = root.querySelector("[data-settings-status]");
    const field = name => form.elements.namedItem(name);
    const save = root.querySelector("[data-settings-save]");
    const cancel = root.querySelector("[data-settings-cancel]");
    const currencyNames = new Map();
    let baseline;
    let theme = "light", busy = false, themeBusy = false, loaded = false, locked = true;
    const active = () => !signal.aborted && root.isConnected;
    function message(text) { status.textContent = text; status.hidden = !text; }
    function currencies(rows) {
        rows.forEach(row => currencyNames.set(row.code, row.name));
        for (const name of ["currency", "secondaryCurrency"]) {
            const select = field(name), value = select.value || (name === "currency" ? "AED" : "USD");
            const list = [...rows];
            if (!list.some(row => row.code === value)) list.push({ code: value, name: value });
            select.replaceChildren(...list.map(row => { const option = document.createElement("option"); option.value = row.code; option.textContent = row.code + " — " + row.name; return option; }));
            select.value = value;
        }
    }
    function sync() {
        root.querySelectorAll("[data-theme-choice]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
            button.disabled = busy || themeBusy || !loaded;
        });
        field("currency").disabled = locked || busy || !loaded;
        for (const name of ["secondaryCurrency", "showConverted", "automatic"]) field(name).disabled = busy || !loaded;
        save.disabled = busy || themeBusy || !loaded;
        cancel.disabled = busy || themeBusy || !loaded;
        root.querySelector("[data-settings-secondary]").hidden = !field("showConverted").checked;
        root.querySelector("[data-settings-manual]").hidden = field("automatic").checked;
        root.querySelector("[data-settings-auto-label]").hidden = !field("automatic").checked;
        const automaticCode = api.automaticCurrency?.() || api.secondary();
        root.querySelector("[data-settings-auto-label]").textContent = automaticCode + " · browser region / time zone";
        root.querySelector("[data-settings-currency-note]").textContent = locked
            ? "Your account balance stays in " + field("currency").value + "." : "Choose once. Your main currency stays fixed.";
        root.querySelector("[data-settings-fixed]").hidden = !locked;
        root.querySelector("[data-settings-main-picker]").hidden = locked;
        root.querySelector("[data-settings-main-code]").textContent = field("currency").value;
        root.querySelector("[data-settings-main-name]").textContent = currencyNames.get(field("currency").value) || field("currency").value;
        const preview = root.querySelector("[data-settings-preview]");
        // The preview uses the draft checkbox/currency, before preferences save.
        preview.dataset.currency = field("currency").value;
        preview.dataset.convertEnabled = String(field("showConverted").checked);
        preview.dataset.convertTo = field("automatic").checked ? automaticCode : field("secondaryCurrency").value;
        api.setAmount(preview, 10000, field("currency").value);
    }
    currencies(api.fallbackCurrencies());
    function restore(values) {
        for (const name of ["currency", "secondaryCurrency"]) {
            const select = field(name);
            if (![...select.options].some(option => option.value === values[name])) {
                const option = document.createElement("option"); option.value = option.textContent = values[name]; select.append(option);
            }
            select.value = values[name];
        }
        field("showConverted").checked = values.showConverted; field("automatic").checked = values.automatic;
    }
    const stop = api.watch(values => {
        if (!active()) return;
        const currencyChanged = !baseline || !loaded || ["currency", "secondaryCurrency", "showConverted", "automatic"]
            .some(name => baseline[name] !== values[name]);
        loaded = values.loaded && !values.error; locked = values.locked;
        theme = getTheme();
        baseline = { ...values, theme };
        // Theme-only notifications must preserve unsaved currency choices.
        if (currencyChanged) restore(values);
        message(values.error || (!values.loaded ? "Loading settings…" : "")); sync();
    });
    signal.addEventListener("abort", stop, { once: true });
    api.currencies().then(rows => { if (active()) { currencies(rows); sync(); } }).catch(() => {
        if (active()) message("The full currency list is unavailable. Common currencies are still listed.");
    });
    root.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", async () => {
        if (busy || themeBusy || !loaded || button.dataset.themeChoice === getTheme()) return;
        theme = button.dataset.themeChoice; themeBusy = true; message(""); sync();
        try { await api.saveTheme(theme); }
        catch (error) { if (active()) message("Unable to save theme: " + error.message); }
        finally { themeBusy = false; if (active()) { theme = getTheme(); sync(); } }
    }, { signal }));
    cancel.addEventListener("click", () => {
        if (busy || themeBusy || !loaded || !baseline) return;
        restore(baseline);
        message(""); sync();
    }, { signal });
    form.addEventListener("change", sync, { signal });
    form.addEventListener("submit", async event => {
        event.preventDefault(); if (busy || themeBusy || !loaded || !form.reportValidity()) return;
        const values = { currency: field("currency").value, secondaryCurrency: field("secondaryCurrency").value,
            showConverted: field("showConverted").checked, automatic: field("automatic").checked };
        busy = true; save.textContent = "Saving…"; message(""); sync();
        try {
            const saved = await api.save(values);
            if (active()) { baseline = { ...values, ...saved }; message("Settings saved."); }
        }
        catch (error) { if (active()) message("Unable to save settings: " + error.message); }
        finally { busy = false; if (active()) { save.textContent = "Save changes"; sync(); } }
    }, { signal });
}
