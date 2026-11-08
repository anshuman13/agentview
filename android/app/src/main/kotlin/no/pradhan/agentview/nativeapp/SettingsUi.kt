package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext

// Settings (web/src/app/Settings.tsx): Appearance, Phone and About groups.
@Composable
fun SettingsScreen(hub: Hub, onBack: () -> Unit, onOrigin: () -> Unit) {
    val theme by hub.theme.collectAsState()
    val origin by hub.origin.collectAsState()
    val notify by hub.notifyOn.collectAsState()
    val granted by hub.granted.collectAsState()
    val ctx = LocalContext.current
    val version = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "Unknown"
    val dark = when (theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Settings", onBack)
        PageBody {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = Tokens.sp16)) {
                SectionHeader("Appearance")
                Group {
                    val menu = remember { mutableStateOf(false) }
                    Box {
                        ListRow("Theme", (if (dark) "Dark" else "Light") + if (theme.isEmpty()) " (system)" else "", onClick = { menu.value = true }, trailing = { Chevron() })
                        Menu(menu.value, { menu.value = false }) {
                            listOf("" to "System", "dark" to "Dark", "light" to "Light").forEach { (v, label) ->
                                MenuItem(label, if (v.isEmpty()) "device-desktop" else "color-mode", { menu.value = false; hub.setTheme(v) }, checked = theme == v)
                            }
                        }
                    }
                }
                SectionHeader("Phone")
                Group {
                    ListRow("Notifications", if (notify && granted) "On" else "Off", trailing = { Toggle(notify && granted, hub::setNotify) })
                    Hairline()
                    ListRow("Mac address", origin, onClick = onOrigin, trailing = { Chevron() })
                }
                SectionHeader("About")
                Group { ListRow("Installed version", version) }
            }
        }
    }
}
