import { db, auth, getUser } from "../core/firebase.js";
import {
    collection, doc, getDoc, onSnapshot, query, where, orderBy, limit,
    runTransaction, writeBatch, serverTimestamp, FieldPath, deleteField, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { reload, onIdTokenChanged }
    from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// Spark uses Firestore directly. Rules check each change together with its
// history entry, so neither write can succeed on its own.
function requiredName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 80) {
        throw new Error("Enter a wallet name with 1–80 characters.");
    }
    return value.trim();
}

function documentId(value, label) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
        throw new Error(`Choose a valid ${label}.`);
    }
    return value.trim();
}

function memberRole(value) {
    if (value !== "member" && value !== "admin") {
        throw new Error("Choose Member or Admin. The creator's position is protected.");
    }
    return value;
}

function assignedCategories(value, role) {
    if (!Array.isArray(value) || value.length > 100) throw new Error("Choose up to 100 assigned categories.");
    const categories = [...new Set(value.map(id => documentId(id, "category")))];
    return role === "admin" ? [] : categories;
}

function profile(user, role, categoryIds = []) {
    if (!user.email) throw new Error("Use an account with an email address for Shared Wallet.");
    return { uid: user.uid, email: user.email.toLowerCase(),
        displayName: (user.displayName || user.email.split("@")[0]).slice(0, 80),
        role, categoryIds, joinedAt: serverTimestamp() };
}

function manager(wallet, user) {
    const member = wallet.members?.[user.uid];
    if (!member || !["creator", "admin"].includes(member.role)) {
        throw new Error("Only the Creator or an Admin can manage this wallet.");
    }
    return member;
}

function activity(reference, actorUid, actorName, action, entityType, entityId, before, after) {
    return { reference, data: { action, actorUid, actorName, entityType, entityId,
        before, after, createdAt: serverTimestamp() } };
}

function auditReference(walletId) { return doc(collection(db, "sharedWallets", walletId, "activity")); }

async function pendingRecords(transaction, wallet) {
    return Promise.all(Object.entries(wallet.pendingInvitations).map(async ([email, id]) => {
        const reference = doc(db, "sharedWalletInvitations", id);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("A pending invitation could not be found. Refresh this page.");
        return { email, reference, data: snapshot.data() };
    }));
}

function readableError(error) {
    const messages = {
        "permission-denied": "This change was not allowed. Refresh the page and check your wallet role. If you are setting up Spark, publish the updated firestore.rules file first.",
        "unavailable": "Check your connection and try again.",
        "resource-exhausted": "Firebase's current usage limit has been reached. Try again later."
    };
    if (!messages[error?.code]) return error;
    const readable = new Error(messages[error.code], { cause: error });
    readable.code = error.code;
    return readable;
}

async function change(operation) {
    try { return await operation(); }
    catch (error) { if (error.sharedInvitationError) throw error; throw readableError(error); }
}

export async function createSharedWallet(name, options = null) {
    name = requiredName(name);
    const currencyFields = options ? { currency: options.currency, showConverted: Boolean(options.showConverted) } : {};
    if (options && (typeof options.currency !== "string" || !/^[A-Z]{3}$/.test(options.currency))) throw new Error("Choose a valid wallet currency.");
    const user = await getUser();
    const reference = doc(collection(db, "sharedWallets"));
    const member = profile(user, "creator");
    const event = activity(auditReference(reference.id), user.uid, member.displayName,
        "wallet.created", "wallet", reference.id, null, { name, ...currencyFields });
    return change(async () => {
        const batch = writeBatch(db);
        batch.set(reference, { name, ...currencyFields, creatorUid: user.uid, members: { [user.uid]: member },
            memberUids: [user.uid], pendingInvitations: {}, lastActivityId: event.reference.id,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(event.reference, event.data);
        await batch.commit();
        return { walletId: reference.id };
    });
}

export async function renameSharedWallet(walletId, name) {
    walletId = documentId(walletId, "wallet");
    name = requiredName(name);
    const user = await getUser();
    const reference = doc(db, "sharedWallets", walletId);
    const eventRef = auditReference(walletId);
    return change(() => runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This wallet no longer exists.");
        const wallet = snapshot.data();
        const actor = manager(wallet, user);
        if (wallet.name === name) return { walletId };
        const invitations = await pendingRecords(transaction, wallet);
        const event = activity(eventRef, user.uid, actor.displayName, "wallet.renamed", "wallet",
            walletId, { name: wallet.name }, { name });
        transaction.update(reference, { name, updatedAt: serverTimestamp(), lastActivityId: eventRef.id });
        for (const invitation of invitations) transaction.update(invitation.reference, { walletName: name });
        transaction.set(eventRef, event.data);
        return { walletId };
    }));
}

