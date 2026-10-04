export function renderNotificationList(container, records, { signal, pending, onRead, onOpen, onRespond, emptyMessage }) {
    const notificationNode = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const cards = records.map(record => {
        const card = notificationNode("article", "notification-card" + (record.type === "invitation" ? " invitation-card" : ""));
        card.dataset.notificationId = record.id;
        card.dataset.read = String(record.read);
        const heading = notificationNode("div", "notification-card__heading");
        const label = notificationNode("span", "notification-card__source", record.sourceLabel);
        const state = notificationNode("span", "notification-card__state", record.read ? "Read" : "Unread");
        heading.append(label, state);
        // The title link covers the card; action buttons stay above that link.
        const title = notificationNode("a", "notification-card__title notification-card__link", record.title);
        title.setAttribute("href", record.href);
        title.addEventListener("click", event => {
            event.preventDefault();
            onOpen(record);
        }, { signal });
        const message = notificationNode("p", "", record.message);
        const footer = notificationNode("div", "notification-card__footer");
        const date = new Date(record.created);
        const time = notificationNode("time", "", record.created ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date unavailable");
        if (record.created) time.setAttribute("datetime", date.toISOString());
        const read = notificationNode("button", "notification-read", record.read ? "Mark unread" : "Mark read");
        read.setAttribute("type", "button"); read.dataset.notificationRead = record.id;
        read.addEventListener("click", () => onRead(record, !record.read), { signal });
        footer.append(time, read);
        card.append(heading, title, message);
        if (record.type === "invitation") {
            if ((record.invitation.status || "pending") === "pending") {
                const actions = notificationNode("div", "invitation-actions");
                for (const accept of [true, false]) {
                    const button = notificationNode("button", accept ? "invitation-accept" : "invitation-decline", accept ? "Accept" : "Decline");
                    button.setAttribute("type", "button"); button.dataset.invitationDecision = "";
                    button.disabled = pending.has(record.invitation.id);
                    button.addEventListener("click", () => onRespond(record, accept), { signal }); actions.append(button);
                }
                card.append(actions);
            } else card.append(notificationNode("span", "notification-card__resolved", { accepted: "Accepted", declined: "Declined", revoked: "Invitation revoked" }[record.invitation.status] || "Resolved"));
        }
        card.append(footer);
        return card;
    });
    container.replaceChildren(...(cards.length ? cards : [notificationNode("p", "invitations-empty", emptyMessage)]));
}
