const COMMANDS: &[&str] = &[
    "set_orientation",
    "set_immersive",
    "set_fit_system_windows",
    "share_file",
    "native_load",
    "native_control",
    "native_stop",
    "device_info",
    "open_video",
    "external_play",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
