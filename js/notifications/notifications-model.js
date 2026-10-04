export function notificationTime(value, fallback = 0) {
    const time = value?.toMillis?.() ?? (value instanceof Date ? value.getTime()
        : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value)
            : value?.seconds !== undefined ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : fallback);
    return Number.isFinite(time) ? time : fallback;
}

const notificationDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const notificationRoutes = { budget: "budget", savings: "goals", debt: "debt", lend: "loans", subscriptions: "subscriptions" };
function validNotificationDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function invitationNotifications(records, now = new Date()) {
    return records.map(invitation => ({
        id: "invitation:" + invitation.id, type: "invitation",
        walletId: invitation.status === "accepted" ? invitation.walletId : "",
        sourceLabel: "Shared Wallet invitation", title: invitation.walletName || "Shared Wallet",
        message: (invitation.inviterName || "A wallet manager") + " invited you as "
            + (invitation.role === "admin" ? "Admin" : "Member") + ".",
        created: notificationTime(invitation.createdAt, now.getTime()),
        invitation, href: invitation.status === "accepted" ? "#sharedwallet-info" : "#notifications"
    }));
}

export function moneyAlertNotifications(items, { walletId = "", walletName = "My Money", now = new Date(), currency } = {}) {
    const notificationAmount = cents => globalThis.window?.CurrencyDisplay?.format(cents / 100, currency)
        || (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const today = notificationDateKey(now);
    const day = 86400000;
    const todayTime = Date.parse(today + "T12:00:00Z");
    const alerts = [];
    for (const item of items) {
        if (!item.alerts || !Object.hasOwn(notificationRoutes, item.kind)) continue;
        const scope = walletId || "personal";
        const base = { type: "alert", walletId, itemId: item.id, sourceLabel: walletName,
            href: "#" + (walletId ? "sharedwallet-" + notificationRoutes[item.kind] : item.kind) };
        const add = (condition, title, message, created = now.getTime()) => alerts.push({ ...base,
            id: JSON.stringify(["alert", scope, item.id, condition]), title, message, created });
        if (item.kind === "budget") {
            const fraction = item.completedCents / item.amountCents;
            if (fraction >= 1) add("limit:" + item.amountCents, item.name + " · budget limit reached",
                fraction > 1 ? notificationAmount(item.completedCents - item.amountCents) + " over your budget limit." : "Your budget limit has been reached.");
            else if (fraction >= .8) add("near-limit:" + item.amountCents, item.name + " · nearing its limit",
                `${Math.floor(fraction * 100)}% used · ${notificationAmount(item.amountCents - item.completedCents)} left.`);
            continue;
        }
        const complete = ["savings", "debt", "lend"].includes(item.kind) && item.completedCents >= item.amountCents;
        if (complete) {
            const label = { savings: "goal reached", debt: "fully paid", lend: "fully repaid" }[item.kind];
            add("completed:" + item.amountCents, item.name + " · " + label, notificationAmount(item.completedCents) + " recorded.");
            continue;
        }
        const due = { savings: item.details?.targetDate, debt: item.details?.due, lend: item.details?.due,
            subscriptions: item.details?.nextPaymentDate }[item.kind];
        const date = validNotificationDate(due);
        if (!date) continue;
        const days = Math.round((date.getTime() - todayTime) / day);
        if (days > 7) continue;
        const condition = days < 0 ? "overdue" : days === 0 ? "today" : "soon";
        const label = { savings: "target date", debt: "payment", lend: "repayment", subscriptions: "payment / renewal" }[item.kind];
        const title = item.name + " · " + (days < 0 ? label + " overdue" : days === 0 ? label + " today" : label + " approaching");
        const amount = item.kind === "subscriptions" ? item.amountCents : item.amountCents - item.completedCents;
        add(condition + ":" + due, title, `${due} · ${notificationAmount(amount)} ${item.kind === "subscriptions" ? "per payment" : "remaining"}.`);
    }
    return alerts;
}

export function walletActivityNotifications(records, wallet) {
    const notificationAmount = cents => globalThis.window?.CurrencyDisplay?.format(cents / 100, wallet.currency || "AED")
        || (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const labels = { "wallet.created": "created the wallet", "wallet.renamed": "renamed the wallet",
        "member.invited": "sent a member invitation", "invitation.accepted": "accepted an invitation",
        "invitation.declined": "declined an invitation", "member.role-updated": "updated member access",
        "member.removed": "removed a member", "category.created": "created a category",
        "category.updated": "edited a category", "category.deleted": "deleted a category",
        "category.favorite-updated": "changed a favorite", "category.alerts-updated": "changed category alerts",
        "transaction.created": "recorded a transaction", "transaction.updated": "edited a transaction",
        "transaction.deleted": "deleted a transaction" };
    return records.map(event => {
        const record = String(event.action || "").endsWith("deleted") ? event.before : event.after;
        const detail = event.entityType === "transaction" ? [record?.itemName, record?.amountCents ? notificationAmount(record.amountCents) : ""].filter(Boolean).join(" · ")
            : event.entityType === "moneyItem" ? event.after?.name || event.before?.name || "" : "";
        return { id: JSON.stringify(["activity", wallet.id, event.id]), type: "activity", walletId: wallet.id,
            sourceLabel: wallet.name, title: (event.actorName || "Member") + " " + (labels[event.action] || "updated the wallet"),
            message: detail || wallet.name, created: notificationTime(event.createdAt), href: "#sharedwallet-info" };
    });
}

export function sortNotifications(records, readIds = new Set()) {
    return [...new Map(records.map(record => [record.id, record])).values()]
        .map(record => ({ ...record, read: readIds.has(record.id) }))
        .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
}

// Only read IDs are stored, never wallet names, invitations, or financial details.
export function createNotificationReadState(userId, storage) {
    const key = "l-axis:notification-reads:" + userId;
    let ids = new Set();
    try {
        const saved = JSON.parse(storage?.getItem(key) || "[]");
        if (Array.isArray(saved)) ids = new Set(saved.filter(id => typeof id === "string"));
    } catch { /* Storage may be blocked or contain older invalid data. */ }
    return { ids, key,
        mark(records, read = true) {
            records.forEach(record => read ? ids.add(record.id) : ids.delete(record.id));
            try { storage?.setItem(key, JSON.stringify([...ids])); } catch { /* Keep working in memory. */ }
        },
        refresh() {
            try {
                const saved = JSON.parse(storage?.getItem(key) || "[]");
                if (Array.isArray(saved)) { ids.clear(); saved.filter(id => typeof id === "string").forEach(id => ids.add(id)); }
            } catch { /* Preserve the current state if storage is unavailable. */ }
        }
    };
}
