package com.yosherapp.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.CookieManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;

/**
 * The shell, plus ONE thing it does for itself: listening before the web
 * exists.
 *
 * ── WHY THERE IS JAVA HERE AT ALL ───────────────────────────────────────────
 *
 * Everything else about this app is a decision the web makes (ADR 0032). The
 * home-screen shortcut was built that way too — it fired a url and
 * `tell-launcher.tsx` decided what it meant. It worked, and it was too slow,
 * for a reason no amount of web work can fix:
 *
 *     long-press → Android starts the app → the WebView downloads
 *     yosherapp.com → the server renders the dashboard → JavaScript hydrates
 *     → only NOW does any code exist that can ask for a microphone
 *
 * Nothing about the microphone was slow. The founder was waiting for a
 * website.
 *
 * ── AND WHY IT IS `SpeechRecognizer`, NOT `RecognizerIntent` ────────────────
 *
 * The first version fired `RecognizerIntent`, and the founder's answer was
 * *"it really didn't speed it up. It takes a while for Android's recogniser to
 * fire up."* Right again, for a specific reason: that intent **launches
 * Google's speech app as a whole separate activity**, which has its own cold
 * start. One slow launch had been traded for two.
 *
 * `SpeechRecognizer` binds to the same service IN THIS PROCESS. No second
 * activity and no second launch — it is started here before Capacitor has
 * finished building its bridge, so **the microphone is live while the WebView
 * is still downloading.**
 *
 * The cost is that it draws nothing: there is no UI until the site loads and
 * shows its own "Listening…". That is the right trade for somebody holding a
 * bucket, and it is why `listening` is published — the page can say so the
 * moment it paints, rather than looking idle while the phone is recording.
 */
public class MainActivity extends BridgeActivity {

    /** `yosher://tell` — the url the shortcut fires and the web listens for. */
    private static final String TELL_SCHEME = "yosher";
    private static final String TELL_HOST = "tell";

    /** Where the app lives, so the launch cookie is set for the right site. */
    private static final String SITE = "https://yosherapp.com";

    /**
     * What was said before the page was ready, waiting to be collected.
     *
     * STATIC, and that is the point of this class: the recogniser usually
     * finishes BEFORE the WebView has a plugin to hand it to, so the words have
     * to outlive any instance a rotation might recreate.
     * `TellPlugin.takePending()` clears it, so a sentence is collected once.
     */
    static volatile String pendingUtterance = null;

    /** True between "the microphone opened" and "it stopped". Read by the page. */
    static volatile boolean listening = false;

    /**
     * Was THIS launch a long-press on "Say it"?
     *
     * Set here, in Java, and read by the page through `TellPlugin.wasTold()`.
     *
     * IT EXISTS BECAUSE THE TWO CLEVERER ANSWERS BOTH FAILED SILENTLY. First a
     * cookie set before the page loads, so the server would skip the launch
     * animation — `CookieManager` before any WebView exists does nothing on
     * some Android versions and says nothing about it. Then the page asking
     * Capacitor's `getLaunchUrl()`, which depends on how Capacitor chooses to
     * record an intent it did not define. Both were guesses about somebody
     * else's code, and the founder counted the same second and a half three
     * times.
     *
     * This is a boolean this class sets and this app reads. Nothing between.
     */
    static volatile boolean launchedToTell = false;

    private SpeechRecognizer recognizer = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // BEFORE super.onCreate, because that is where Capacitor builds its
        // bridge and starts the page loading. Both of these have to happen
        // first or they happen too late.
        boolean tell = isTellLaunch(getIntent());
        launchedToTell = tell;
        if (tell) skipTheLaunchAnimation();
        registerPlugin(TellPlugin.class);

        super.onCreate(savedInstanceState);

        if (tell) listenNow();
    }

    /**
     * The app was already running. `launchMode="singleTask"` sends a second
     * long-press here rather than to `onCreate`, and it must listen just the
     * same — this is the fast path, where the page is already loaded.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isTellLaunch(intent)) {
            // A warm long-press. The page is already up and has no animation
            // to skip, but the flag is kept honest either way.
            launchedToTell = true;
            listenNow();
        }
    }

    private boolean isTellLaunch(Intent intent) {
        if (intent == null) return false;
        Uri data = intent.getData();
        if (data == null) return false;
        return TELL_SCHEME.equals(data.getScheme()) && TELL_HOST.equals(data.getHost());
    }

    /**
     * NO LOGO, NO FADE, on a launch whose whole point is speed.
     *
     * The site plays a 1.5-second animation on its first paint inside the app
     * (`src/lib/launch.ts`: 650ms in, 450ms hold, 400ms out) and skips it when
     * a session cookie says this launch has already had one. Setting that
     * cookie here, before the page loads, is how the shell asks for the quiet
     * version — the founder's *"just open as fast as possible"*.
     *
     * Deliberately reusing the site's own mechanism rather than inventing a
     * second one: a flag the web had to learn about would be a flag that could
     * disagree with the cookie.
     */
    private void skipTheLaunchAnimation() {
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setCookie(SITE, "yosher_launched=1; path=/; SameSite=Lax");
            // Written to disk rather than left in memory. `setCookie` is
            // asynchronous, and the page load starts moments later in
            // `super.onCreate` — without this the request can go out before
            // the store has the cookie in it, which is the whole failure this
            // method exists to avoid.
            cookies.flush();
        } catch (Exception e) {
            // THIS IS ALLOWED TO FAIL, and it did once. `CookieManager` before
            // any WebView exists is exactly the sort of thing that works on
            // one Android version and silently does nothing on another. When
            // it does nothing the page still skips the animation, one frame
            // late, from `launch-overlay.tsx` — that is the reliable half and
            // this is the one with no flash at all.
        }
    }

    /**
     * Start the microphone, now, in this process.
     *
     * `SpeechRecognizer` must be created and driven on the main thread, which
     * `onCreate` and `onNewIntent` both already are.
     */
    private void listenNow() {
        // Not granted means the WebView has never asked. Do nothing rather than
        // throw a permission dialog on top of a launch: the page's own
        // microphone button asks properly, with a sentence explaining why.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;

        stopListening();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        } catch (Exception e) {
            recognizer = null;
            return;
        }

        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                listening = true;
                TellPlugin.announceListening(true);
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> said =
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                done(said == null || said.isEmpty() ? null : said.get(0));
            }

            @Override
            public void onError(int error) {
                // Nothing heard, a timeout, a busy service. All ordinary: the
                // page still has its own button.
                done(null);
            }

            private void done(String heard) {
                listening = false;
                if (heard != null && !heard.trim().isEmpty()) {
                    // Kept AND announced, because which happens first depends on
                    // how long somebody talked and how fast the network is —
                    // and neither ordering may lose the sentence.
                    pendingUtterance = heard;
                    TellPlugin.announce(heard);
                } else {
                    TellPlugin.announceListening(false);
                }
            }

            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}
        });

        Intent listen = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        listen.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        listen.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        listen.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        // Hints, which many recognisers ignore. Generous, because somebody who
        // pressed a shortcut may take a breath before starting: cutting them off
        // is worse than waiting a moment longer.
        listen.putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
            1500L
        );
        listen.putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
            1500L
        );

        try {
            recognizer.startListening(listen);
        } catch (Exception e) {
            stopListening();
        }
    }

    private void stopListening() {
        listening = false;
        if (recognizer == null) return;
        try {
            recognizer.cancel();
            recognizer.destroy();
        } catch (Exception e) {
            // Already gone.
        }
        recognizer = null;
    }

    @Override
    public void onDestroy() {
        stopListening();
        super.onDestroy();
    }
}
