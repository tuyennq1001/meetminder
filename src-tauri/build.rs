fn main() {
    // screencapturekit crate requires linking to libswift_Concurrency.dylib
    // On macOS 15+, it's in the dyld shared cache at /usr/lib/swift/
    // The crate's build script adds @rpath references, but we need to ensure
    // the linker can resolve them. Adding /usr/lib/swift as rpath covers modern macOS.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    tauri_build::build()
}
