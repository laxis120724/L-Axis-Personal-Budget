import { initializeSharedWallet } from "./shared-wallet-page.js";
import { createSharedMoneyView } from "./shared-money-page.js";
import { createSharedTransactionView } from "./shared-transaction-page.js";
import { createSharedOverviewView } from "./shared-overview-page.js";

// One membership list per signed-in application; selected-wallet feeds belong
// only to the current shared page and are released on selection/navigation.
export function createSharedWalletSession(lifetime, services) {
    let wallets = [];
    let loaded = false;
    let error = "";
    let selectedId = "";
    let requestedId = "";
    let view;
    let stopWallets = () => {};
    const walletObservers = new Set();

    function notifyWallets() {
        for (const observer of walletObservers) {
            if (error) observer.onError(new Error(error));
            else if (loaded) observer.onChange(wallets);
        }
    }

    function stopFeeds() {
        view?.feeds?.abort();
    }

    function subscribeFeed(method, controller, render) {
        const active = () => !lifetime.aborted && !controller.signal.aborted;
        let stop = () => {};
        controller.signal.addEventListener("abort", () => stop(), { once: true });
        Promise.resolve().then(method).then(unsubscribe => {
            if (!active()) unsubscribe();
            else stop = unsubscribe;
        }).catch(failure => { if (active()) render(null, failure.message); });
    }

    function renderSelection() {
        if (!view || lifetime.aborted || view.signal.aborted) return;
        view.controller.renderWallets(wallets, selectedId);
        view.moneyView?.setWallet(wallets.find(wallet => wallet.id === selectedId));
        view.transactionView?.setWallet(wallets.find(wallet => wallet.id === selectedId));
        view.overviewView?.setWallet(wallets.find(wallet => wallet.id === selectedId));
        const message = error || (!loaded ? "Loading your shared wallets…" : "");
        if (view.statusMessage !== message) {
            view.controller.renderError(message);
            view.statusMessage = message;
        }
        if (view.feedId === selectedId && view.feeds && !view.feeds.signal.aborted) return;
        stopFeeds();
        view.feedId = selectedId;
        view.feeds = new AbortController();
        view.controller.renderMembers(null);
        view.controller.renderActivity(null);
        view.controller.renderMoneyItems?.(null);
        view.moneyView?.renderItems(null);
        view.overviewView?.renderItems(null);
        view.overviewView?.renderMembers(null);
        if (!selectedId) return;
        const walletId = selectedId;
        const current = view;
        const feeds = current.feeds;
        const active = () => !lifetime.aborted && !current.signal.aborted
            && !feeds.signal.aborted && current === view && selectedId === walletId;
        subscribeFeed(() => services.watchSharedWalletMembers(walletId,
            members => { if (active()) { current.controller.renderMembers(members); current.overviewView?.renderMembers(members); } },
            failure => { if (active()) { current.controller.renderMembers(null, failure.message); current.overviewView?.renderMembers(null, failure.message); } }
        ), feeds, (members, message) => {
            if (active()) { current.controller.renderMembers(members, message); current.overviewView?.renderMembers(members, message); }
        });
        if (current.section === "info" || current.moneyView || current.overviewView) {
            subscribeFeed(() => services.watchSharedMoneyItems(walletId,
                items => {
                    if (active()) { current.controller.renderMoneyItems?.(items); current.moneyView?.renderItems(items); current.overviewView?.renderItems(items); }
                }, failure => {
                    if (active()) { current.controller.renderMoneyItems?.(null, failure.message); current.moneyView?.renderItems(null, failure.message); current.overviewView?.renderItems(null, failure.message); }
                }
            ), feeds, (items, message) => {
                if (active()) { current.controller.renderMoneyItems?.(items, message); current.moneyView?.renderItems(items, message); current.overviewView?.renderItems(items, message); }
            });
        }
        if (current.section === "info" || current.section === "overview") {
            subscribeFeed(() => services.watchSharedWalletActivity(walletId,
                events => { if (active()) current.controller.renderActivity(events); },
                failure => { if (active()) current.controller.renderActivity(null, failure.message); }
            ), feeds, (events, message) => {
                if (active()) current.controller.renderActivity(events, message);
            });
        }
    }

    function select(id) {
        if (lifetime.aborted) return;
        requestedId = id;
        if (wallets.some(wallet => wallet.id === id)) {
            selectedId = id;
            requestedId = "";
        }
        renderSelection();
    }

    Promise.resolve().then(() => services.watchSharedWallets(records => {
        if (lifetime.aborted) return;
        wallets = records;
        loaded = true;
        error = "";
        if (requestedId && wallets.some(wallet => wallet.id === requestedId)) {
            selectedId = requestedId;
            requestedId = "";
        } else if (!wallets.some(wallet => wallet.id === selectedId)) {
            selectedId = wallets[0]?.id || "";
        }
        renderSelection();
        notifyWallets();
    }, failure => {
        if (lifetime.aborted) return;
        wallets = [];
        selectedId = "";
        loaded = true;
        error = "Unable to load shared wallets: " + failure.message;
        renderSelection();
        notifyWallets();
    })).then(stop => {
        if (lifetime.aborted) stop();
        else stopWallets = stop;
    }).catch(failure => {
        if (!lifetime.aborted) {
            loaded = true;
            error = "Unable to load shared wallets: " + failure.message;
            renderSelection();
            notifyWallets();
        }
    });

    lifetime.addEventListener("abort", () => {
        stopFeeds();
        stopWallets();
        wallets = [];
        walletObservers.clear();
        selectedId = requestedId = "";
        view = undefined;
    }, { once: true });

    return {
        select,
        // Dashboard shares this membership feed instead of opening another query.
        watchWallets(onChange, onError) {
            if (lifetime.aborted) return () => {};
            const observer = { onChange, onError };
            walletObservers.add(observer);
            if (error) onError(new Error(error));
            else if (loaded) onChange(wallets);
            return () => walletObservers.delete(observer);
        },
        mount(root, signal, options) {
            stopFeeds();
            const controller = initializeSharedWallet(root, signal, {
                ...options, services, onSelect: select, onCreated: select
            });
            const moneyView = createSharedMoneyView(root, signal, { ...options, services });
            const transactionView = createSharedTransactionView(root, signal, { ...options, services });
            const overviewView = createSharedOverviewView(root, signal, { ...options, services });
            const current = { controller, moneyView, transactionView, overviewView, signal, section: options.section, feeds: null, feedId: null };
            view = current;
            signal.addEventListener("abort", () => {
                current.feeds?.abort();
                if (view === current) view = undefined;
            }, { once: true });
            renderSelection();
            return controller;
        }
    };
}
