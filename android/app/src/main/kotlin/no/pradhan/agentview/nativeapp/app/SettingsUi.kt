package no.pradhan.agentview.nativeapp.app

import android.content.Intent
import android.provider.Settings
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.setDefaultProvider
import no.pradhan.agentview.nativeapp.net.setFeatureUse
import no.pradhan.agentview.nativeapp.net.setNotify
import no.pradhan.agentview.nativeapp.net.setTheme
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Toggle
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.PageBody

// Settings (web/src/app/shell/Settings.tsx): Appearance, Phone, Privacy and About groups.
@Composable
fun SettingsScreen(hub: Hub, onBack: () -> Unit, onOrigin: () -> Unit) {
    val theme by hub.theme.collectAsState()
    val origin by hub.origin.collectAsState()
    val notify by hub.notifyOn.collectAsState()
    val granted by hub.granted.collectAsState()
    val providers by hub.providers.collectAsState()
    val default by hub.defaultProvider.collectAsState()
    val analytics by hub.featureUse.collectAsState()
    var dialog by rememberSaveable { mutableStateOf("") }
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
                    ListRow("Theme", (if (dark) "Dark" else "Light") + if (theme.isEmpty()) " (system)" else "", onClick = { menu.value = true }, trailing = {
                        Box {
                            Chevron()
                            Menu(menu.value, { menu.value = false }) {
                                listOf(Triple("", "System", "device-mobile"), Triple("light", "Light", "lightbulb"), Triple("dark", "Dark", "color-mode")).forEach { (v, label, icon) ->
                                    MenuItem(label, icon, { menu.value = false; hub.setTheme(v) }, checked = theme == v)
                                }
                            }
                        }
                    })
                }
                if (providers.size > 1) {
                    SectionHeader("Providers")
                    Group {
                        providers.forEach { p ->
                            ListRow(p.label, if (p.enabled) "Ready" else p.note)
                            Hairline()
                        }
                        val menu = remember { mutableStateOf(false) }
                        ListRow("New chats", providers.firstOrNull { it.id == default }?.label ?: default, onClick = { menu.value = true }, trailing = {
                            Box {
                                Chevron()
                                Menu(menu.value, { menu.value = false }) {
                                    providers.filter { it.enabled }.forEach { p -> MenuItem(p.label, "check", { menu.value = false; hub.setDefaultProvider(p.id) }, checked = default == p.id) }
                                }
                            }
                        })
                    }
                }
                SectionHeader("Phone")
                Group {
                    ListRow("Notifications", if (notify && granted) "On" else "Off", trailing = { Toggle(notify && granted, onChange = hub::setNotify) })
                    if (notify && granted) {
                        Hairline()
                        // Each kind is its own Android channel, so the system page turns each on or off and sets its sound.
                        ListRow("Notification types", NoticeKind.entries.joinToString(", ") { it.label }, onClick = {
                            ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
                        }, trailing = { Chevron() })
                    }
                    Hairline()
                    ListRow("Mac address", origin, onClick = onOrigin, trailing = { Chevron() })
                }
                SectionHeader("Privacy", action = { IconBtn("info", "About feature analytics", { dialog = "info" }) })
                Group {
                    ListRow("Feature analytics", if (analytics) "On" else "Off", trailing = {
                        Toggle(analytics, enabled = !hub.readOnly) { if (it) hub.setFeatureUse(true) else dialog = "off" }
                    })
                    if (analytics) {
                        Hairline()
                        ListRow("Feature use", onClick = { dialog = "use" }, trailing = { Chevron() })
                    }
                }
                SectionHeader("About")
                Group { ListRow("Installed version", version) }
            }
        }
    }
    when (dialog) {
        "off" -> ConfirmDialog("Turn off feature analytics?", "The counts so far are deleted.", "Turn off", { dialog = ""; hub.setFeatureUse(false) }, onDismiss = { dialog = "" })
        "use" -> FeatureUseSheet(hub) { dialog = "" }
        "info" -> Sheet({ dialog = "" }, "Feature analytics", full = false) {
            Group { ListRow("Counts per feature per day, kept on this Mac for 90 days, never sent anywhere.", lines = 3) }
        }
    }
}
