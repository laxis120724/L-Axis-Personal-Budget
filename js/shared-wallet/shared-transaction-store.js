import { db, getUser } from "../core/firebase.js";
import { getTransactionType, parseTransactionInput } from "../transactions/transaction-model.js";
import { transactionConversion } from "../currency/currency.js";
import { collection, doc, getDoc, runTransaction, serverTimestamp, onSnapshot, query, orderBy }
    from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

function id(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new Error("Choose a valid wallet, member, transaction, or category.");
    }
    return value;
}

function cents(value, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error("The saved amount is outside the allowed range.");
    return value;
}

function typeFor(value) {
    if (!["income", "budget", "savings", "debt", "lend", "subscriptions"].includes(value)) {
        throw new Error("Choose a valid shared transaction type.");
    }
    return getTransactionType(value);
}

function readForm(form) {
    const data = form instanceof FormData ? form : new FormData(form);
    const input = parseTransactionInput(Object.fromEntries(data));
    if (Number(input.date.slice(0, 4)) < 1) throw new Error("Choose a valid transaction date.");
    if (input.itemId) id(input.itemId);
    const ownerUid = data.get("ownerUid");
    return { input, ownerUid: ownerUid ? id(String(ownerUid)) : null };
}

async function convertedForm(walletId, form) {
    const data = form instanceof FormData ? form : new FormData(form);
    const values = readForm(data);
    if (!data.get("inputCurrency")) return values; // Older forms record wallet units.
    const record = await getDoc(doc(db, "sharedWallets", walletId));
    if (!record.exists()) throw new Error("This wallet no longer exists.");
    const currency = record.data().currency || "AED";
    const converted = await transactionConversion(data, currency);
    values.input.amountCents = converted.amountCents;
    values.input.fx = converted.fx;
    values.currency = currency;
    return values;
}

function saved(record) {
    if (!record.exists()) throw new Error("This transaction no longer exists. Refresh and try again.");
    const item = record.data();
    typeFor(item.type);
    cents(item.amountCents, 1);
    id(item.ownerUid);
    if (item.itemId) id(item.itemId);
    return item;
}

function snapshot(item) {
    const keys = ["type", "itemId", "itemName", "amountCents", "date", "description", "ownerUid", "ownerName"];
    if (Object.hasOwn(item, "fx")) keys.push("fx");
    return Object.fromEntries(keys.map(key => [key, item[key]]));
}

function canChange(member, uid, item) {
    return ["creator", "admin"].includes(member.role)
        || (item.ownerUid === uid && (item.type === "income" || member.categoryIds.includes(item.itemId)));
}

