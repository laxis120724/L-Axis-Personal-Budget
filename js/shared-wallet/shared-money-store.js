import { db, getUser } from "../core/firebase.js";
import { readMoneyForm, normalizeMoneyItem } from "../money/money-store.js";
import { collection, doc, runTransaction, serverTimestamp, onSnapshot, query, orderBy }
    from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

function id(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new Error("Choose a valid wallet or category.");
    }
    return value;
}

function snapshot(item) {
    return Object.fromEntries(['kind', 'name', 'amountCents', 'completedCents', 'description',
        'alerts', 'favorite', 'details'].map(key => [key, item[key]]));
}

function sharedForm(kind, form) {
    const item = readMoneyForm(kind, form);
    const dates = { budget: ['startDate'], savings: ['start', 'targetDate'], debt: ['start', 'due'],
        lend: ['lentDate', 'due'], subscriptions: ['startDate', 'nextPaymentDate'] }[kind];
    for (const key of dates) {
        const value = item.details[key];
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(value + 'T00:00:00Z') : null;
        if (!date || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.toISOString().slice(0, 10) !== value) {
            throw new Error("Choose valid starting and ending dates.");
        }
    }
    for (const key of ['creditor', 'borrower', 'category']) if (key in item.details) {
        item.details[key] = String(item.details[key]).trim();
        if (item.details[key].length > 80) throw new Error("Keep creditor, borrower, and category names within 80 characters.");
    }
    return item;
}

async function mutate(walletId, itemId, action, changes) {
    walletId = id(walletId);
    itemId = id(itemId);
    const user = await getUser();
    const walletRef = doc(db, "sharedWallets", walletId);
    const itemRef = doc(db, "sharedWallets", walletId, "moneyItems", itemId);
    const eventRef = doc(collection(db, "sharedWallets", walletId, "activity"));
    return runTransaction(db, async transaction => {
        const [walletRecord, itemRecord] = await Promise.all([transaction.get(walletRef), transaction.get(itemRef)]);
        const wallet = walletRecord.exists() ? walletRecord.data() : null;
        const actor = wallet?.members?.[user.uid];
        if (!actor || !["creator", "admin"].includes(actor.role)) {
            throw new Error("Only the Creator or an Admin can manage shared categories.");
        }
        const before = itemRecord.exists() ? itemRecord.data() : null;
        if (action === "category.created" ? before : !before) throw new Error("This category changed. Refresh the page.");
        const patch = changes ? changes(before) : null;
        const after = patch ? { ...before, ...patch } : null;
        if (after && after.kind !== "budget" && after.completedCents > after.amountCents) {
            throw new Error("The target cannot be lower than the recorded progress.");
        }
        if (action === "category.created") transaction.set(itemRef, { ...after,
            createdAt: serverTimestamp(), createdBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
        else if (action === "category.deleted") transaction.delete(itemRef);
        else transaction.update(itemRef, { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid });
        transaction.update(walletRef, { updatedAt: serverTimestamp(), lastActivityId: eventRef.id });
        transaction.set(eventRef, { action, actorUid: user.uid, actorName: actor.displayName,
            entityType: "moneyItem", entityId: itemId, before: before ? snapshot(before) : null,
            after: after ? snapshot(after) : { deleted: true }, createdAt: serverTimestamp() });
        return { id: itemId };
    });
}

export async function addSharedMoneyItem(walletId, kind, form) {
    walletId = id(walletId);
    const item = sharedForm(kind, form);
    if (item.completedCents !== 0) throw new Error("Shared categories start at zero. Record contributions and payments as transactions.");
    const reference = doc(collection(db, "sharedWallets", walletId, "moneyItems"));
    return mutate(walletId, reference.id, "category.created", () => item);
}

export async function updateSharedMoneyItem(walletId, kind, itemId, form) {
    const item = sharedForm(kind, form);
    return mutate(walletId, itemId, "category.updated", before => {
        if (before.kind !== kind) throw new Error("This category belongs to a different section.");
        // Financial progress is changed by audited transactions, not category edits.
        const { name, amountCents, description, alerts, details } = item;
        return { name, amountCents, description, alerts, details };
    });
}

export async function deleteSharedMoneyItem(walletId, itemId) {
    return mutate(walletId, itemId, "category.deleted");
}

export async function setSharedMoneyFavorite(walletId, itemId, favorite) {
    if (typeof favorite !== "boolean") throw new Error("Choose a valid favorite setting.");
    return mutate(walletId, itemId, "category.favorite-updated", () => ({ favorite }));
}

export async function setSharedMoneyAlerts(walletId, itemId, alerts) {
    if (typeof alerts !== "boolean") throw new Error("Choose a valid alert setting.");
    return mutate(walletId, itemId, "category.alerts-updated", () => ({ alerts }));
}

export async function watchSharedMoneyItems(walletId, onChange, onError) {
    walletId = id(walletId);
    if (typeof onChange !== "function" || typeof onError !== "function") throw new Error("Provide update and error handlers.");
    await getUser();
    let stopped = false;
    const stop = onSnapshot(query(collection(db, "sharedWallets", walletId, "moneyItems"), orderBy("createdAt", "asc")),
        records => {
            if (stopped) return;
            try { onChange(records.docs.map(normalizeMoneyItem)); }
            catch (error) { onError(error); }
        }, error => { if (!stopped) onError(error); });
    return () => { if (!stopped) { stopped = true; stop(); } };
}
