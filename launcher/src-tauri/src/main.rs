// Pas de console sous Windows en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dual_pulse_launcher_lib::run()
}
