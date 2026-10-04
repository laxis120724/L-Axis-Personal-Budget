import { db, getUser } from "../core/firebase.js";
import { currencyCode, LEGACY_CURRENCY } from "../currency/currency.js";
import { doc, getDoc, getDocs, collection, query, limit, runTransaction, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const defaults = { currency: LEGACY_CURRENCY, theme: "light", showConverted: false, automatic: true, secondaryCurrency: "USD" };
export async function loadPreferences() {
    const user = await getUser();
    const record = await getDoc(doc(db, "users", user.uid, "settings", "preferences"));
    if (record.exists()) return { ...defaults, ...record.data(), locked: true };
    const [items, transactions] = await Promise.all(["moneyItems", "transactions"].map(path =>
        getDocs(query(collection(db, "users", user.uid, path), limit(1)))));
    let theme = defaults.theme;
    try { theme = localStorage.getItem("laxis.accountTheme." + user.uid) === "dark" ? "dark" : "light"; } catch {}
    return { ...defaults, theme, locked: !items.empty || !transactions.empty };
}
export async function savePreferences(values) {
    const user = await getUser();
    const currency = currencyCode(values.currency), secondaryCurrency = currencyCode(values.secondaryCurrency);
    const previous = await loadPreferences();
    if (previous.locked && previous.currency !== currency) throw new Error("Your main currency is fixed. Use the converted currency below instead.");
    const fields = { currency, secondaryCurrency, theme: values.theme === "dark" ? "dark" : "light",
        showConverted: Boolean(values.showConverted), automatic: Boolean(values.automatic) };
    const ref = doc(db, "users", user.uid, "settings", "preferences");
    await runTransaction(db, async transaction => {
        const saved = await transaction.get(ref);
        if (saved.exists() && saved.data().currency !== currency) throw new Error("Your main currency was already selected on another device. Reload Settings.");
        // Currency changes preserve the independently saved theme.
        if (saved.exists()) fields.theme = saved.data().theme;
        transaction.set(ref, { ...fields, updatedAt: serverTimestamp() });
    });
    return { ...fields, locked: true };
}

export async function saveThemePreference(value) {
    const user = await getUser();
    const theme = value === "dark" ? "dark" : "light";
    const previous = await loadPreferences();
    const ref = doc(db, "users", user.uid, "settings", "preferences");
    await runTransaction(db, async transaction => {
        const saved = await transaction.get(ref);
        // Choosing a theme must not select and lock a new account's currency.
        if (saved.exists()) transaction.set(ref, { ...saved.data(), theme, updatedAt: serverTimestamp() });
        else if (previous.locked) transaction.set(ref, {
            currency: previous.currency, secondaryCurrency: previous.secondaryCurrency, theme,
            showConverted: previous.showConverted, automatic: previous.automatic, updatedAt: serverTimestamp()
        });
    });
    try { localStorage.setItem("laxis.accountTheme." + user.uid, theme); } catch {}
}
