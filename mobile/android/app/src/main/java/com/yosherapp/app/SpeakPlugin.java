package com.yosherapp.app;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * The other direction: the page hands the shell an answer and the phone says it.
 *
 * WHY THIS EXISTS AT ALL. The web reads its answers back with
 * `window.speechSynthesis`, which works in a desktop browser and is not
 * dependable inside an Android WebView — the API is present, the call is
 * accepted, and nothing comes out. The founder found it the plain way, on
 * 2026-09-13: *"I get voice feedback on the computer, but the phone app does
 * not."*
 *
 * That is the same shape as the microphone, and it gets the same answer.
 * [ADR 0049](../../../../../../../../docs/decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md)
 * decided speech-to-text forks by WHERE IT RUNS rather than by vendor — the
 * handset's own engine inside the app, the browser's outside it. Nothing about
 * that reasoning was specific to listening.
 *
 * **THE WEB STILL DECIDES EVERYTHING** (ADR 0032). This knows nothing about
 * what a sentence means, when something is worth saying, or whether this device
 * has been asked to stay quiet. It is handed words and it says them.
 */
@CapacitorPlugin(name = "Speak")
public class SpeakPlugin extends Plugin {

    private TextToSpeech engine = null;
    /** Set once the engine reports itself ready; nothing is spoken before. */
    private boolean ready = false;
    /** Said as soon as the engine is ready, for the answer that arrived first. */
    private String waiting = null;

    @Override
    public void load() {
        engine = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) {
                engine.setLanguage(Locale.getDefault());
                engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { }
                    @Override public void onError(String id) { }
                });
            }
            /*
             * THE FIRST ANSWER USUALLY ARRIVES BEFORE THE ENGINE DOES. Init is
             * asynchronous and a clock-in is recorded in well under a second, so
             * the common case on a cold start is a sentence with nowhere to go.
             * Dropping it would reproduce the exact bug this plugin exists to
             * fix, one layer down.
             */
            if (waiting != null) {
                String words = waiting;
                waiting = null;
                if (ready) say(words);
            }
        });
    }

    private void say(String words) {
        /*
         * FLUSH, NOT QUEUE. Two answers said quickly must not stack up: the
         * second one is the one that is true, and hearing the first finish is
         * how somebody walks away believing the wrong thing. The web's own
         * path cancels for the same reason.
         */
        engine.speak(words, TextToSpeech.QUEUE_FLUSH, null, "yosher");
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String words = call.getString("text");
        if (words == null || words.trim().isEmpty()) {
            call.resolve();
            return;
        }
        if (engine == null) {
            call.reject("no speech engine");
            return;
        }
        if (!ready) {
            /*
             * Held for `load`'s listener and answered YES straight away, rather
             * than kept open until the engine arrives. The page does not wait on
             * this promise to decide anything — it has its own way of noticing
             * silence — and holding a call across an async init is the kind of
             * thing that is only correct on the Capacitor version it was written
             * against.
             */
            waiting = words;
            call.resolve();
            return;
        }
        say(words);
        call.resolve();
    }

    /** Stop talking, now — the page asks for this when an answer is replaced. */
    @PluginMethod
    public void hush(PluginCall call) {
        if (engine != null && ready) engine.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) {
            engine.stop();
            engine.shutdown();
            engine = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
