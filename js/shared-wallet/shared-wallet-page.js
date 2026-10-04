// The shared store supplies records; this controller owns display and forms.
export function initializeSharedWallet(root, signal, {
    title = "Shared Wallet", section = "overview", user = {}, services = {},
    onSelect = () => {}, onCreated = () => {}
} = {}) {
    const find = selector => root.querySelector(selector);
    const select = find("[data-shared-wallet-select]");
    const message = find("[data-shared-wallet-message]");
    const createDialog = find("[data-shared-wallet-create-dialog]");
    const renameDialog = find("[data-shared-wallet-rename-dialog]");
    const inviteDialog = find("[data-shared-wallet-invite-dialog]");
    const removeDialog = find("[data-shared-wallet-remove-dialog]");
    const accessDialog = find("[data-shared-wallet-access-dialog]");
    const createForm = find("[data-shared-wallet-create-form]");
    const renameForm = find("[data-shared-wallet-rename-form]");
    const inviteForm = find("[data-shared-wallet-invite-form]");
    const removeForm = find("[data-shared-wallet-remove-form]");
    const accessForm = find("[data-shared-wallet-access-form]");
    const dialogs = [createDialog, renameDialog, inviteDialog, removeDialog, accessDialog];
    const active = () => !signal.aborted && root.isConnected;
    let wallets = [], selectedId = "", members = null, activity = null;
    let membersError = "", activityError = "", pending = false, removeTarget = null;
    let moneyItems = null, moneyError = "", accessTarget = null;
    const selectedWallet = () => wallets.find(wallet => wallet.id === selectedId);
    const canManage = () => ["creator", "admin"].includes(selectedWallet()?.role);
    const roleLabel = role => ({ creator: "Creator", admin: "Admin", member: "Member" }[role] || "Member");
    const field = (form, name) => form.elements.namedItem(name);
    find("[data-shared-wallet-title]").textContent = title;
    root.dataset.sharedSection = section;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function dateLabel(value, detailed = false) {
        const date = value?.toDate ? value.toDate()
            : value?.seconds !== undefined ? new Date(value.seconds * 1000)
                : value ? new Date(value) : null;
        return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined,
            detailed ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                : { year: "numeric", month: "short", day: "numeric" }) : "—";
    }

    function showMessage(text = "", error = false) {
        message.textContent = text;
        message.hidden = !text;
        message.dataset.error = String(error);
    }

    function errorMessage(error) {
        if (typeof error === "string") return error;
        if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") {
            return "You do not have permission for this change. Check your wallet position and try again.";
        }
        if (error?.code === "unavailable" || error?.code === "firestore/unavailable") {
            return "We couldn’t connect. Check your connection and try again.";
        }
        return error?.message || "We couldn’t save this change. Please try again.";
    }

    function lockControls() {
        root.querySelectorAll("button, input, select").forEach(control => {
            if (!control.closest("[data-shared-money-container], [data-shared-transaction-container], [data-shared-overview-container], [data-shared-wallet-page-actions]")) control.disabled = pending;
        });
        select.disabled = pending || !wallets.length;
        root.querySelectorAll("[data-shared-wallet-member-access]").forEach(button => {
            button.disabled = pending || moneyItems === null || Boolean(moneyError);
        });
        accessForm.querySelector("[data-shared-wallet-submit]").disabled = pending || moneyItems === null || Boolean(moneyError);
    }

    function openDialog(dialog, form) {
        if (!active() || pending) return;
        form.reset();
        if (form === createForm && field(form, "currency")) field(form, "currency").value = globalThis.window?.CurrencyDisplay?.get().currency || "AED";
        const error = form.querySelector("[data-shared-wallet-form-error]");
        error.hidden = true;
        error.textContent = "";
        if (!dialog.open) dialog.showModal();
    }

    // Values are captured first: disabled controls are excluded from form data.
    async function save({ form, operation, success, label }) {
        if (pending || !active()) return;
        pending = true;
        const error = form?.querySelector("[data-shared-wallet-form-error]");
        if (error) { error.hidden = true; error.textContent = ""; }
        else showMessage();
        const button = form?.querySelector("[data-shared-wallet-submit]");
        const originalLabel = button?.textContent;
        if (button) button.textContent = label;
        lockControls();
        try {
            const result = await operation();
            if (active()) success(result);
        } catch (failure) {
            if (active()) {
                if (error) { error.textContent = errorMessage(failure); error.hidden = false; }
                else showMessage(errorMessage(failure), true);
            }
        } finally {
            pending = false;
            if (active()) {
                if (button) button.textContent = originalLabel;
                lockControls();
            }
        }
    }

    function validName(form) {
        const name = field(form, "name").value.trim();
        if (!name || name.length > 80) {
            const error = form.querySelector("[data-shared-wallet-form-error]");
            error.textContent = "Enter a wallet name of 1 to 80 characters.";
            error.hidden = false;
            return null;
        }
        return form.reportValidity() ? name : null;
    }

    function renderSelection() {
        const wallet = selectedWallet();
        find("[data-shared-wallet-empty]").hidden = Boolean(wallet);
        find("[data-shared-wallet-content]").hidden = !wallet;
        if (!wallet) return;
        root.dataset.currency = wallet.currency || "AED";
        root.dataset.sharedCurrency = "true";
        root.dataset.showConverted = String(globalThis.window?.CurrencyDisplay?.walletConverted(wallet) ?? Boolean(wallet.showConverted));
        globalThis.window?.CurrencyDisplay?.refresh();
        find("[data-shared-wallet-name]").textContent = wallet.name;
        find("[data-shared-wallet-role]").textContent = roleLabel(wallet.role);
        find("[data-shared-wallet-member-count]").textContent = members ? String(members.length)
            : Number.isInteger(wallet.memberCount) ? String(wallet.memberCount) : "—";
        find("[data-shared-wallet-created]").textContent = dateLabel(wallet.joinedAt);
        const info = section === "info";
        const currencyPanel = find("[data-shared-wallet-currency-panel]");
        if (currencyPanel) {
            currencyPanel.hidden = !info;
            find("[data-shared-wallet-currency]").textContent = root.dataset.currency;
            find("[data-shared-wallet-converted]").checked = root.dataset.showConverted === "true";
        }
        const summary = section === "overview" || info;
        find("[data-shared-wallet-context]").hidden = !summary;
        find(".shared-wallet-summary").hidden = !summary;
        find("[data-shared-wallet-overview]").hidden = !summary;
        if (!canManage()) for (const dialog of [renameDialog, inviteDialog, removeDialog, accessDialog]) {
            if (dialog.open) dialog.close();
        }
        find("[data-shared-wallet-rename]").hidden = !info || !canManage();
        find("[data-shared-wallet-invite]").hidden = !canManage();
        find("[data-shared-wallet-info]").hidden = !info;
        find("[data-shared-wallet-activity-section]").hidden = !info;
        find("[data-shared-wallet-permissions]").textContent = "Only Creator and Admin can manage members and category access.";
    }

    function renderMemberTable() {
        const body = find("[data-shared-wallet-members]");
        const status = find("[data-shared-wallet-members-state]");
        body.replaceChildren();
        status.textContent = membersError || (members === null ? "Loading members…" : "No members to show.");
        status.dataset.error = String(Boolean(membersError));
        status.hidden = !membersError && Boolean(members?.length);
        find("[data-shared-wallet-members-table]").hidden = Boolean(membersError) || !members?.length;
        if (!members || membersError) return;
        for (const member of members) {
            const row = element("tr");
            const identity = element("td");
            identity.append(element("strong", "shared-wallet-member-name", member.name || member.displayName || member.email || "Member"),
                element("span", "shared-wallet-member-email", member.email || ""));
            const position = element("td");
            const memberId = member.id || member.uid;
            const memberName = member.name || member.displayName || member.email || "member";
            const editable = canManage() && member.role !== "creator";
            const actions = element("td", "shared-wallet-member-actions");
            const categories = member.categoryIds || [];
            const accessText = member.role === "member" ? categories.length
                ? categories.length + " assigned " + (categories.length === 1 ? "category" : "categories") : "No categories assigned"
                : "All categories";
            const access = element("td", "shared-wallet-member-access");
            const accessControls = element("div", "shared-wallet-access-controls");
            accessControls.append(element("span", "", accessText));
            access.append(accessControls);
            if (editable) {
                const role = element("select", "shared-wallet-member-role");
                role.setAttribute("aria-label", "Position for " + memberName);
                for (const value of ["member", "admin"]) {
                    const option = element("option", "", roleLabel(value));
                    option.value = value;
                    role.append(option);
                }
                role.value = member.role;
                const update = element("button", "money-button money-button--secondary shared-wallet-member-control", "Save");
                update.setAttribute("type", "button");
                update.setAttribute("aria-label", "Save position for " + memberName);
                update.setAttribute("data-shared-wallet-role-save", memberId);
                update.addEventListener("click", () => {
                    if (pending || !canManage() || role.value === member.role) return;
                    const walletId = selectedId, nextRole = role.value;
                    if (!["member", "admin"].includes(nextRole)) return;
                    const categoryIds = nextRole === "admin" ? [] : [...(member.categoryIds || [])];
                    void save({ operation: () => services.setSharedWalletMemberRole(walletId, memberId, nextRole, categoryIds),
                        success: () => { showMessage("Member position updated."); } });
                }, { signal });
                const remove = element("button", "shared-wallet-remove");
                remove.setAttribute("type", "button");
                remove.setAttribute("aria-label", "Remove " + memberName + " from wallet");
                remove.setAttribute("title", "Remove member");
                const deleteIcon = element("img");
                deleteIcon.setAttribute("src", "assets/icons/delete.svg");
                deleteIcon.setAttribute("alt", "");
                deleteIcon.setAttribute("aria-hidden", "true");
                deleteIcon.setAttribute("width", "18");
                deleteIcon.setAttribute("height", "18");
                remove.append(deleteIcon);
                remove.setAttribute("data-shared-wallet-member-remove", memberId);
                remove.addEventListener("click", () => {
                    if (pending || !canManage()) return;
                    removeTarget = { id: memberId, walletId: selectedId };
                    find("[data-shared-wallet-remove-name]").textContent = memberName;
                    openDialog(removeDialog, removeForm);
                }, { signal });
                const positionControls = element("div", "shared-wallet-position-controls");
                positionControls.append(role, update);
                position.append(positionControls);
                actions.append(remove);
                if (member.role === "member") {
                    const assign = element("button", "money-button money-button--secondary shared-wallet-member-control", "Assign categories");
                    assign.setAttribute("type", "button");
                    assign.setAttribute("aria-label", "Assign categories for " + memberName);
                    assign.setAttribute("data-shared-wallet-member-access", memberId);
                    assign.addEventListener("click", () => {
                        if (pending || !canManage() || moneyItems === null || moneyError) return;
                        accessTarget = { id: memberId, walletId: selectedId };
                        find("[data-shared-wallet-category-options]").dataset.memberId = "";
                        find("[data-shared-wallet-access-name]").textContent = member.displayName || member.name || member.email || "This member";
                        openDialog(accessDialog, accessForm);
                        renderCategoryChoices();
                    }, { signal });
                    accessControls.append(assign);
                }
            } else {
                position.append(element("span", "shared-wallet-role-badge", roleLabel(member.role)));
                actions.append(element("span", "shared-wallet-member-status", member.role === "creator" ? "Protected" : "—"));
            }
            row.append(identity, position, access, actions);
            body.append(row);
        }
        lockControls();
    }

    function renderCategoryChoices() {
        const options = find("[data-shared-wallet-category-options]");
        const checked = accessDialog.open
            ? [...options.querySelectorAll("input")].filter(input => input.checked).map(input => input.value) : [];
        const previous = options.dataset.memberId === accessTarget?.id;
        options.replaceChildren();
        const member = members?.find(member => (member.id || member.uid) === accessTarget?.id);
        const selected = new Set(previous ? checked : member?.categoryIds || []);
        options.dataset.memberId = accessTarget?.id || "";
        const labels = { budget: "Budget", savings: "Goal", debt: "Debt", lend: "Loan", subscriptions: "Subscription" };
        if (!moneyItems?.length || moneyError) {
            options.append(element("p", "money-empty", moneyError || "No categories yet. Create a category in one of the shared sections first."));
        }
        for (const item of moneyItems || []) {
            const label = element("label", "shared-wallet-category-choice");
            const input = element("input");
            input.setAttribute("type", "checkbox");
            input.setAttribute("name", "categoryIds");
            input.value = item.id;
            input.checked = selected.has(item.id);
            label.append(input, element("span", "", (labels[item.kind] || "Category") + " · " + item.name));
            options.append(label);
        }
        lockControls();
    }

    function renderHistory() {
        const list = find("[data-shared-wallet-activity]");
        const status = find("[data-shared-wallet-activity-state]");
        list.replaceChildren();
        status.textContent = activityError || (activity === null ? "Loading history…" : "No wallet activity yet.");
        status.dataset.error = String(Boolean(activityError));
        status.hidden = !activityError && Boolean(activity?.length);
        list.hidden = Boolean(activityError) || !activity?.length;
        if (!activity || activityError) return;
        const labels = { "wallet.created": "created the wallet", "wallet.renamed": "renamed the wallet", "member.invited": "sent a member invitation",
            "invitation.accepted": "accepted an invitation", "invitation.declined": "declined an invitation", "member.role-updated": "updated a member position or category access", "member.removed": "removed a member",
            "category.created": "created a category", "category.updated": "edited a category", "category.deleted": "deleted a category", "category.favorite-updated": "changed a category favorite", "category.alerts-updated": "changed category notifications",
            "transaction.created": "recorded a transaction", "transaction.updated": "edited a transaction", "transaction.deleted": "deleted a transaction",
            created: "created the wallet", wallet_created: "created the wallet", renamed: "renamed the wallet", wallet_renamed: "renamed the wallet",
            invited: "sent a member invitation", member_invited: "sent a member invitation", invitation_accepted: "accepted an invitation", invitation_declined: "declined an invitation",
            role_changed: "updated a member position", member_role_changed: "updated a member position", member_removed: "removed a member" };
        for (const event of activity) {
            const row = element("li");
            const details = element("p");
            details.append(element("strong", "", event.actorName || "Member"), " " + (labels[event.action] || String(event.action || "updated the wallet").replace(/[_.-]+/g, " ")));
            const targetName = event.targetName || (event.entityType === "moneyItem" ? event.after?.name || event.before?.name : "");
            if (targetName) details.append(" · " + targetName);
            if (event.entityType === "transaction") {
                const record = event.action === "transaction.deleted" ? event.before : event.after;
                details.append(" · " + (record?.ownerName || "Member") + " · " + ((record?.amountCents || 0) / 100).toLocaleString(undefined, {
                    minimumFractionDigits: 2, maximumFractionDigits: 2
                }));
            }
            row.append(details, element("time", "", dateLabel(event.createdAt, true)));
            list.append(row);
        }
    }

    find("[data-shared-wallet-converted]")?.addEventListener("change", event => {
        const wallet = selectedWallet(); if (!wallet) return;
        const enabled = event.target.checked;
        globalThis.window?.CurrencyDisplay?.setWalletConverted(wallet, enabled);
        root.dataset.showConverted = String(enabled);
        globalThis.window?.CurrencyDisplay?.refresh();
    }, { signal });
    select.addEventListener("change", () => {
        if (pending) return;
        selectedId = select.value;
        members = null; activity = null; membersError = ""; activityError = "";
        showMessage(); renderSelection(); renderMemberTable(); renderHistory();
        onSelect(selectedId);
    }, { signal });
    find("[data-shared-wallet-add]").addEventListener("click", () => openDialog(createDialog, createForm), { signal });
    find("[data-shared-wallet-rename]").addEventListener("click", () => {
        if (!canManage() || pending) return;
        openDialog(renameDialog, renameForm);
        field(renameForm, "name").value = selectedWallet().name;
    }, { signal });
    find("[data-shared-wallet-invite]").addEventListener("click", () => {
        if (canManage()) openDialog(inviteDialog, inviteForm);
    }, { signal });
    for (const dialog of dialogs) {
        dialog.querySelectorAll("[data-shared-wallet-close]").forEach(button => button.addEventListener("click", () => {
            if (!pending) dialog.close();
        }, { signal }));
        dialog.addEventListener("cancel", event => { if (pending) event.preventDefault(); }, { signal });
    }
    const currencySelect = field(createForm, "currency");
    if (currencySelect && globalThis.window?.CurrencyDisplay) {
        currencySelect.value = globalThis.window?.CurrencyDisplay.get().currency;
        globalThis.window?.CurrencyDisplay.currencies().then(rows => {
            if (!active()) return;
            const selected = currencySelect.value;
            currencySelect.replaceChildren(...rows.map(row => { const option = document.createElement("option"); option.value = row.code; option.textContent = row.code + " — " + row.name; return option; }));
            currencySelect.value = selected;
        }).catch(() => {});
    }
    createForm.addEventListener("submit", event => {
        event.preventDefault();
        if (pending) return;
        const name = validName(createForm);
        if (!name) return;
        const currencyOptions = currencySelect ? { currency: currencySelect.value,
            showConverted: field(createForm, "showConverted").checked } : null;
        void save({ form: createForm, label: "Creating…", operation: () => currencyOptions ? services.createSharedWallet(name, currencyOptions) : services.createSharedWallet(name),
            success: result => { createDialog.close(); createForm.reset(); showMessage("Shared wallet created."); onCreated(result.walletId); } });
    }, { signal });
    renameForm.addEventListener("submit", event => {
        event.preventDefault();
        if (pending || !canManage()) return;
        const walletId = selectedId, name = validName(renameForm);
        if (!name) return;
        void save({ form: renameForm, label: "Renaming…", operation: () => services.renameSharedWallet(walletId, name),
            success: () => { renameDialog.close(); showMessage("Wallet name updated."); } });
    }, { signal });
    inviteForm.addEventListener("submit", event => {
        event.preventDefault();
        if (pending || !canManage()) return;
        const walletId = selectedId, email = field(inviteForm, "email").value.trim().toLowerCase(), role = field(inviteForm, "role").value;
        if (!email || !["member", "admin"].includes(role) || !inviteForm.reportValidity()) return;
        if (email === String(user.email || "").toLowerCase()) {
            const error = inviteForm.querySelector("[data-shared-wallet-form-error]");
            error.textContent = "You already belong to this wallet. Invite someone else."; error.hidden = false;
            return;
        }
        void save({ form: inviteForm, label: "Sending…", operation: () => services.inviteSharedWalletMember(walletId, { email, role, categoryIds: [] }),
            success: () => { inviteDialog.close(); inviteForm.reset(); showMessage("Invitation sent. They can accept or decline it in their notifications."); } });
    }, { signal });
    removeForm.addEventListener("submit", event => {
        event.preventDefault();
        if (pending || !canManage() || !removeTarget) return;
        const target = { ...removeTarget };
        void save({ form: removeForm, label: "Removing…", operation: () => services.removeSharedWalletMember(target.walletId, target.id),
            success: () => { removeDialog.close(); removeTarget = null; showMessage("Member removed. Their recorded history remains."); } });
    }, { signal });
    accessForm.addEventListener("submit", event => {
        event.preventDefault();
        if (pending || !canManage() || !accessTarget || moneyItems === null || moneyError) return;
        const target = { ...accessTarget };
        const ids = [...accessForm.querySelectorAll("input")].filter(input => input.checked).map(input => input.value);
        const available = new Set(moneyItems.map(item => item.id));
        const categoryIds = ids.filter(id => available.has(id));
        void save({ form: accessForm, label: "Saving…", operation: () => services.setSharedWalletMemberCategories(target.walletId, target.id, categoryIds),
            success: () => { accessDialog.close(); accessTarget = null; showMessage("Member category access updated."); } });
    }, { signal });
    signal.addEventListener("abort", () => dialogs.forEach(dialog => { if (dialog.open) dialog.close(); }), { once: true });

    function renderWallets(nextWallets, preferredId = selectedId) {
        if (!active()) return;
        wallets = nextWallets;
        const options = wallets.map(wallet => {
            const option = element("option", "", wallet.name);
            option.value = wallet.id;
            return option;
        });
        if (!options.length) {
            const option = element("option", "", "No shared wallets yet");
            option.value = "";
            options.push(option);
        }
        select.replaceChildren(...options);
        const nextId = wallets.some(wallet => wallet.id === preferredId) ? preferredId : wallets[0]?.id || "";
        if (nextId !== selectedId) {
            members = null; activity = null; membersError = ""; activityError = "";
            removeTarget = null; accessTarget = null; moneyItems = null; moneyError = "";
            // A live membership change must not leave a form targeting another wallet.
            for (const dialog of [renameDialog, inviteDialog, removeDialog, accessDialog]) if (dialog.open) dialog.close();
        }
        selectedId = nextId;
        select.value = selectedId;
        renderSelection(); renderMemberTable(); renderHistory(); lockControls();
    }
    function renderMembers(nextMembers, error = "") {
        if (!active()) return;
        members = nextMembers; membersError = error ? errorMessage(error) : "";
        if (accessDialog.open && !members?.some(member => (member.id || member.uid) === accessTarget?.id && member.role === "member")) {
            accessDialog.close(); accessTarget = null;
        }
        renderSelection(); renderMemberTable();
    }
    function renderActivity(events, error = "") {
        if (!active()) return;
        activity = events; activityError = error ? errorMessage(error) : "";
        renderHistory();
    }
    function renderError(text) { if (active()) showMessage(text, true); }
    function renderMoneyItems(items, error = "") {
        if (!active()) return;
        moneyItems = items; moneyError = error;
        renderMemberTable();
        if (accessDialog.open) renderCategoryChoices();
    }

    renderWallets([]);
    return { renderWallets, renderMembers, renderActivity, renderError, renderMoneyItems };
}
