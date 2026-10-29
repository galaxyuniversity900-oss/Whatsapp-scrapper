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
        versionCode = 6
        versionName = "1.2.3"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Build trigger for the merged responsive sidebar, palette, and transition refresh on main.
