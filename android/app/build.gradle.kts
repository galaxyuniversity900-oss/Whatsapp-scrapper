plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.galaxyuniversity.whatsappscrapper"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.galaxyuniversity.whatsappscrapper"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
}
