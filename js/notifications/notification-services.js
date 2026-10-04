import { watchMoneyItems } from "../money/money-store.js";
import { watchSharedMoneyItems } from "../shared-wallet/shared-money-store.js";
import { watchSharedWalletInvitations, watchSharedWalletActivity } from "../shared-wallet/shared-wallet-store.js";

export const watchNotificationMoneyItems = watchMoneyItems;
export const watchNotificationSharedMoneyItems = watchSharedMoneyItems;
export const watchNotificationInvitations = (change, error) =>
    watchSharedWalletInvitations(change, error, { includeResolved: true });
export const watchNotificationActivity = (walletId, change, error) =>
    watchSharedWalletActivity(walletId, change, error, { all: true });
