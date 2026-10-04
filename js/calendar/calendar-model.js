const calendarKinds = {
    savings: { label: "Savings", date: "targetDate", route: "goals", amountLabel: "Remaining goal" },
    debt: { label: "Debt", date: "due", route: "debt", amountLabel: "Payment" },
    lend: { label: "Loan", date: "due", route: "loans", amountLabel: "To receive" },
    subscriptions: { label: "Subscription", date: "nextPaymentDate", route: "subscriptions", amountLabel: "Payment" }
};

export const calendarDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// Calendar dates stay local dates, without UTC offsets changing the day.
export function parseCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1000 || year > 9999) return null;
    const date = new Date(year, month - 1, day, 12);
    return calendarDateKey(date) === value ? date : null;
}

export function calendarDueRecords({ personalItems = [], wallets = [] } = {}) {
    const records = [];
    const add = (items, walletId = "", walletName = "My Money", currency, showConverted = false) => {
        for (const item of items) {
            const kind = calendarKinds[item.kind];
            if (!kind || !parseCalendarDate(item.details?.[kind.date])) continue;
            if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0
                || !Number.isSafeInteger(item.completedCents) || item.completedCents < 0) continue;
            const remainingCents = Math.max(0, item.amountCents - item.completedCents);
            if (item.kind !== "subscriptions" && !remainingCents) continue;
            const payment = item.details?.paymentCents;
            const installment = item.kind === "debt" && Number.isSafeInteger(payment) && payment > 0;
            records.push({
                id: JSON.stringify(["due", walletId || "personal", item.id]), itemId: item.id, kind: item.kind,
                name: item.name, description: item.description || "", walletId, walletName,
                date: item.details[kind.date], categoryLabel: kind.label,
                amountLabel: item.kind === "debt" && !installment ? "Remaining balance" : kind.amountLabel,
                amountCents: item.kind === "subscriptions" ? item.amountCents
                    : installment ? Math.min(payment, remainingCents) : remainingCents,
                totalCents: item.amountCents, completedCents: item.completedCents, details: item.details,
                ...(currency ? { currency, showConverted } : {}),
                href: "#" + (walletId ? "sharedwallet-" + kind.route : item.kind)
            });
        }
    };
    add(personalItems, "", "My Money", globalThis.window?.CurrencyDisplay?.get().currency);
    for (const wallet of wallets) add(wallet.items || [], wallet.id, wallet.name, wallet.currency, wallet.showConverted);
    return records.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function calendarMonthDays(month) {
    const start = parseCalendarDate(month + "-01");
    if (!start) return [];
    const first = new Date(start.getFullYear(), start.getMonth(), 1 - start.getDay(), 12);
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12);
        const key = calendarDateKey(date);
        return { date: key, day: date.getDate(), inMonth: key.slice(0, 7) === month };
    });
}

export function shiftCalendarMonth(month, offset) {
    const date = parseCalendarDate(month + "-01");
    if (!date) return month;
    const next = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
    return next.getFullYear() >= 1000 && next.getFullYear() <= 9999 ? calendarDateKey(next).slice(0, 7) : month;
}

export function calendarDateLabel(value, options = { weekday: "long", month: "long", day: "numeric", year: "numeric" }) {
    return parseCalendarDate(value)?.toLocaleDateString("en-US", options) || "";
}

export const calendarAmount = cents => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
