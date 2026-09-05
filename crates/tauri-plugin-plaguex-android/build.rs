const COMMANDS: &[&str] = &["set_orientation", "set_immersive", "set_fit_system_windows"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