// One retryable commit changes the ledger, affected card balances, and history.
async function commit(walletId, action, transactionId, values) {
    walletId = id(walletId);
    if (transactionId) id(transactionId);
    const user = await getUser();
    const walletRef = doc(db, "sharedWallets", walletId);
    const ledger = collection(db, "sharedWallets", walletId, "transactions");
    const reference = action === "created" ? doc(ledger) : doc(ledger, transactionId);
    const eventRef = doc(collection(db, "sharedWallets", walletId, "activity"));
    await runTransaction(db, async transaction => {
        const walletRecord = await transaction.get(walletRef);
        const wallet = walletRecord.exists() ? walletRecord.data() : null;
        const actor = wallet?.members?.[user.uid];
        if (values?.currency && values.currency !== (wallet?.currency || "AED")) throw new Error("The wallet currency changed. Reload before saving.");
        if (!actor) throw new Error("You no longer have access to this shared wallet.");
        const old = action === "created" ? null : saved(await transaction.get(reference));
        if (old && !canChange(actor, user.uid, old)) {
            throw new Error("You can change only your own transactions within assigned categories.");
        }
        const ownerUid = old?.ownerUid || values?.ownerUid || user.uid;
        const owner = wallet.members[ownerUid];
        if (!old && !owner) throw new Error("Choose a member who belongs to this wallet.");
        const next = values ? { ...values.input, ownerUid, ownerName: old?.ownerName || owner.displayName } : null;
        // Description/category-only edits retain the original FX evidence.
        if (next && old?.fx) next.fx = !next.fx && next.amountCents === old.amountCents && next.date === old.date ? old.fx : next.fx || null;
        if (next && !canChange(actor, user.uid, next)) {
            throw new Error("Choose one of your assigned categories, or record your own income.");
        }
        const oldType = old ? typeFor(old.type) : null;
        const nextType = next ? typeFor(next.type) : null;
        const references = new Map();
        for (const item of [old, next]) if (item?.itemId) {
            references.set(item.itemId, doc(db, "sharedWallets", walletId, "moneyItems", item.itemId));
        }
        const items = new Map();
        for (const [itemId, itemRef] of references) {
            const record = await transaction.get(itemRef);
            if (record.exists()) items.set(itemId, record.data());
        }
        if (nextType?.moneyKind) {
            const item = items.get(next.itemId);
            if (!item) throw new Error("The selected category was removed. Choose another category.");
            if (item.kind !== nextType.moneyKind) throw new Error("This category does not match the transaction type.");
            next.itemName = item.name;
        } else if (next) next.itemName = null;
        const deltas = new Map();
        function delta(itemId, amount) {
            const total = (deltas.get(itemId) || 0) + amount;
            if (!Number.isSafeInteger(total)) throw new Error("The transaction amount is outside the allowed range.");
            deltas.set(itemId, total);
        }
        if (oldType?.progress && items.has(old.itemId)) {
            if (items.get(old.itemId).kind !== oldType.moneyKind) throw new Error("The original category no longer matches this transaction.");
            delta(old.itemId, -old.amountCents);
        }
        if (nextType?.progress) delta(next.itemId, next.amountCents);
        const patches = [];
        for (const [itemId, change] of deltas) {
            const item = items.get(itemId);
            const completed = cents(item.completedCents) + change;
            const limit = cents(item.amountCents, 1);
            if (!Number.isSafeInteger(completed) || completed < 0) throw new Error("This change would make category progress negative.");
            if (item.kind !== "budget" && completed > limit) throw new Error("This transaction would exceed the category's target or remaining balance.");
            if (change) patches.push([references.get(itemId), completed]);
        }
        for (const [itemRef, completedCents] of patches) transaction.update(itemRef, {
            completedCents, updatedAt: serverTimestamp(), updatedBy: user.uid
        });
        if (!next) transaction.delete(reference);
        else {
            const fields = { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid };
            if (!old) transaction.set(reference, { ...fields, createdAt: serverTimestamp(), createdBy: user.uid });
            else transaction.update(reference, fields);
        }
        transaction.update(walletRef, { updatedAt: serverTimestamp(), lastActivityId: eventRef.id });
        transaction.set(eventRef, { action: "transaction." + action, actorUid: user.uid, actorName: actor.displayName,
            entityType: "transaction", entityId: reference.id, before: old ? snapshot(old) : null,
            after: next ? snapshot(next) : { deleted: true }, createdAt: serverTimestamp() });
    });
    return reference;
}

export async function addSharedTransaction(walletId, form) {
    id(walletId);
    return commit(walletId, "created", null, await convertedForm(walletId, form));
}
export async function updateSharedTransaction(walletId, transactionId, form) {
    id(walletId); id(transactionId);
    return commit(walletId, "updated", transactionId, await convertedForm(walletId, form));
}
export async function deleteSharedTransaction(walletId, transactionId) {
    id(walletId); id(transactionId);
    return commit(walletId, "deleted", transactionId, null);
}
export async function watchSharedTransactions(walletId, onChange, onError) {
    walletId = id(walletId);
    if (typeof onChange !== "function" || typeof onError !== "function") throw new Error("Provide transaction update and error handlers.");
    await getUser();
    let stopped = false;
    const stop = onSnapshot(query(collection(db, "sharedWallets", walletId, "transactions"), orderBy("date", "desc")), records => {
        if (stopped) return;
        try { onChange(records.docs.map(record => { const item = saved(record); return { ...item, id: record.id, amount: item.amountCents / 100 }; })); }
        catch (error) { onError(error); }
    }, error => { if (!stopped) onError(error); });
    return () => { if (!stopped) { stopped = true; stop(); } };
}
