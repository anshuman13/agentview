package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.delay

private const val ORIGIN_ROUTE = "origin"

private fun icon(t: Tab): String = when (t) {
    Tab.Codex -> "sparkle"
    Tab.Chat -> "comment"
    Tab.Sessions -> "comment-discussion"
    Tab.Agents -> "hubot"
}

private fun NavHostController.goTab(route: String) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(hub: Hub) {
    val nav = rememberNavController()
    val snack = remember { SnackbarHostState() }
    val notice by hub.notice.collectAsState()
    val state by hub.store.state.collectAsState()
    val connected by hub.connected.collectAsState()
    val link by hub.link.collectAsState()
    val shared by hub.shared.collectAsState()
    var more by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); hub.notice.value = null } }

    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        l.chat?.let { hub.open(it) }
        if (l.action == Shortcut.NEW_CHAT) hub.newChat()
        if (l.action == Shortcut.ADD_TASK) hub.addTask.value = true
        routeFor(l)?.let { r -> if (r.startsWith("more/")) nav.navigate(r) { launchSingleTop = true } else nav.goTab(r) }
        hub.link.value = null
    }

    var banner by remember { mutableStateOf(OfflineState.Hidden) }
    LaunchedEffect(connected) {
        if (connected) { banner = offlineBanner(banner, OfflineEvent.Up); return@LaunchedEffect }
        banner = offlineBanner(banner, OfflineEvent.Down)
        delay(OFFLINE_DELAY_MS)
        banner = offlineBanner(banner, OfflineEvent.Elapsed)
    }

    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val inMore = route?.startsWith("more/") == true || route == ORIGIN_ROUTE
    val shownChat = state.live.firstOrNull { it.id == state.shownId }

    Scaffold(
        containerColor = if (route == Tab.Codex.route && !more) av.groupPage else av.bg,
        contentColor = av.fg,
        snackbarHost = { SnackHost(snack) },
        bottomBar = {
            Column {
                HorizontalDivider(color = av.border, thickness = Tokens.hairline)
                NavigationBar(containerColor = av.surface) {
                    val colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = av.fg, selectedTextColor = av.fg, indicatorColor = av.surface,
                        unselectedIconColor = av.fgMuted, unselectedTextColor = av.fgMuted,
                    )
                    Tab.entries.forEach { t ->
                        val badge = when (t) {
                            Tab.Chat -> shownChat?.pending ?: 0
                            Tab.Sessions -> state.live.filter { it.id != state.shownId }.sumOf { it.pending }
                            else -> 0
                        }
                        NavigationBarItem(
                            selected = route == t.route && !more,
                            onClick = { more = false; nav.goTab(t.route) },
                            icon = { BadgedBox(badge = { if (badge > 0) Badge("$badge", BadgeTone.Waiting) }) { AvIcon(icon(t), null, Tokens.iconLg) } },
                            label = { Text(t.label, style = Type.label) },
                            colors = colors,
                        )
                    }
                    NavigationBarItem(selected = more || inMore, onClick = { more = true }, icon = { AvIcon("menu", null, Tokens.iconLg) }, label = { Text("More", style = Type.label) }, colors = colors)
                }
            }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad).imePadding()) {
            if (banner == OfflineState.Shown) OfflineBanner(onRetry = hub::retry)
            NavHost(nav, startDestination = Tab.Codex.route, modifier = Modifier.weight(1f)) {
                composable(Tab.Codex.route) { CodexScreen(hub) }
                composable(Tab.Chat.route) { ChatScreen(hub) }
                composable(Tab.Sessions.route) { SessionsScreen(hub, onOpen = { nav.goTab(Tab.Chat.route) }) }
                composable(Tab.Agents.route) { AgentsScreen(hub) }
                (MORE_TOOLS + MORE_PAGES).forEach { m ->
                    composable("more/${m.route}") { MorePage(m, hub, onBack = { nav.popBackStack() }, onOrigin = { nav.navigate(ORIGIN_ROUTE) { launchSingleTop = true } }) }
                }
                composable(ORIGIN_ROUTE) { Column(Modifier.fillMaxSize()) { OriginScreen(hub, onDone = { nav.popBackStack() }) } }
            }
        }
    }

    shared?.let { ShareSheet(hub, it) }

    if (more) {
        val go = { r: String -> more = false; nav.navigate(r) { launchSingleTop = true } }
        Sheet(onDismiss = { more = false }, padded = false, full = false) {
            MORE_TOOLS.forEach { ListRow(it.label, onClick = { go("more/${it.route}") }) }
            SectionHeader("Tools")
            MORE_PAGES.forEach { ListRow(it.label, onClick = { go("more/${it.route}") }) }
            ListRow("Mac address", onClick = { go(ORIGIN_ROUTE) })
        }
    }
}

@Composable
private fun OfflineBanner(onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(av.warnSoft).padding(start = Tokens.listPad, end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Offline. Trying to reconnect...", color = av.warn, style = Type.subheadline)
        Button("Retry", onRetry, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

@Composable
private fun MorePage(m: MoreItem, hub: Hub, onBack: () -> Unit, onOrigin: () -> Unit) = when (m.route) {
    "files" -> FilesScreen(hub, onBack)
    "changes" -> ChangesScreen(hub, onBack)
    "github" -> PullsScreen(hub, onBack)
    "terminal" -> TerminalScreen(hub, onBack)
    "browser" -> BrowserScreen(hub, onBack)
    "observe" -> ObserveScreen(hub, onBack)
    "deploy" -> DeployScreen(hub, onBack)
    "mcp" -> McpScreen(hub, onBack)
    else -> SettingsScreen(hub, onBack, onOrigin)
}
