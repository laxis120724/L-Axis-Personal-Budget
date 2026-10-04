import { getTransactionType, summarizeTransactions } from "../transactions/transaction-model.js";

const dashboardMonthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const dashboardCreatedTime = record => record.createdAt?.toMillis?.()
    ?? (record.createdAt instanceof Date ? record.createdAt.getTime()
        : (record.createdAt?.seconds || 0) * 1000 + (record.createdAt?.nanoseconds || 0) / 1e6);
const spendingColors = ["#16a394", "#8270d5", "#f0a151", "#44a4c6", "#cb6d92", "#739b43"];

// Savings deposits move cash into goals; they are not counted as expenses.
function cashTotals(records) {
    const totals = summarizeTransactions(records);
    const savingsCents = records.filter(record => record.type === "savings")
        .reduce((sum, record) => sum + record.amountCents, 0);
    return { ...totals, savingsCents, expenseCents: totals.outgoingCents - savingsCents };
}

// Keep wallet IDs with records: two wallets can contain the same category ID.
// Missing feeds produce unavailable totals, never a partial balance shown as complete.
export function buildDashboardModel(sources, { now = new Date(), membershipReady = true } = {}) {
    const transactionsReady = membershipReady && sources.every(source => Array.isArray(source.transactions));
    const itemsReady = membershipReady && sources.every(source => Array.isArray(source.items));
    const records = sources.flatMap(source => (source.transactions || []).map(record => ({ ...record,
        walletKey: source.key, walletLabel: source.label, shared: source.shared })));
    const items = sources.flatMap(source => (source.items || []).map(item => ({ ...item,
        walletKey: source.key, walletLabel: source.label, shared: source.shared })));
    const month = dashboardMonthKey(now);
    const current = records.filter(record => record.date.startsWith(month + "-"));
    const monthly = transactionsReady ? cashTotals(current) : null;
    const cash = transactionsReady ? cashTotals(records) : null;
    const categoryTotals = kind => {
        const category = items.filter(item => item.kind === kind);
        const targetCents = category.reduce((sum, item) => sum + item.amountCents, 0);
        const completedCents = category.reduce((sum, item) => sum + item.completedCents, 0);
        return { count: category.length, targetCents, completedCents, remainingCents: targetCents - completedCents };
    };
    const categories = itemsReady ? Object.fromEntries(["budget", "savings", "debt", "lend", "subscriptions"]
        .map(kind => [kind, categoryTotals(kind)])) : null;
    if (categories) {
        const factors = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
        categories.subscriptions.monthlyCents = Math.round(items.filter(item => item.kind === "subscriptions")
            .reduce((sum, item) => sum + item.amountCents * factors[item.details?.cycle || item.cycle], 0));
    }
    const budgets = itemsReady ? items.filter(item => item.kind === "budget").map(item => ({
        id: item.id, walletKey: item.walletKey, label: item.name, walletLabel: item.walletLabel,
        plannedCents: item.amountCents, spentCents: item.completedCents,
        remainingCents: Math.max(0, item.amountCents - item.completedCents),
        overCents: Math.max(0, item.completedCents - item.amountCents),
        varianceCents: item.completedCents - item.amountCents
    })).sort((a, b) => b.overCents - a.overCents || b.spentCents / b.plannedCents - a.spentCents / a.plannedCents
        || a.label.localeCompare(b.label)) : null;
    const allocation = new Map();
    for (const record of current) {
        if (getTransactionType(record.type)?.direction !== "out" || record.type === "savings") continue;
        const key = JSON.stringify([record.walletKey, record.type, record.itemId]);
        const row = allocation.get(key) || { label: record.itemName || getTransactionType(record.type).label,
            walletLabel: record.walletLabel, amountCents: 0 };
        row.amountCents += record.amountCents;
        allocation.set(key, row);
    }
    let spending = [...allocation.values()].sort((a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label));
    if (spending.length > 6) spending = [...spending.slice(0, 5), { label: "Remaining categories", walletLabel: "",
        amountCents: spending.slice(5).reduce((sum, row) => sum + row.amountCents, 0) }];
    spending = transactionsReady ? spending.map((row, index) => ({ ...row, color: spendingColors[index],
        share: row.amountCents / monthly.expenseCents * 100 })) : null;
    const months = transactionsReady ? Array.from({ length: 6 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const key = dashboardMonthKey(date);
        return { key, label: date.toLocaleDateString("en-US", { month: "short" }),
            fullLabel: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
            ...cashTotals(records.filter(record => record.date.startsWith(key + "-"))) };
    }) : null;
    const recent = transactionsReady ? [...records].sort((a, b) => b.date.localeCompare(a.date)
        || dashboardCreatedTime(b) - dashboardCreatedTime(a)
        || a.walletKey.localeCompare(b.walletKey) || String(a.id).localeCompare(String(b.id))).slice(0, 5) : null;
    return { cash, monthly, categories, budgets, spending, months, recent,
        month: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        overspentCount: budgets?.filter(budget => budget.overCents > 0).length,
        balances: sources.map(source => ({ key: source.key, label: source.label, shared: source.shared,
            cash: Array.isArray(source.transactions) ? cashTotals(source.transactions) : null,
            error: source.transactionsError })) };
}
