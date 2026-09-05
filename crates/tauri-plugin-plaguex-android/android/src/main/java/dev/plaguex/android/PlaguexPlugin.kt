package dev.plaguex.android

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class OrientationArgs {
    var mode: String = "auto"
}

@InvokeArg
class EnabledArgs {
    var enabled: Boolean = true
}

/**
 * Screen orientation, system-bar insets and immersive mode for the Plaguex webview.
 *
 * Android 15+ forces edge-to-edge for apps targeting SDK 35+, so instead of opting out we pad the
 * WebView by the system bar insets ("content goes below the status bar") and drop the padding only
 * while a video plays in immersive mode.
 */
@TauriPlugin
class PlaguexPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var insetTarget: View? = null
    private var fitSystemWindows = true
    private val background = Color.parseColor("#0B0B0F")

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        // A WebView ignores its own padding for web content, so pad the container it lives in.
        // The parent only exists once the view is attached, hence the post().
        webView.post {
            val window = activity.window
            WindowCompat.setDecorFitsSystemWindows(window, false)
            window.decorView.setBackgroundColor(background)
            webView.setBackgroundColor(background)
            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
            val target: View = (webView.parent as? View) ?: webView
            target.setBackgroundColor(background)
            insetTarget = target
            ViewCompat.setOnApplyWindowInsetsListener(target) { view, insets ->
                val bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                )
                if (fitSystemWindows) {
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    view.setPadding(0, 0, 0, 0)
                }
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(target)
        }
    }

    @Command
    fun setOrientation(invoke: Invoke) {
        val args = invoke.parseArgs(OrientationArgs::class.java)
        activity.runOnUiThread {
            activity.requestedOrientation = when (args.mode) {
                "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
        invoke.resolve()
    }

    @Command
    fun setImmersive(invoke: Invoke) {
        val args = invoke.parseArgs(EnabledArgs::class.java)
        activity.runOnUiThread {
            val window = activity.window
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            if (args.enabled) {
                controller.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
        }
        invoke.resolve()
    }

    @Command
    fun setFitSystemWindows(invoke: Invoke) {
        val args = invoke.parseArgs(EnabledArgs::class.java)
        fitSystemWindows = args.enabled
        activity.runOnUiThread { (insetTarget ?: webView)?.let { ViewCompat.requestApplyInsets(it) } }
        invoke.resolve()
    }
}
