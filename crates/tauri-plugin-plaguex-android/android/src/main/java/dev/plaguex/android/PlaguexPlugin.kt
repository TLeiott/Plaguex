package dev.plaguex.android

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import android.graphics.Color
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import androidx.media3.common.util.UnstableApi
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
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
class ShareFileArgs {
    var name: String = "plaguex-report.txt"
    var mime: String = "text/plain"
    var content: String = ""
    var subject: String = "Plaguex report"
}

@InvokeArg
class NativeLoadArgs {
    var req: NativePlayRequestArg = NativePlayRequestArg()
    lateinit var onEvent: Channel
}

@InvokeArg
class NativeControlArgs {
    var action: String = "pause"
    var value: Double? = null
}

@InvokeArg
class ExternalPlayArgs {
    var url: String = ""
    var mime: String = "video/*"
    var title: String = ""
    var positionMs: Long = 0
    var subtitleUrl: String? = null
}

@InvokeArg
class OpenVideoArgs {
    var url: String = ""
    var mime: String = "video/mp4"
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
@UnstableApi
@TauriPlugin
class PlaguexPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        val BACKGROUND: Int = Color.parseColor("#0B0B0F")
    }

    private var webView: WebView? = null
    private var insetTarget: View? = null
    private var fitSystemWindows = true
    private val background = BACKGROUND
    private var nativePlayer: NativePlayer? = null

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

    override fun onPause() {
        nativePlayer?.onPause()
    }

    /** Native ExoPlayer surface under the webview; see NativePlayer. */
    @Command
    fun nativeLoad(invoke: Invoke) {
        val args = invoke.parseArgs(NativeLoadArgs::class.java)
        val wv = webView
        if (wv == null) {
            invoke.reject("webview not ready")
            return
        }
        activity.runOnUiThread {
            try {
                val np = nativePlayer ?: NativePlayer(activity, wv).also { nativePlayer = it }
                np.load(args.req, args.onEvent)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "native player failed")
            }
        }
    }

    @Command
    fun nativeControl(invoke: Invoke) {
        val args = invoke.parseArgs(NativeControlArgs::class.java)
        activity.runOnUiThread { nativePlayer?.control(args.action, args.value) }
        invoke.resolve()
    }

    @Command
    fun nativeStop(invoke: Invoke) {
        activity.runOnUiThread { nativePlayer?.stop() }
        invoke.resolve()
    }

    /** Display, thermal, power and decoder facts for the diagnostics report. */
    @Command
    fun deviceInfo(invoke: Invoke) {
        invoke.resolve(DeviceInfo.collect(activity))
    }

    /** Opens the URL in another installed video player (A/B check against our own rendering). */
    @Command
    fun openVideo(invoke: Invoke) {
        val args = invoke.parseArgs(OpenVideoArgs::class.java)
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(android.net.Uri.parse(args.url), args.mime)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(Intent.createChooser(intent, "Play with"))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "no player found")
        }
    }

    /**
     * Hands playback to an installed player (VLC, MX Player, ...) and waits for it to finish.
     * Extras follow VLC's public intent API ("title", "position" in ms, "subtitles_location"); MX
     * Player shares "title"/"return_result". The result carries the end position when the player
     * reports one (VLC: extra_position/extra_duration; MX: position/duration/end_by).
     */
    @Command
    fun externalPlay(invoke: Invoke) {
        val args = invoke.parseArgs(ExternalPlayArgs::class.java)
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(android.net.Uri.parse(args.url), args.mime)
                putExtra("title", args.title)
                putExtra("position", args.positionMs)
                putExtra("return_result", true)
                args.subtitleUrl?.let { putExtra("subtitles_location", it) }
            }
            startActivityForResult(invoke, Intent.createChooser(intent, "Play with"), "onExternalPlayerResult")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "no player found")
        }
    }

    @ActivityCallback
    fun onExternalPlayerResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data
        fun longExtra(key: String) = data?.getLongExtra(key, -1L)?.takeIf { it >= 0 }
        fun intExtra(key: String) = data?.getIntExtra(key, -1)?.takeIf { it >= 0 }?.toLong()
        invoke.resolve(
            JSObject()
                .put("resultCode", result.resultCode)
                .put("positionMs", longExtra("extra_position") ?: intExtra("position") ?: -1L)
                .put("durationMs", longExtra("extra_duration") ?: intExtra("duration") ?: -1L)
                .put("completed", data?.getStringExtra("end_by") == "playback_completion")
        )
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

    /** Writes `content` to the app cache and opens the system share sheet for it. */
    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileArgs::class.java)
        try {
            // Reuses the FileProvider Tauri declares for the app (cache dir is exported there).
            val dir = File(activity.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, args.name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
            file.writeText(args.content)
            val uri = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", file
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = args.mime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, args.subject)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, args.subject))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "share failed")
        }
    }
}
