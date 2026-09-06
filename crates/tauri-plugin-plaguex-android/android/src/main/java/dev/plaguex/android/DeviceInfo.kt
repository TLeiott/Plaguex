package dev.plaguex.android

import android.app.Activity
import android.content.Context
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject

/** Facts that explain frame drops a player cannot fix: thermal throttling, battery saver, display
 * mode, and what the hardware decoders claim they can do at the video's resolution. */
object DeviceInfo {
    fun collect(activity: Activity): JSObject {
        val out = JSObject()
        out.put("model", "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE}) · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.HARDWARE}")
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        out.put("powerSaveMode", pm.isPowerSaveMode)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            out.put(
                "thermalStatus",
                when (pm.currentThermalStatus) {
                    PowerManager.THERMAL_STATUS_NONE -> "none"
                    PowerManager.THERMAL_STATUS_LIGHT -> "light"
                    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
                    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
                    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
                    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
                    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
                    else -> "unknown"
                },
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) out.put("thermalHeadroom", pm.getThermalHeadroom(0))
        val bm = activity.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        out.put("batteryPercent", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
        out.put("charging", bm.isCharging)
        val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display else activity.windowManager.defaultDisplay
        display?.let { d ->
            out.put("displayHz", d.refreshRate)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                out.put("displayModes", JSArray(d.supportedModes.map { m -> "${m.physicalWidth}x${m.physicalHeight}@${m.refreshRate.toInt()}" }))
                out.put("displayMode", "${d.mode.physicalWidth}x${d.mode.physicalHeight}@${d.mode.refreshRate}")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) out.put("hdrTypes", JSArray(d.hdrCapabilities?.supportedHdrTypes?.toList() ?: emptyList<Int>()))
        }
        out.put("decoders", JSArray(decoders()))
        return out
    }

    private fun decoders(): List<String> {
        val list = mutableListOf<String>()
        val mimes = listOf(MediaFormat.MIMETYPE_VIDEO_HEVC, MediaFormat.MIMETYPE_VIDEO_AVC, MediaFormat.MIMETYPE_VIDEO_AV1)
        for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
            if (info.isEncoder) continue
            for (mime in mimes) {
                if (!info.supportedTypes.any { it.equals(mime, ignoreCase = true) }) continue
                try {
                    val caps = info.getCapabilitiesForType(mime)
                    val video = caps.videoCapabilities ?: continue
                    val hw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.isHardwareAccelerated else !info.name.startsWith("OMX.google") && !info.name.startsWith("c2.android")
                    val achievable1080 = video.getAchievableFrameRatesFor(1920, 1080)
                    val achievable800 = video.getAchievableFrameRatesFor(1920, 800)
                    val supported800 = video.getSupportedFrameRatesFor(1920, 800)
                    val points = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        video.supportedPerformancePoints?.take(4)?.joinToString(",") { "${it}" } ?: "-"
                    } else "-"
                    val instances = caps.maxSupportedInstances
                    val profiles = caps.profileLevels.map { it.profile }.distinct().sorted().joinToString("/")
                    list.add(
                        "${info.name} [$mime] hw=$hw instances=$instances profiles=$profiles achievable 1920x1080=${fmt(achievable1080)} 1920x800=${fmt(achievable800)} supported 1920x800=${fmt(supported800)} perf=$points",
                    )
                } catch (_: Exception) {
                }
            }
        }
        return list
    }

    private fun fmt(r: android.util.Range<Double>?): String =
        if (r == null) "?" else "${r.lower.toInt()}-${r.upper.toInt()}fps"
}
