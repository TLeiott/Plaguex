package dev.plaguex.android

import android.app.Activity
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DecoderCounters
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.SubtitleView
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject

/** Playback request as sent by the web layer (see NativePlayRequest in platform/types.ts).
 * `@InvokeArg` keeps the field names under R8; Jackson fills them by reflection. */
@InvokeArg
class SubtitleFileArg {
    var url: String = ""
    var mime: String = "text/vtt"
    var language: String = ""
    var label: String = ""
}

@InvokeArg
class NativePlayRequestArg {
    var url: String = ""
    var title: String = ""
    var startSecs: Double = 0.0
    var hls: Boolean = false
    var httpHeaders: Map<String, String> = emptyMap()
    var audioTrack: Int? = null
    var subtitleTrack: Int? = null
    var embeddedSubtitleCount: Int = 0
    var subtitleFiles: List<SubtitleFileArg> = emptyList()
    var disableAudio: Boolean = false
    var decoder: String? = null
}

/**
 * ExoPlayer rendering into a SurfaceView placed *underneath* the WebView. While active the WebView
 * is transparent, so the web UI's controls float over the natively composited picture. This is the
 * hardware overlay path the WebView's own <video> never gets, which is what fixes frame pacing.
 */
@UnstableApi
class NativePlayer(private val activity: Activity, private val webView: WebView) {
    private var player: ExoPlayer? = null
    private var surface: SurfaceView? = null
    private var subtitles: SubtitleView? = null
    private var channel: Channel? = null
    private var decoder = ""
    private var pendingAudio: Int? = null
    private var pendingSubtitle: Int? = null
    private var embeddedSubtitleCount = 0
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            sendState()
            handler.postDelayed(this, 250)
        }
    }

    val isActive get() = player != null

    fun load(req: NativePlayRequestArg, channel: Channel) {
        release(keepViews = true)
        this.channel = channel
        pendingAudio = req.audioTrack
        pendingSubtitle = req.subtitleTrack
        embeddedSubtitleCount = req.embeddedSubtitleCount
        ensureViews()

        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("Plaguex")
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(req.httpHeaders)
        val dataSource = DefaultDataSource.Factory(activity, http)
        val renderers = DefaultRenderersFactory(activity)
            .setEnableDecoderFallback(true)
            .setMediaCodecSelector(codecSelector(req.decoder))
        val exo = ExoPlayer.Builder(activity, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        player = exo
        if (req.disableAudio) {
            exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build()
        }
        exo.setVideoSurfaceView(surface)
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) send(JSObject().put("type", "ended"))
                else sendState()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) = sendState()

            override fun onVideoSizeChanged(videoSize: VideoSize) = sendState()

            override fun onTracksChanged(tracks: Tracks) = applyTrackChoice(tracks)

            override fun onCues(cueGroup: androidx.media3.common.text.CueGroup) {
                subtitles?.setCues(cueGroup.cues)
            }

            override fun onPlayerError(error: PlaybackException) {
                val code = error.errorCode
                val fatal = code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                    code == PlaybackException.ERROR_CODE_DECODING_FAILED ||
                    code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
                    code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ||
                    code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED ||
                    code == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED
                send(
                    JSObject()
                        .put("type", "error")
                        .put("message", "${error.errorCodeName}: ${error.message ?: ""}")
                        .put("fatal", fatal)
                )
            }
        })
        exo.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoDecoderInitialized(
                eventTime: AnalyticsListener.EventTime,
                decoderName: String,
                initializedTimestampMs: Long,
                initializationDurationMs: Long,
            ) {
                decoder = decoderName
            }
        })

        val item = MediaItem.Builder().setUri(req.url)
        if (req.hls) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        item.setSubtitleConfigurations(
            req.subtitleFiles.mapIndexed { i, f ->
                MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(f.url))
                    .setMimeType(f.mime)
                    .setLanguage(f.language.ifEmpty { null })
                    .setLabel(f.label.ifEmpty { null })
                    .setId("sidecar-${i + 1}")
                    .setSelectionFlags(0)
                    .build()
            }
        )
        exo.setMediaItem(item.build(), (req.startSecs * 1000).toLong())
        exo.prepare()
        exo.playWhenReady = true
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    fun control(action: String, value: Double?) {
        val exo = player ?: return
        when (action) {
            "play" -> exo.play()
            "pause" -> exo.pause()
            "seek" -> value?.let { exo.seekTo((it * 1000).toLong()) }
            "volume" -> value?.let { exo.volume = it.toFloat().coerceIn(0f, 1f) }
        }
        sendState()
    }

    fun stop() = release(keepViews = false)

    /** Applies the requested audio/subtitle ordinals once the container's tracks are known. */
    private fun applyTrackChoice(tracks: Tracks) {
        val exo = player ?: return
        val params = exo.trackSelectionParameters.buildUpon()
        val audioGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        pendingAudio?.let { ordinal ->
            audioGroups.getOrNull(ordinal - 1)?.let { g ->
                params.setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0))
            }
        }
        val textGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        val embedded = textGroups.filter { !isSidecar(it) }
        val sidecars = textGroups.filter { isSidecar(it) }
        when (val ordinal = pendingSubtitle) {
            null -> {}
            0 -> params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            else -> {
                val group = if (ordinal <= embeddedSubtitleCount) embedded.getOrNull(ordinal - 1)
                else sidecars.getOrNull(ordinal - embeddedSubtitleCount - 1)
                if (group != null) {
                    params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                    params.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
                }
            }
        }
        // One shot: later track changes come as a fresh load().
        pendingAudio = null
        pendingSubtitle = null
        exo.trackSelectionParameters = params.build()
    }

    /**
     * Default decoder order, except the requested one (by name, or any software decoder for
     * "software") is tried first. Video only; audio keeps the platform's choice.
     */
    private fun codecSelector(preferred: String?) = MediaCodecSelector { mime, secure, tunneling ->
        val all = MediaCodecSelector.DEFAULT.getDecoderInfos(mime, secure, tunneling)
        if (preferred.isNullOrEmpty() || !MimeTypes.isVideo(mime)) all
        else all.sortedByDescending {
            if (preferred == "software") !it.hardwareAccelerated else it.name == preferred
        }
    }

    private fun isSidecar(group: Tracks.Group) =
        group.mediaTrackGroup.getFormat(0).id?.startsWith("sidecar-") == true

    private fun sendState() {
        val exo = player ?: return
        val counters: DecoderCounters? = exo.videoDecoderCounters
        val size = exo.videoSize
        send(
            JSObject()
                .put("type", "state")
                .put("playing", exo.playWhenReady && exo.playbackState != Player.STATE_ENDED)
                .put("buffering", exo.playbackState == Player.STATE_BUFFERING || exo.playbackState == Player.STATE_IDLE)
                .put("positionMs", exo.currentPosition)
                .put("bufferedMs", exo.bufferedPosition)
                .put("durationMs", if (exo.duration == C.TIME_UNSET) 0L else exo.duration)
                .put("width", size.width)
                .put("height", size.height)
                .put("decoder", decoder)
                .put("dropped", counters?.droppedBufferCount ?: 0)
                .put("rendered", counters?.renderedOutputBufferCount ?: 0)
                .put("skipped", counters?.skippedOutputBufferCount ?: 0)
                .put("maxConsecutiveDropped", counters?.maxConsecutiveDroppedBufferCount ?: 0)
                // Average early(+)/late(-) arrival of frames vs. their release time, in ms.
                .put(
                    "frameOffsetMs",
                    counters?.let {
                        if (it.videoFrameProcessingOffsetCount > 0)
                            it.totalVideoFrameProcessingOffsetUs / 1000.0 / it.videoFrameProcessingOffsetCount
                        else 0.0
                    } ?: 0.0,
                )
                .put("displayHz", displayHz())
        )
    }

    @Suppress("DEPRECATION")
    private fun displayHz(): Float =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) activity.display?.refreshRate ?: 0f
        else activity.windowManager.defaultDisplay.refreshRate

    private fun send(obj: JSObject) {
        channel?.send(obj)
    }

    private fun ensureViews() {
        if (surface != null) return
        val parent = webView.parent as? ViewGroup ?: return
        val lp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        )
        val sv = SurfaceView(activity)
        val subs = SubtitleView(activity).apply {
            setUserDefaultStyle()
            setUserDefaultTextSize()
            setBottomPaddingFraction(0.08f)
        }
        // Order: surface (bottom) -> subtitles -> webview (top, transparent).
        parent.addView(sv, 0, lp)
        parent.addView(subs, 1, lp)
        parent.setBackgroundColor(Color.BLACK)
        webView.setBackgroundColor(Color.TRANSPARENT)
        surface = sv
        subtitles = subs
    }

    private fun release(keepViews: Boolean) {
        handler.removeCallbacks(ticker)
        player?.release()
        player = null
        decoder = ""
        if (!keepViews) {
            val parent = webView.parent as? ViewGroup
            surface?.let { parent?.removeView(it) }
            subtitles?.let { parent?.removeView(it) }
            surface = null
            subtitles = null
            channel = null
            webView.setBackgroundColor(PlaguexPlugin.BACKGROUND)
            parent?.setBackgroundColor(PlaguexPlugin.BACKGROUND)
        }
    }

    /** App backgrounded: keep audio? No — a video app should pause like every other player. */
    fun onPause() {
        player?.pause()
        sendState()
    }
}
