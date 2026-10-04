import { db, getUser } from "../core/firebase.js";
import { getTransactionType, parseTransactionInput } from "./transaction-model.js";
import {
    collection,
    doc,
    runTransaction,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

function documentId(value) {
    if (typeof value !== "string" || !value || value.includes("/")
        || value === "." || value === ".." || value.length > 1500) {
        throw new Error("Choose a valid transaction or category.");
    }
    return value;
}

function integerCents(value, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error("The saved amount is outside the allowed range.");
    }
    return value;
}

function typeFor(value) {
    const type = getTransactionType(value);
    if (!type) {
        throw new Error("Choose a valid transaction type.");
    }
    return type;
}

function readForm(form) {
    const data = form instanceof FormData ? form : new FormData(form);
    const input = parseTransactionInput(Object.fromEntries(data));
    const type = typeFor(input.type);
    if (type.moneyKind) documentId(input.itemId);
    return input;
}

function readSaved(snapshot) {
    if (!snapshot.exists()) {
        throw new Error("This transaction no longer exists. Refresh and try again.");
    }
    const saved = snapshot.data();
    const type = typeFor(saved.type);
    integerCents(saved.amountCents, 1);
    if (type.moneyKind) documentId(saved.itemId);
    return saved;
}

function normalize(snapshot) {
    const saved = snapshot.data();
    typeFor(saved.type);
    integerCents(saved.amountCents, 1);
    return { ...saved, id: snapshot.id, amount: saved.amountCents / 100 };
}

// Ledger changes and card progress share one commit. Firestore retries this callback
// when another transaction changes a category after we read it.
async function commit(change, id, input) {
    const user = await getUser();
    const ledger = collection(db, "users", user.uid, "transactions");
    const reference = change === "add" ? doc(ledger) : doc(ledger, documentId(id));

    await runTransaction(db, async transaction => {
        const old = change === "add"
            ? null
            : readSaved(await transaction.get(reference));
        const oldType = old ? typeFor(old.type) : null;
        const nextType = input ? typeFor(input.type) : null;
        const references = new Map();

        if (oldType?.progress) {
            references.set(old.itemId, doc(db, "users", user.uid, "moneyItems", old.itemId));
        }
        if (nextType?.moneyKind) {
            references.set(input.itemId, doc(db, "users", user.uid, "moneyItems", input.itemId));
        }

        // Complete every read before preparing any writes.
        const items = new Map();
        for (const [itemId, itemRef] of references) {
            const snapshot = await transaction.get(itemRef);
            if (snapshot.exists()) items.set(itemId, snapshot.data());
        }

        if (nextType?.moneyKind) {
            const target = items.get(input.itemId);
            if (!target) throw new Error("The selected category no longer exists. Choose another category.");
            if (target.kind !== nextType.moneyKind) {
                throw new Error("The selected category does not match this transaction type.");
            }
        }

        const deltas = new Map();
        function addDelta(itemId, value) {
            const delta = (deltas.get(itemId) || 0) + value;
            if (!Number.isSafeInteger(delta)) {
                throw new Error("The transaction amount is outside the allowed range.");
            }
            deltas.set(itemId, delta);
        }

        // A deleted category has no progress left to reverse. Never recreate it.
        if (oldType?.progress && items.has(old.itemId)) {
            if (items.get(old.itemId).kind !== oldType.moneyKind) {
                throw new Error("The original category no longer matches this transaction.");
            }
            addDelta(old.itemId, -old.amountCents);
        }
        if (nextType?.progress) addDelta(input.itemId, input.amountCents);

        const patches = [];
        for (const [itemId, delta] of deltas) {
            const item = items.get(itemId);
            const completed = integerCents(item.completedCents ?? 0);
            const limit = integerCents(item.amountCents, 1);
            const next = completed + delta;
            if (!Number.isSafeInteger(next) || next < 0) {
                throw new Error("This change would make the category's completed amount negative.");
            }
            if (item.kind !== "budget" && next > limit) {
                throw new Error("This transaction would exceed the category's target or remaining balance.");
            }
            if (delta) patches.push([references.get(itemId), { completedCents: next }]);
        }

        // Validation above completes before the first write, so failures change nothing.
        for (const [itemRef, patch] of patches) transaction.update(itemRef, patch);

        if (change === "delete") {
            transaction.delete(reference);
        } else {
            const fields = {
                ...input,
                itemId: nextType.moneyKind ? input.itemId : null,
                itemName: nextType.moneyKind ? String(items.get(input.itemId).name || nextType.label) : null,
                updatedAt: serverTimestamp()
            };
            if (change === "add") {
                transaction.set(reference, { ...fields, createdAt: serverTimestamp() });
            } else {
                // Updating fields preserves the original createdAt and any unrelated fields.
                transaction.update(reference, fields);
            }
        }
    });

    return reference;
}

export async function addTransaction(form) {
    await globalThis.window?.CurrencyDisplay?.ensurePrimary();
    return commit("add", null, readForm(form));
}

export async function updateTransaction(id, form) {
    documentId(id);
    return commit("update", id, readForm(form));
}

export async function deleteTransaction(id) {
    documentId(id);
    return commit("delete", id, null);
}

export async function watchTransactions(onChange, onError) {
    try {
        const user = await getUser();
        const ledger = collection(db, "users", user.uid, "transactions");
        return onSnapshot(query(ledger, orderBy("date", "desc")), snapshot => {
            try {
                onChange(snapshot.docs.map(normalize));
            } catch (error) {
                onError(error);
            }
        }, onError);
    } catch (error) {
        onError(error);
        return () => {};
    }
}
