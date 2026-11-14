import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "app.scrappy.player"
    defaultConfig {
        // Home servers are usually plain http:// on the local network.
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "app.scrappy.player"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // One fixed key, so a new build installs over the old one (keeps you signed in).
    // The key is made and kept by the GitHub build; it is never stored in the repo.
    val tvKey = file(System.getenv("TV_KEYSTORE") ?: "tv.keystore")
    signingConfigs {
        create("release") {
            storeFile = tvKey
            storePassword = System.getenv("TV_KEY_PASS") ?: ""
            keyAlias = "scrappy"
            keyPassword = System.getenv("TV_KEY_PASS") ?: ""
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (tvKey.exists()) signingConfig = signingConfigs.getByName("release")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
    buildFeatures {
        buildConfig = true
    }
    // Screen previews of the native TV screens run as plain unit tests (Robolectric, real drawing).
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { t ->
            t.maxHeapSize = "3g"
            System.getenv("PREVIEW_OUT")?.let { t.environment("PREVIEW_OUT", it) }
            System.getenv("ROBOLECTRIC_REPO")?.let { t.systemProperty("robolectric.dependency.repo.url", it) }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    // The TV's own video player.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    // Software sound decoder (Dolby, DTS, TrueHD) so the TV chip's sound decoder is never needed.
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.8.0+1")
    // Styled (ASS/SSA) subtitles drawn by libass, as mpv does on the PC.
    implementation("io.github.peerless2012:ass-media:0.5.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.18")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
