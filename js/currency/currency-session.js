import { startCurrencyDisplay as startDisplay } from "./currency-display.js";
import { loadPreferences, savePreferences, saveThemePreference } from "../settings/preferences-store.js";

export function startCurrencyDisplay(user, signal) {
    return startDisplay(user, signal, { load: loadPreferences, save: savePreferences, saveTheme: saveThemePreference });
}