export async function inviteSharedWalletMember(walletId, { email, role = "member", categoryIds = [] } = {}) {
    walletId = documentId(walletId, "wallet");
    if (typeof email !== "string" || email.trim().length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("Enter a valid member email address.");
    email = email.trim().toLowerCase();
    role = memberRole(role);
    categoryIds = assignedCategories(categoryIds, role);
    const user = await getUser();
    const reference = doc(db, "sharedWallets", walletId);
    const invitationRef = doc(collection(db, "sharedWalletInvitations"));
    const eventRef = auditReference(walletId);
    return change(() => runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This wallet no longer exists.");
        const wallet = snapshot.data();
        const actor = manager(wallet, user);
        if (Object.values(wallet.members).some(member => member.email === email)) throw new Error("This person is already a wallet member.");
        if (wallet.pendingInvitations[email]) throw new Error("This email already has a pending invitation.");
        if (Object.keys(wallet.pendingInvitations).length >= 100) throw new Error("This wallet has 100 pending invitations already.");
        if (wallet.memberUids.length >= 100) throw new Error("This wallet already has 100 members.");
        const invitation = { walletId, walletName: wallet.name, inviterUid: user.uid,
            inviterName: actor.displayName, inviterJoinedAt: actor.joinedAt,
            recipientEmail: email, recipientUid: null, role, categoryIds,
            status: "pending", createdAt: serverTimestamp(), respondedAt: null };
        const event = activity(eventRef, user.uid, actor.displayName, "member.invited", "invitation",
            invitationRef.id, null, { recipientEmail: email, role, categoryIds });
        transaction.set(invitationRef, invitation);
        transaction.update(reference, new FieldPath("pendingInvitations", email), invitationRef.id,
            "updatedAt", serverTimestamp(), "lastActivityId", eventRef.id);
        transaction.set(eventRef, event.data);
        return { invitationId: invitationRef.id };
    }));
}

async function invitationAccount() {
    const user = await getUser();
    await reload(user);
    await user.getIdToken(true);
    if (auth.currentUser?.uid !== user.uid) throw new Error("Your account changed. Sign in again.");
    if (!user.email) throw new Error("Use an account with an email address to respond to invitations.");
    return user;
}

export async function respondSharedWalletInvitation(invitationId, accept) {
    invitationId = documentId(invitationId, "invitation");
    if (typeof accept !== "boolean") throw new Error("Choose Accept or Decline for this invitation.");
    const user = await invitationAccount();
    const invitationRef = doc(db, "sharedWalletInvitations", invitationId);
    return change(async () => {
        const snapshot = await getDoc(invitationRef);
        if (!snapshot.exists()) throw new Error("This invitation no longer exists.");
        const invitation = snapshot.data();
        if (invitation.status !== "pending") throw new Error("This invitation has already been resolved.");
        if (invitation.recipientEmail !== user.email?.toLowerCase()) throw new Error("This invitation belongs to another email address.");
        const reference = doc(db, "sharedWallets", invitation.walletId);
        const status = accept ? "accepted" : "declined";
        const member = profile(user, invitation.role, invitation.categoryIds);
        const after = accept ? { status, memberId: user.uid, role: invitation.role,
            categoryIds: invitation.categoryIds } : { status, memberId: user.uid };
        const event = activity(auditReference(invitation.walletId), user.uid, member.displayName,
            "invitation." + status, "invitation", invitationId, { status: "pending" }, after);
        // Invitees cannot read the wallet before joining. FieldPath preserves
        // other members; rules validate the complete resulting wallet.
        const changes = [new FieldPath("pendingInvitations", invitation.recipientEmail), deleteField(),
            "updatedAt", serverTimestamp(), "lastActivityId", event.reference.id];
        if (accept) changes.push(new FieldPath("members", user.uid), member, "memberUids", arrayUnion(user.uid));
        const batch = writeBatch(db);
        batch.update(reference, ...changes);
        batch.update(invitationRef, { status, recipientUid: user.uid, respondedAt: serverTimestamp() });
        batch.set(event.reference, event.data);
        try { await batch.commit(); }
        catch (error) {
            if (error.code === "permission-denied") {
                const readable = new Error("This invitation can no longer be used. It may have been resolved or the inviter's access changed. Refresh your invitations.", { cause: error });
                readable.code = error.code;
                readable.sharedInvitationError = true;
                throw readable;
            }
            throw error;
        }
        return { walletId: invitation.walletId, status };
    });
}

export async function setSharedWalletMemberRole(walletId, memberId, role, categoryIds = [], expectedRole = null) {
    walletId = documentId(walletId, "wallet");
    memberId = documentId(memberId, "member");
    role = memberRole(role);
    categoryIds = assignedCategories(categoryIds, role);
    const user = await getUser();
    const reference = doc(db, "sharedWallets", walletId);
    const eventRef = auditReference(walletId);
    return change(() => runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This wallet no longer exists.");
        const wallet = snapshot.data();
        const actor = manager(wallet, user);
        const member = wallet.members[memberId];
        if (!member || memberId === wallet.creatorUid) throw new Error("Choose a member other than the protected Creator.");
        if (expectedRole && member.role !== expectedRole) throw new Error("This member's position changed. Refresh before assigning categories.");
        const event = activity(eventRef, user.uid, actor.displayName, "member.role-updated", "member", memberId,
            { role: member.role, categoryIds: member.categoryIds }, { role, categoryIds });
        transaction.update(reference, new FieldPath("members", memberId), { ...member, role, categoryIds },
            "updatedAt", serverTimestamp(), "lastActivityId", eventRef.id);
        transaction.set(eventRef, event.data);
        return { walletId };
    }));
}

