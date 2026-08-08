package com.flashtech.henrycraft

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Henrycraft in a WebView.
 *
 * The whole game is a single self-contained index.html in assets, with three.js
 * bundled inside it, so this app needs no network and declares no permissions.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var lastBackPressAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Henry puts the tablet down to look at something and comes back to a
        // black screen otherwise.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Serve assets over https://appassets.androidplatform.net/ rather than
        // file:///android_asset/. A file:// page is treated as an opaque origin,
        // where DOM storage is unreliable, and the game's save code falls back
        // to localStorage - so loading over file:// would silently throw away
        // every world Henry builds. This is the whole reason for the asset
        // loader.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }

        webView.settings.apply {
            javaScriptEnabled = true

            // WITHOUT THIS, localStorage FAILS AND EVERY WORLD HENRY BUILDS IS
            // LOST. The game saves through a store shim that prefers
            // window.storage and falls back to localStorage; in here it is
            // always the localStorage path. Do not remove.
            domStorageEnabled = true

            // The dig, place and star sounds are Web Audio, which will not start
            // without this on a page the user has not "interacted" with yet.
            mediaPlaybackRequiresUserGesture = false

            // Fire tablets have a system font-size setting. Left alone it
            // rescales text inside the page and pushes the on-screen controls
            // out of position.
            textZoom = 100

            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = false
            useWideViewPort = false
        }

        // A child rests a finger on the screen constantly; without this that
        // becomes a text-selection long-press over the canvas.
        webView.isLongClickable = false
        webView.setOnLongClickListener { true }
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false

        goImmersive()

        // The Amazon Kids browser keeps a toolbar that cannot be hidden from the
        // page and eats roughly 56px of height. Re-assert immersive mode
        // whenever the system bars come back so this app really is edge to edge.
        webView.setOnApplyWindowInsetsListener { v, insets ->
            goImmersive()
            v.onApplyWindowInsets(insets)
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    private fun goImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, webView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        goImmersive()
    }

    override fun onPause() {
        // The page saves on visibilitychange, which fires before this, so the
        // world is already written by the time the timers stop.
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    /**
     * A five-year-old hits the back button by accident, and a single press would
     * drop him out of the game. Require two presses within two seconds.
     */
    @Deprecated("Fine on this minSdk; predictive back is not enabled for this app.")
    override fun onBackPressed() {
        val now = System.currentTimeMillis()
        if (now - lastBackPressAt < BACK_TO_QUIT_WINDOW_MS) {
            @Suppress("DEPRECATION")
            super.onBackPressed()
            return
        }
        lastBackPressAt = now
        Toast.makeText(this, R.string.quit_confirm, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val BACK_TO_QUIT_WINDOW_MS = 2000L
    }
}
