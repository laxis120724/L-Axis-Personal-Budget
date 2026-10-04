import { db, getUser } from "../core/firebase.js";

import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const amountFields = {
    budget: "amount",
    savings: "target",
    debt: "amount",
    lend: "amount",
    subscriptions: "amount"
};

const completedFields = {
    savings: "saved",
    debt: "paid",
    lend: "repaid"
};

// Parse the decimal text directly into integer cents.
function cents(value, minimum = 0) {
    const text = String(value ?? "").trim();

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        throw new Error("Enter an amount with at most two decimal places.");
    }

    const [whole, fraction = ""] = text.split(".");
    const result = Number(whole) * 100
        + Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(result) || result < minimum) {
        throw new Error("The amount is outside the allowed range.");
    }

    return result;
}

export function readMoneyForm(kind, form) {
    if (!Object.hasOwn(amountFields, kind)) {
        throw new Error("Unknown money category.");
    }

    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();

    if (!name || name.length > 80) {
        throw new Error("Enter a name with 1–80 characters.");
    }

    if (description.length > 2000) {
        throw new Error("Keep the description within 2,000 characters.");
    }

    const amountCents = cents(data.get(amountFields[kind]), 1);
    const completedField = completedFields[kind];
    const completedCents = completedField
        ? cents(data.get(completedField))
        : 0;

    if (completedCents > amountCents) {
        throw new Error("The completed amount cannot exceed the target.");
    }

    const details = Object.fromEntries(data);

    // Common information and money values have their own fields.
    for (const key of [
        "name", "description", "alerts", "amount",
        "target", "saved", "paid", "repaid", "payment"
    ]) {
        delete details[key];
    }

    if (kind === "budget"
        && !["weekly", "monthly", "yearly"].includes(details.period)) {
        throw new Error("Choose a valid budget period.");
    }

    if (kind === "debt" || kind === "lend") {
        const person = kind === "debt"
            ? details.creditor
            : details.borrower;

        if (!String(person ?? "").trim()) {
            throw new Error("Enter the creditor or borrower name.");
        }
    }

    if (kind === "debt") {
        const payment = String(data.get("payment") ?? "").trim();
        details.paymentCents = payment ? cents(payment) : null;
    }

    if (kind === "subscriptions") {
        if (!["weekly", "monthly", "quarterly", "yearly"]
            .includes(details.cycle)) {
            throw new Error("Choose a valid billing cycle.");
        }

        details.autoRenew = data.has("autoRenew");
    }

    const start = details.startDate || details.start || details.lentDate;
    const end = details.targetDate || details.due || details.nextPaymentDate;

    if (!start) {
        throw new Error("Choose a starting date.");
    }

    if (end && end < start) {
        throw new Error("The end or payment date cannot precede the start.");
    }

    return {
        kind,
        name,
        amountCents,
        completedCents,
        description,
        alerts: data.has("alerts"),
        favorite: false,
        details
    };
}

export function normalizeMoneyItem(document) {
    const item = document.data();
    const amount = item.amountCents / 100;

    return {
        ...item,
        id: document.id,
        amount,
        cycle: item.details.cycle,
        total: item.kind === "subscriptions"
            ? window.MyMoneyOverview.monthlyEquivalent(
                amount, item.details.cycle
            )
            : amount,
        completed: item.completedCents / 100
    };
}

export async function addMoneyItem(kind, form) {
    await globalThis.window?.CurrencyDisplay?.ensurePrimary();
    const item = readMoneyForm(kind, form);
    const user = await getUser();

    return addDoc(collection(db, "users", user.uid, "moneyItems"), {
        ...item,
        createdAt: serverTimestamp()
    });
}

export async function setMoneyFavorite(id, favorite) {
    const user = await getUser();

    return updateDoc(
        doc(db, "users", user.uid, "moneyItems", id),
        { favorite }
    );
}

export async function updateMoneyItem(kind, id, form) {
    const { name, amountCents, completedCents, description, alerts, details } = readMoneyForm(kind, form);
    const patch = { name, amountCents, description, alerts, details };
    if (Object.hasOwn(completedFields, kind)) patch.completedCents = completedCents;
    const user = await getUser();

    // Only goals and repayments expose an editable completed amount in their forms.
    // Every edit preserves the item's kind, favorite, and original creation date.
    return updateDoc(
        doc(db, "users", user.uid, "moneyItems", id),
        patch
    );
}

export async function deleteMoneyItem(id) {
    const user = await getUser();

    return deleteDoc(doc(db, "users", user.uid, "moneyItems", id));
}

export async function setMoneyAlerts(id, enabled) {
    const user = await getUser();

    return updateDoc(
        doc(db, "users", user.uid, "moneyItems", id),
        { alerts: Boolean(enabled) }
    );
}

export async function watchMoneyItems(onChange, onError) {
    const user = await getUser();
    const items = collection(db, "users", user.uid, "moneyItems");
    const orderedItems = query(items, orderBy("createdAt", "asc"));

    return onSnapshot(orderedItems, snapshot => {
        try {
            onChange(snapshot.docs.map(normalizeMoneyItem));
        } catch (error) {
            onError(error);
        }
    }, onError);
}
