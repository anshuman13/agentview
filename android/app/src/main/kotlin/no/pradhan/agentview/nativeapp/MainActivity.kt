package no.pradhan.agentview.nativeapp

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class MainActivity : ComponentActivity() {
    private val hub: Hub by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        askNotifications()
        if (savedInstanceState == null) handle(intent)
        // Reconnect each time the app returns to the foreground; close the stream in the background.
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { hub.foreground = true; hub.connect() }
            // With notifications on the stream stays open for as long as the system keeps the process.
            override fun onStop(owner: LifecycleOwner) { hub.foreground = false; if (!hub.notifyOn.value) hub.disconnect() }
        })
        setContent {
            val theme by hub.theme.collectAsState()
            AgentViewTheme(theme) { App(hub) }
        }
    }

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    // Android 13+ asks once, like the web app asks on the first click.
    private fun askNotifications() {
        val prefs = getSharedPreferences("agentview", 0)
        if (Build.VERSION.SDK_INT < 33 || hub.notifier.granted() || prefs.getBoolean("notifyAsked", false)) return
        prefs.edit().putBoolean("notifyAsked", true).apply()
        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        if (intent.hasExtra("readonly")) hub.readOnly = intent.getBooleanExtra("readonly", false)
        intent.getStringExtra("origin")?.takeIf { it.isNotBlank() && it.trim().trimEnd('/') != hub.origin.value }?.let(hub::saveOrigin)
        sharedFrom(intent)?.let { hub.shared.value = it }
        parseDeepLink(intent.dataString)?.let { hub.link.value = it }
    }

    @Suppress("DEPRECATION")
    private fun sharedFrom(intent: Intent): SharedItem? {
        val images = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else -> return null
        }.map { it.toString() }
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (text.isNullOrBlank() && images.isEmpty()) return null
        return SharedItem(text, intent.getStringExtra(Intent.EXTRA_SUBJECT), images)
    }
}
