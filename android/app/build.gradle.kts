plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "no.pradhan.agentview.nativeapp"
    compileSdk = 36

    defaultConfig {
        applicationId = "no.pradhan.agentview.native"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1-spike"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.03.01")
    implementation(bom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.navigation:navigation-compose:2.9.6")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.24.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}

android.sourceSets.getByName("test").kotlin.srcDir("../buildSrc/src/main/kotlin")

tasks.register("generateTokens") {
    val css = rootProject.file("../agentview/web/src/styles/tokens.css")
    val out = file("src/main/kotlin/no/pradhan/agentview/nativeapp/Tokens.kt")
    inputs.file(css)
    outputs.file(out)
    doLast { out.writeText(no.pradhan.agentview.tokens.TokenGen.generate(css.readText(), "no.pradhan.agentview.nativeapp")) }
}