export async function setSharedWalletMemberCategories(walletId, memberId, categoryIds) {
    return setSharedWalletMemberRole(walletId, memberId, "member", categoryIds, "member");
}

export async function removeSharedWalletMember(walletId, memberId) {
    walletId = documentId(walletId, "wallet");
    memberId = documentId(memberId, "member");
    const user = await getUser();
    const reference = doc(db, "sharedWallets", walletId);
    const eventRef = auditReference(walletId);
    return change(() => runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This wallet no longer exists.");
        const wallet = snapshot.data();
        const actor = manager(wallet, user);
        const member = wallet.members[memberId];
        if (!member || memberId === wallet.creatorUid) throw new Error("Choose a member other than the protected Creator.");
        const invitations = (await pendingRecords(transaction, wallet))
            .filter(invitation => invitation.data.inviterUid === memberId || invitation.email === member.email);
        const members = { ...wallet.members };
        delete members[memberId];
        const pendingInvitations = { ...wallet.pendingInvitations };
        for (const invitation of invitations) delete pendingInvitations[invitation.email];
        const event = activity(eventRef, user.uid, actor.displayName, "member.removed", "member", memberId,
            { displayName: member.displayName, role: member.role },
            { removed: true, revokedEmails: invitations.map(invitation => invitation.email) });
        transaction.update(reference, { members, memberUids: wallet.memberUids.filter(id => id !== memberId),
            pendingInvitations, updatedAt: serverTimestamp(), lastActivityId: eventRef.id });
        for (const invitation of invitations) transaction.update(invitation.reference, { status: "revoked", respondedAt: serverTimestamp() });
        transaction.set(eventRef, event.data);
        return { walletId };
    }));
}

function callbacks(onChange, onError) {
    if (typeof onChange !== "function" || typeof onError !== "function") throw new Error("Provide Shared Wallet update and error handlers.");
}

function listen(reference, onChange, onError, mapSnapshot) {
    let stopped = false;
    const stop = onSnapshot(reference, snapshot => {
        if (stopped) return;
        try { onChange(mapSnapshot(snapshot)); }
        catch (error) { onError(error); }
    }, error => { if (!stopped) onError(readableError(error)); });
    return () => { if (!stopped) { stopped = true; stop(); } };
}

const documents = snapshot => snapshot.docs.map(record => ({ ...record.data(), id: record.id }));

export async function watchSharedWallets(onChange, onError) {
    callbacks(onChange, onError);
    const user = await getUser();
    return listen(query(collection(db, "sharedWallets"), where("memberUids", "array-contains", user.uid)),
        onChange, onError, snapshot => documents(snapshot).map(wallet => ({ ...wallet,
            role: wallet.members[user.uid].role, joinedAt: wallet.members[user.uid].joinedAt,
            memberCount: wallet.memberUids.length })));
}

export async function watchSharedWalletMembers(walletId, onChange, onError) {
    walletId = documentId(walletId, "wallet");
    callbacks(onChange, onError);
    await getUser();
    return listen(doc(db, "sharedWallets", walletId), onChange, onError, snapshot =>
        snapshot.exists() ? Object.entries(snapshot.data().members).map(([id, member]) => ({ ...member, id })) : []);
}

export async function watchSharedWalletInvitations(onChange, onError, { includeResolved = false } = {}) {
    callbacks(onChange, onError);
    const user = await getUser();
    let stopped = false;
    let stopFeed = () => {};
    let generation = 0;
    const stopToken = onIdTokenChanged(auth, account => {
        if (stopped) return;
        stopFeed();
        const current = ++generation;
        if (account?.uid !== user.uid || !account.email) { onChange([]); return; }
        stopFeed = listen(query(collection(db, "sharedWalletInvitations"),
            where("recipientEmail", "==", account.email.toLowerCase()),
            ...(includeResolved ? [] : [where("status", "==", "pending")])),
        records => { if (!stopped && generation === current) onChange(records); },
        error => { if (!stopped && generation === current) onError(error); }, documents);
    }, error => { if (!stopped) onError(error); });
    return () => { if (!stopped) { stopped = true; generation++; stopFeed(); stopToken(); } };
}

export async function watchSharedWalletActivity(walletId, onChange, onError, { all = false } = {}) {
    walletId = documentId(walletId, "wallet");
    callbacks(onChange, onError);
    await getUser();
    return listen(query(collection(db, "sharedWallets", walletId, "activity"),
        orderBy("createdAt", "desc"), ...(all ? [] : [limit(50)])), onChange, onError, documents);
}
