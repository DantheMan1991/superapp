package com.yosherapp.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;

/**
 * The shell, plus ONE thing it does for itself: listening before the web
 * exists.
 *
 * ── WHY THERE IS JAVA HERE AT ALL ───────────────────────────────────────────
 *
 * Everything else about this app is a decision the web makes (ADR 0032), and
 * the home-screen shortcut was deliberately built that way — the shortcut
 * fired a url and `tell-launcher.tsx` decided what it meant. It worked, and it
 * was too slow, for a reason no amount of web work can fix:
 *
 *     long-press → Android starts the app → the WebView downloads
 *     yosherapp.com → the server renders the dashboard → JavaScript hydrates
 *     → only NOW does any code exist that can ask for a microphone
 *
 * The founder's words were "it takes way too long to load the app before the
 * microphone starts working. It needs to be immediate." He is right, and
 * nothing about the microphone is slow — he is waiting for a website.
 *
 * So the shortcut now opens the phone's OWN speech recogniser immediately,
 * which is a system screen and appears in the time it takes to draw one. The
 * app loads behind it. By the time the page is ready the words are already
 * waiting, and `TellPlugin` hands them over.
 *
 * This is also, arriving by a different road, what ADR 0049 always wanted for
 * the app: the phone's own engine, no upload, and nothing charged per minute.
 */
public class MainActivity extends BridgeActivity {

    /** `yosher://tell` — the same url the shortcut fires and the web listens for. */
    private static final String TELL_SCHEME = "yosher";
    private static final String TELL_HOST = "tell";

    private static final int ASK_SPEECH = 9001;

    /**
     * What was said before the page was ready, waiting to be collected.
     *
     * STATIC, and the reason is the whole point of this class: the recogniser
     * usually finishes BEFORE the WebView has a plugin to hand it to, so the
     * words have to outlive any instance that might be recreated by a rotation
     * or a low-memory kill on the way back. `TellPlugin.takePending()` clears
     * it, so a sentence is collected exactly once.
     */
    static volatile String pendingUtterance = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // BEFORE super.onCreate: Capacitor builds its bridge there, and a
        // plugin registered afterwards is not in it.
        registerPlugin(TellPlugin.class);
        super.onCreate(savedInstanceState);
        maybeListen(getIntent());
    }

    /**
     * The app was already running. `launchMode="singleTask"` means a second
     * long-press lands here rather than in `onCreate`, and it must listen just
     * the same — this is the FAST path, where the page is already loaded.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        maybeListen(intent);
    }

    private void maybeListen(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!TELL_SCHEME.equals(data.getScheme())) return;
        if (!TELL_HOST.equals(data.getHost())) return;

        Intent speech = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        speech.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        speech.putExtra(RecognizerIntent.EXTRA_PROMPT, "Tell Yosher what happened");
        // One answer. The web reads a sentence back before recording anything,
        // so a list of maybes would be a choice nobody asked to make.
        speech.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

        try {
            startActivityForResult(speech, ASK_SPEECH);
        } catch (ActivityNotFoundException e) {
            // No recogniser on this device — some Android builds ship without
            // one. Nothing is broken: the page still has its own microphone
            // button, which is what the web falls back to anyway.
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == ASK_SPEECH) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> said =
                    data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (said != null && !said.isEmpty()) {
                    String heard = said.get(0);
                    if (heard != null && !heard.trim().isEmpty()) {
                        // Told to the page if it is listening, and kept if it
                        // is not. BOTH, because which happens first depends on
                        // how long somebody talked and how fast the network is
                        // — and neither ordering may lose the sentence.
                        pendingUtterance = heard;
                        TellPlugin.announce(heard);
                    }
                }
            }
            // A cancelled recogniser is an ordinary outcome: somebody opened
            // it by mistake and pressed back. The app carries on loading.
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }
}
