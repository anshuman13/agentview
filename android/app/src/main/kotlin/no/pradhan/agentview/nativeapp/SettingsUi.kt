package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext

// Settings (web/src/app/Settings.tsx): About, Appearance and Phone groups.
@Composable
fun SettingsScreen(hub: Hub, onBack: () -> Unit, onOrigin: () -> Unit) {
    val theme by hub.theme.collectAsState()
    val origin by hub.origin.collectAsState()
    val ctx = LocalContext.current
    val version = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "Unknown"
    val dark = when (theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Settings", onBack, large = false)
        PageBody {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = Tokens.sp16)) {
                SectionHeader("About")
                Group { ListRow("App version", version) }
                SectionHeader("Appearance")
                Group { ListRow("Theme", (if (dark) "Dark" else "Light") + if (theme.isEmpty()) " (system)" else "", onClick = { hub.setTheme(if (dark) "light" else "dark") }) }
                SectionHeader("Phone")
                Group {
                    ListRow("Installed version", version)
                    Hairline()
                    ListRow("Mac address", origin, onClick = onOrigin)
                }
            }
        }
    }
}
