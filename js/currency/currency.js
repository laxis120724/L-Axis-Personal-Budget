export const LEGACY_CURRENCY = "AED";
const commonCurrencies = { AED: "UAE dirham", PHP: "Philippine peso", USD: "US dollar", EUR: "Euro", GBP: "British pound",
    INR: "Indian rupee", CAD: "Canadian dollar", AUD: "Australian dollar", SGD: "Singapore dollar", SAR: "Saudi riyal", JPY: "Japanese yen" };
const rates = new Map(), pending = new Map();
let currencyList;

export function currencyCode(value) {
    if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw new Error("Choose a valid currency.");
    return value;
}
// Saved amounts remain hundredths of a currency unit throughout the app.
export function formatCurrency(cents, currency = LEGACY_CURRENCY) {
    currencyCode(currency);
    return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function convertCents(cents, rate) {
    if (!Number.isSafeInteger(cents) || !Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new Error("Invalid conversion amount or rate.");
    const result = Math.sign(cents) * Math.round(Math.abs(cents) * rate);
    if (!Number.isSafeInteger(result)) throw new Error("The converted amount is too large.");
    return result;
}
export function automaticCurrency(locale = navigator.language, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    // Region/time-zone inference only; no GPS permission or IP service.
    const zones = { "Asia/Dubai": "AED", "Asia/Manila": "PHP", "Asia/Kolkata": "INR", "Asia/Calcutta": "INR",
        "Asia/Singapore": "SGD", "Asia/Riyadh": "SAR", "Asia/Tokyo": "JPY", "Europe/London": "GBP" };
    if (zones[zone]) return zones[zone];
    if (zone?.startsWith("Australia/")) return "AUD";
    const region = String(locale).match(/[-_]([A-Z]{2})(?:$|[-_])/i)?.[1].toUpperCase();
    const regions = { AE: "AED", PH: "PHP", US: "USD", GB: "GBP", IN: "INR", CA: "CAD", AU: "AUD", SG: "SGD", SA: "SAR", JP: "JPY",
        DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", IE: "EUR", PT: "EUR", NL: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR" };
    return regions[region] || LEGACY_CURRENCY;
}
async function json(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Exchange rate unavailable.");
        return await response.json();
    } catch (error) {
        throw new Error("Exchange rate unavailable. Check your connection and try again.", { cause: error });
    } finally { clearTimeout(timeout); }
}
export async function getCurrencies() {
    if (currencyList) return currencyList;
    const data = await json("https://api.frankfurter.dev/v2/currencies");
    if (!Array.isArray(data)) throw new Error("Currency list unavailable.");
    currencyList = data.filter(row => /^[A-Z]{3}$/.test(row.iso_code) && typeof row.name === "string")
        .map(row => ({ code: row.iso_code, name: row.name })).sort((a, b) => a.code.localeCompare(b.code));
    if (!currencyList.length) throw new Error("Currency list unavailable.");
    return currencyList;
}
export function fallbackCurrencies() { return Object.entries(commonCurrencies).map(([code, name]) => ({ code, name })); }
export async function getRate(base, quote, date = "") {
    currencyCode(base); currencyCode(quote);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid rate date.");
    if (base === quote) return { base, quote, rate: 1, date: date || new Date().toISOString().slice(0, 10) };
    const key = `${base}/${quote}/${date}`;
    const cached = rates.get(key);
    if (cached && (date || Date.now() - cached.savedAt < 3600000)) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const request = json(`https://api.frankfurter.dev/v2/rate/${base.toLowerCase()}/${quote.toLowerCase()}${date ? "?date=" + date : ""}`)
        .then(value => {
            if (value.base !== base || value.quote !== quote || !Number.isFinite(value.rate) || value.rate <= 0 || value.rate > 1e9
                || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error("No valid exchange rate is available for these currencies.");
            rates.set(key, { value, savedAt: Date.now() }); return value;
        }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
}
export async function transactionConversion(data, base) {
    const source = currencyCode(String(data.get("inputCurrency") || base));
    const text = String(data.get("amount") || "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a positive amount with up to two decimal places.");
    const [whole, fraction = ""] = text.split(".");
    const sourceAmountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(sourceAmountCents) || sourceAmountCents <= 0) throw new Error("Enter a valid positive amount.");
    if (source === base) return { amountCents: sourceAmountCents, fx: null };
    // Fetch before the retryable Firestore commit; a retry uses this same rate.
    const value = await getRate(source, base, String(data.get("date") || ""));
    const amountCents = convertCents(sourceAmountCents, value.rate);
    if (amountCents <= 0) throw new Error("This amount rounds to zero in the wallet currency.");
    return { amountCents, fx: { sourceCurrency: source, sourceAmountCents, rate: value.rate, rateDate: value.date } };
}
