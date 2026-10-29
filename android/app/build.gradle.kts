plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.galaxyuniversity.whatsappscrapper"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.galaxyuniversity.waworkspace.v123"
        minSdk = 23
        targetSdk = 35
        versionCode = 8
        versionName = "1.2.5"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// v1.2.5: full Node regression suite + Android bundle/runtime-routing checks before APK build.
