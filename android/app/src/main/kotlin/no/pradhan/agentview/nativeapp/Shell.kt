package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.delay

private const val ORIGIN_ROUTE = "origin"

private fun icon(t: Tab): ImageVector = when (t) {
    Tab.Codex -> Icons.Filled.Star
    Tab.Chat -> Icons.Filled.Email
    Tab.Sessions -> Icons.AutoMirrored.Filled.List
    Tab.Agents -> Icons.Filled.Face
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
    var more by remember { mutableStateOf(false) }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); hub.notice.value = null } }

    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        l.chat?.let { hub.open(it) }
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
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                Tab.entries.forEach { t ->
                    val badge = when (t) {
                        Tab.Chat -> shownChat?.pending ?: 0
                        Tab.Sessions -> state.live.filter { it.id != state.shownId }.sumOf { it.pending }
                        else -> 0
                    }
                    NavigationBarItem(
                        selected = route == t.route && !more,
                        onClick = { more = false; nav.goTab(t.route) },
                        icon = { BadgedBox(badge = { if (badge > 0) Badge { Text("$badge") } }) { Icon(icon(t), null) } },
                        label = { Text(t.label) },
                    )
                }
                NavigationBarItem(selected = more || inMore, onClick = { more = true }, icon = { Icon(Icons.Filled.Menu, null) }, label = { Text("More") })
            }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad).imePadding()) {
            if (banner == OfflineState.Shown) OfflineBanner(onRetry = hub::retry)
            NavHost(nav, startDestination = Tab.Codex.route, modifier = Modifier.weight(1f)) {
                composable(Tab.Codex.route) { CodexScreen(hub) }
                composable(Tab.Chat.route) { ChatScreen(hub) }
                composable(Tab.Sessions.route) { SessionsScreen(hub, onOpen = { nav.goTab(Tab.Chat.route) }) }
                composable(Tab.Agents.route) { Placeholder("Agents") }
                (MORE_TOOLS + MORE_PAGES).forEach { m ->
                    composable("more/${m.route}") { Placeholder(m.label, onBack = { nav.popBackStack() }) }
                }
                composable(ORIGIN_ROUTE) { Column(Modifier.fillMaxSize()) { OriginScreen(hub, onDone = { nav.popBackStack() }) } }
            }
        }
    }

    if (more) {
        val go = { r: String -> more = false; nav.navigate(r) { launchSingleTop = true } }
        ModalBottomSheet(onDismissRequest = { more = false }) {
            Column(Modifier.padding(bottom = Sp.s8)) {
                MORE_TOOLS.forEach { SheetRow(it.label) { go("more/${it.route}") } }
                Text("Tools", Modifier.padding(horizontal = Sp.s8, vertical = Sp.s4), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                MORE_PAGES.forEach { SheetRow(it.label) { go("more/${it.route}") } }
                SheetRow("Mac address") { go(ORIGIN_ROUTE) }
            }
        }
    }
}

@Composable
private fun SheetRow(label: String, onClick: () -> Unit) {
    Text(label, Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = Sp.s8, vertical = Sp.s6), style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun OfflineBanner(onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = Sp.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Offline. Trying to reconnect...", color = av.warn, style = MaterialTheme.typography.labelMedium)
        TextButton(onClick = onRetry) { Text("Retry") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Placeholder(title: String, onBack: (() -> Unit)? = null) {
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
        Box(Modifier.fillMaxSize().padding(Sp.s12), contentAlignment = Alignment.Center) {
            Text("$title is not built yet.", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
