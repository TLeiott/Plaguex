package dev.plaguex.android

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.graphics.Color
import android.view.View
import android.view.WindowManager
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

@InvokeArg
class DownloadStateArgs {
    var active: Boolean = false
    var title: String = "Downloading"
    var text: String = ""
    /** 0..100, or -1 for indeterminate */
    var progress: Int = -1
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
            // Immersive video: no inset padding and draw into the display cutout, so the picture
            // uses the whole panel; normal UI: padded below the bars and clear of the cutout.
            fitSystemWindows = !args.enabled
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.attributes = window.attributes.apply {
                    layoutInDisplayCutoutMode = if (args.enabled) {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    } else {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                    }
                }
            }
            if (args.enabled) {
                controller.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
            (insetTarget ?: webView)?.let { ViewCompat.requestApplyInsets(it) }
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

    /** Keeps the process alive with a progress notification while downloads run. */
    @Command
    fun setDownloadState(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadStateArgs::class.java)
        activity.runOnUiThread {
            if (args.active) {
                requestNotificationPermission()
                val intent = Intent(activity, DownloadService::class.java).apply {
                    action = DownloadService.ACTION_UPDATE
                    putExtra(DownloadService.EXTRA_TITLE, args.title)
                    putExtra(DownloadService.EXTRA_TEXT, args.text)
                    putExtra(DownloadService.EXTRA_PROGRESS, args.progress)
                }
                try {
                    ContextCompat.startForegroundService(activity, intent)
                } catch (_: Exception) {
                    // Background-start restrictions: the download still runs, just without the service.
                }
            } else {
                val intent = Intent(activity, DownloadService::class.java).apply {
                    action = DownloadService.ACTION_STOP
                }
                try {
                    activity.startService(intent)
                } catch (_: Exception) {
                }
            }
        }
        invoke.resolve()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            activity, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4712)
        }
    }
}
