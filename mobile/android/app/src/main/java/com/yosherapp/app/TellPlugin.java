package com.yosherapp.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The hatch between the sentence the phone heard and the page that records it.
 *
 * The shell captures speech before the web exists (`MainActivity`), so there
 * has to be somewhere for the words to wait. That is all this is: no decisions,
 * no knowledge of what a sentence means, and nothing that could make the app
 * behave differently from the site. The web still decides everything
 * (ADR 0032) — it just gets handed the words instead of recording them itself.
 *
 * TWO WAYS OUT, because the ordering genuinely varies:
 *
 *   takePending()  the page loaded AFTER somebody finished speaking, which is
 *                  the usual way round on a cold start. It asks once, on mount.
 *   "utterance"    the page was already loaded — a second long-press, or a
 *                  slow talker on a fast connection. It is told.
 *
 * Whichever happens, `pendingUtterance` is cleared when it is taken, so a
 * sentence is recorded once and never twice.
 */
@CapacitorPlugin(name = "Tell")
public class TellPlugin extends Plugin {

    /**
     * The live instance, if the bridge has built one yet.
     *
     * Null during a cold start, which is exactly the case `takePending` covers.
     * Held statically because `MainActivity` has no other way to reach the
     * plugin the bridge owns.
     */
    private static TellPlugin current = null;

    @Override
    public void load() {
        current = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (current == this) current = null;
        super.handleOnDestroy();
    }

    /** Tell the page, if there is one listening. Safe to call when there is not. */
    static void announce(String utterance) {
        TellPlugin plugin = current;
        if (plugin == null) return;
        JSObject payload = new JSObject();
        payload.put("utterance", utterance);
        plugin.notifyListeners("utterance", payload);
    }

    /**
     * Hand over whatever is waiting, and forget it.
     *
     * Returns `{ utterance: null }` when there is nothing, which is the
     * ordinary answer every time the app is opened any other way.
     */
    @PluginMethod
    public void takePending(PluginCall call) {
        String waiting = MainActivity.pendingUtterance;
        MainActivity.pendingUtterance = null;

        JSObject result = new JSObject();
        result.put("utterance", waiting);
        call.resolve(result);
    }
}
