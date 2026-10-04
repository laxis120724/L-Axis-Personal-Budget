export const transactionTypes = Object.freeze({
    income: { label: "Income", direction: "in", moneyKind: null, progress: false, color: "#0f9d92" },
    budget: { label: "Budget spending", direction: "out", moneyKind: "budget", progress: true, color: "#0f9d92" },
    savings: { label: "Savings deposit", direction: "out", moneyKind: "savings", progress: true, color: "#5c8f19" },
    debt: { label: "Debt payment", direction: "out", moneyKind: "debt", progress: true, color: "#c95336" },
    lend: { label: "Lend repayment", direction: "in", moneyKind: "lend", progress: true, color: "#8057c7" },
    subscriptions: { label: "Subscription payment", direction: "out", moneyKind: "subscriptions", progress: false, color: "#14869e" }
});

// Existing ledger records remain readable after removing this option from new forms.
const previousExpenseType = Object.freeze({
    label: "Expense", direction: "out", moneyKind: null, progress: false
});

export function getTransactionType(type) {
    return Object.hasOwn(transactionTypes, type) ? transactionTypes[type]
        : type === "expense" ? previousExpenseType : undefined;
}

function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T12:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseTransactionInput(values) {
    const type = String(values.type ?? "");
    if (!Object.hasOwn(transactionTypes, type)) throw new Error("Choose a transaction type.");
    const amount = String(values.amount ?? "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        throw new Error("Enter a positive amount with at most two decimal places.");
    }
    const [whole, fraction = ""] = amount.split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error("Enter an amount greater than zero and within the allowed range.");
    }
    const itemId = transactionTypes[type].moneyKind ? String(values.itemId ?? "").trim() : null;
    if (transactionTypes[type].moneyKind && (!itemId || itemId.includes("/"))) {
        throw new Error("Choose a category item for this transaction.");
    }
    const date = String(values.date ?? "");
    if (!validDate(date)) throw new Error("Choose a valid transaction date.");
    const description = String(values.description ?? "").trim();
    if (description.length > 2000) throw new Error("Keep the description within 2,000 characters.");
    return { type, itemId, amountCents, date, description };
}

export function filterTransactions(records, filters = {}) {
    const search = String(filters.search || "").trim().toLocaleLowerCase();
    const filtered = records.filter(record => {
        if (filters.type && filters.type !== "all" && record.type !== filters.type) return false;
        if (filters.from && record.date < filters.from) return false;
        if (filters.to && record.date > filters.to) return false;
        const text = [record.itemName, record.ownerName, record.description, getTransactionType(record.type)?.label, record.date]
            .filter(Boolean).join(" ").toLocaleLowerCase();
        return !search || text.includes(search);
    });
    return filtered.sort((a, b) => {
        const date = b.date.localeCompare(a.date);
        const id = String(a.id).localeCompare(String(b.id));
        switch (filters.sort) {
            case "oldest": return -date || id;
            case "amount-high": return b.amountCents - a.amountCents || date || id;
            case "amount-low": return a.amountCents - b.amountCents || date || id;
            default: return date || id;
        }
    });
}

export function paginateTransactions(records, requestedPage, pageSize = 50) {
    const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.max(1, Math.floor(pageSize)) : 50;
    const pages = Math.max(1, Math.ceil(records.length / size));
    const page = Math.min(pages, Math.max(1,
        Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
    const offset = (page - 1) * size;
    const items = records.slice(offset, offset + size);
    return {
        items, page, pages, total: records.length,
        start: records.length ? offset + 1 : 0,
        end: offset + items.length
    };
}

export function summarizeTransactions(records, moneyItems = []) {
    let incomeCents = 0;
    let outgoingCents = 0;
    const amounts = new Map();
    for (const record of records) {
        const config = getTransactionType(record.type);
        if (!config) continue;
        if (config.direction === "in") incomeCents += record.amountCents;
        else {
            outgoingCents += record.amountCents;
            amounts.set(record.type, (amounts.get(record.type) || 0) + record.amountCents);
        }
    }
    const budgetAvailableCents = moneyItems.filter(item => item.kind === "budget")
        .reduce((sum, item) => sum + item.amountCents - item.completedCents, 0);
    const allocationTypes = ["budget", "savings", "debt", "subscriptions"];
    const allocatedCents = allocationTypes.reduce((sum, type) => sum + (amounts.get(type) || 0), 0);
    const allocation = allocationTypes
        .filter(type => amounts.get(type) > 0)
        .map(type => ({
            type, label: transactionTypes[type].label, color: transactionTypes[type].color,
            amountCents: amounts.get(type), share: amounts.get(type) / allocatedCents * 100
        }));
    return { incomeCents, outgoingCents, netCents: incomeCents - outgoingCents, budgetAvailableCents, allocation };
}
