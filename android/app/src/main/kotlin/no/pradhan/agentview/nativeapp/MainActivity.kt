package no.pradhan.agentview.nativeapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class MainActivity : ComponentActivity() {
    private val hub: Hub by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handle(intent)
        // Reconnect each time the app returns to the foreground; close the stream in the background.
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = hub.connect()
            override fun onStop(owner: LifecycleOwner) = hub.disconnect()
        })
        setContent { AgentViewTheme { App(hub) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        intent.getStringExtra("origin")?.takeIf { it.isNotBlank() && it.trim().trimEnd('/') != hub.origin.value }?.let(hub::saveOrigin)
        parseDeepLink(intent.dataString)?.let { hub.link.value = it }
    }
}
