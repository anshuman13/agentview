package no.pradhan.agentview.nativeapp.app

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalConfiguration
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import no.pradhan.agentview.nativeapp.chat.ChatScreen
import no.pradhan.agentview.nativeapp.chat.VoiceHost
import no.pradhan.agentview.nativeapp.codex.CodexScreen
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheets
import no.pradhan.agentview.nativeapp.codex.autopilot.RunsScreen
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.net.OFFLINE_DELAY_MS
import no.pradhan.agentview.nativeapp.net.OfflineEvent
import no.pradhan.agentview.nativeapp.net.OfflineState
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.net.offlineBanner
import no.pradhan.agentview.nativeapp.ops.AgentScreen
import no.pradhan.agentview.nativeapp.ops.DeployScreen
import no.pradhan.agentview.nativeapp.ops.McpScreen
import no.pradhan.agentview.nativeapp.ops.ObserveScreen
import no.pradhan.agentview.nativeapp.ops.PullsScreen
import no.pradhan.agentview.nativeapp.sessions.SessionsScreen
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.SnackHost
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.BrowserScreen
import no.pradhan.agentview.nativeapp.workspace.ChangesScreen
import no.pradhan.agentview.nativeapp.workspace.FilesScreen
import no.pradhan.agentview.nativeapp.workspace.SketchesScreen
import no.pradhan.agentview.nativeapp.sessions.AdvisorsScreen
import no.pradhan.agentview.nativeapp.workspace.TerminalScreen

private const val ORIGIN_ROUTE = "origin"

internal fun icon(t: Tab): String = when (t) {
    Tab.Codex -> "sparkle"
    Tab.Chat -> "comment"
    Tab.Sessions -> "comment-discussion"
}

private const val RAIL_MIN_DP = 600
// Material window size class: two panes from 840dp.
private const val EXPANDED_MIN_DP = 840

fun isExpanded(widthDp: Int) = widthDp >= EXPANDED_MIN_DP

private class Dest(val label: String, val icon: String, val selected: Boolean, val badge: Int, val dot: Boolean = false, val onClick: () -> Unit)

@Composable
private fun DestIcon(d: Dest) = BadgedBox(badge = { if (d.badge > 0) Badge("${d.badge}", BadgeTone.Waiting) else if (d.dot) StatusDot(DotState.Warn) }) { AvIcon(d.icon, null, Tokens.iconLg) }

@Composable
private fun DestLabel(d: Dest) = Text(d.label, style = Type.label)

private fun isMore(route: String?) = route != null && (route.startsWith("more/") || route == ORIGIN_ROUTE)

private fun isAgent(route: String?) = route != null && route.startsWith("agent/")

private fun NavHostController.popAgents() {
    while (isAgent(currentDestination?.route)) if (!popBackStack()) break
}

private fun NavHostController.openMore(route: String) {
    popAgents()
    navigate(route) { launchSingleTop = true }
}

// Drops the agent pages and More pages on top first, so the tab shows its own screen and not the page saved with it.
private fun NavHostController.goTab(route: String) {
    popAgents()
    while (isMore(currentDestination?.route)) if (!popBackStack()) break
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun AppEffects(hub: Hub, nav: NavHostController, snack: SnackbarHostState) {
    val notice by hub.notice.collectAsState()
    val link by hub.link.collectAsState()
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); hub.notice.value = null } }
    LaunchedEffect(Unit) {
        hub.undoable.collectLatest { u ->
            snack.currentSnackbarData?.dismiss()
            if (snack.showSnackbar(u.text, if (u.undo != null) "Undo" else null, duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) u.undo?.invoke()
        }
    }
    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        l.chat?.let { hub.open(it) }
        if (l.page == "sketches") l.slug?.let { hub.sketchSlug.value = it }
        if (l.action == Shortcut.NEW_CHAT) hub.newChat()
        if (l.action == Shortcut.ADD_TASK) hub.addTask.value = true
        routeFor(l)?.let { r -> if (r.startsWith("more/")) nav.openMore(r) else nav.goTab(r) }
        hub.link.value = null
    }
}

@Composable
private fun rememberOfflineBanner(connected: Boolean): OfflineState {
    var banner by remember { mutableStateOf(OfflineState.Hidden) }
    LaunchedEffect(connected) {
        if (connected) { banner = offlineBanner(banner, OfflineEvent.Up); return@LaunchedEffect }
        banner = offlineBanner(banner, OfflineEvent.Down)
        delay(OFFLINE_DELAY_MS)
        banner = offlineBanner(banner, OfflineEvent.Elapsed)
    }
    return banner
}

@Composable
private fun rememberDests(hub: Hub, nav: NavHostController, route: String?, more: Boolean, onMore: (Boolean) -> Unit): List<Dest> {
    val live by hub.store.state.select { it.live }
    val shownId by hub.store.state.select { it.shownId }
    val counts by hub.counts.collectAsState()
    val shownChat = live.firstOrNull { it.id == shownId }
    val inAgent = isAgent(route)
    return Tab.entries.map { t ->
        val badge = when (t) {
            Tab.Chat -> shownChat?.pending ?: 0
            Tab.Sessions -> counts.chats
            else -> 0
        }
        Dest(t.label, icon(t), (route == t.route || (t == Tab.Chat && inAgent)) && !more, badge, dot = t == Tab.Codex && counts.needsYou > 0) { onMore(false); hub.track("tab:${t.name.lowercase()}"); nav.goTab(t.route) }
    } + Dest("More", "ellipsis", more || isMore(route), 0) { if (!more) hub.track("sheet:more"); onMore(true) }
}

@Composable
private fun PillTabBar(dests: List<Dest>) {
    val shape = RoundedCornerShape(Tokens.radiusPill)
    Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(start = Tokens.sp4, end = Tokens.sp4, top = Tokens.sp2, bottom = Tokens.sp2)) {
        Row(Modifier.fillMaxWidth().shadow(Tokens.elev2, shape).clip(shape).background(av.raised).padding(Tokens.sp2), horizontalArrangement = Arrangement.SpaceEvenly) {
            dests.forEach { d ->
                val tint = if (d.selected) av.fg else av.fgMuted
                Column(
                    Modifier.weight(1f).heightIn(min = Tokens.touch).clip(shape).background(if (d.selected) av.accentSoft else Color.Transparent)
                        .semantics(mergeDescendants = true) { role = Role.Tab; selected = d.selected }
                        .clickable(onClick = d.onClick).padding(vertical = Tokens.sp2),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    CompositionLocalProvider(LocalContentColor provides tint) { DestIcon(d); DestLabel(d) }
                }
            }
        }
    }
}

@Composable
private fun SideRail(dests: List<Dest>) {
    NavigationRail(containerColor = av.surface) {
        val colors = NavigationRailItemDefaults.colors(
            selectedIconColor = av.onSecondaryContainer, selectedTextColor = av.fg, indicatorColor = av.accentSoft,
            unselectedIconColor = av.fgMuted, unselectedTextColor = av.fgMuted,
        )
        dests.forEach { d -> NavigationRailItem(selected = d.selected, onClick = d.onClick, icon = { DestIcon(d) }, label = { DestLabel(d) }, colors = colors) }
    }
}

@Composable
private fun AppNavHost(hub: Hub, nav: NavHostController, twoPane: Boolean, modifier: Modifier) {
    val openAgent = { id: String -> nav.navigate("agent/${Uri.encode(id)}") }
    NavHost(nav, startDestination = Tab.Codex.route, modifier = modifier) {
        composable(Tab.Codex.route) { CodexScreen(hub) }
        composable(Tab.Chat.route) { if (twoPane) TwoPane(hub, openAgent) else ChatScreen(hub, onOpenAgent = openAgent) }
        composable(Tab.Sessions.route) { if (twoPane) TwoPane(hub, openAgent) else SessionsScreen(hub, onOpen = { nav.goTab(Tab.Chat.route) }) }
        composable("agent/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
            AgentScreen(hub, e.arguments?.getString("id") ?: "", onBack = { nav.popBackStack() }, onOpenAgent = openAgent)
        }
        (MORE_TOOLS + MORE_PAGES).forEach { m ->
            composable("more/${m.route}") { MorePage(m, hub, onBack = { nav.popBackStack() }, onTab = nav::goTab, onOrigin = { nav.navigate(ORIGIN_ROUTE) { launchSingleTop = true } }) }
        }
        composable(ORIGIN_ROUTE) { Column(Modifier.fillMaxSize()) { OriginScreen(hub, onDone = { nav.popBackStack() }) } }
    }
}

@Composable
private fun MoreSheet(deploy: Boolean, hidden: List<String>, onDismiss: () -> Unit, go: (String) -> Unit) {
    Sheet(onDismiss = onDismiss, title = "More", padded = false) {
        val icon = { name: String -> @Composable { AvIcon(name, null, Tokens.iconMd, tint = av.fgMuted) } }
        SectionHeader("Workspace")
        Group {
            moreTools(hidden).forEachIndexed { i, it ->
                if (i > 0) Hairline(lead = true)
                ListRow(it.label, leading = icon(it.icon), onClick = { go("more/${it.route}") })
            }
        }
        SectionHeader("Tools")
        Group {
            morePages(deploy, hidden).forEach { ListRow(it.label, leading = icon(it.icon), onClick = { go("more/${it.route}") }); Hairline(lead = true) }
            ListRow("Mac address", leading = icon("device-desktop"), onClick = { go(ORIGIN_ROUTE) })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(hub: Hub) {
    val nav = rememberNavController()
    val snack = remember { SnackbarHostState() }
    val connected by hub.connected.collectAsState()
    val shared by hub.shared.collectAsState()
    var more by rememberSaveable { mutableStateOf(false) }
    AppEffects(hub, nav, snack)
    val banner = rememberOfflineBanner(connected)
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val width = LocalConfiguration.current.screenWidthDp
    val rail = width >= RAIL_MIN_DP
    val navHidden by hub.navHidden.collectAsState()
    val composing by hub.composing.collectAsState()
    val shownId by hub.store.state.select { it.shownId }
    LaunchedEffect(route, shownId) { hub.navHidden.value = false }
    val dests = rememberDests(hub, nav, route, more) { more = it }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = av.bg,
            contentColor = av.fg,
            snackbarHost = { SnackHost(snack) },
            bottomBar = {
                if (!rail) AnimatedVisibility(
                    visible = !navHidden && !(composing && route == Tab.Chat.route) && !isAgent(route),
                    enter = slideInVertically(tween(Tokens.dur * 2)) { it } + expandVertically(tween(Tokens.dur * 2)),
                    exit = slideOutVertically(tween(Tokens.dur * 2)) { it } + shrinkVertically(tween(Tokens.dur * 2)),
                ) { PillTabBar(dests) }
            },
        ) { pad ->
            Row(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad).imePadding().windowInsetsPadding(WindowInsets.navigationBars)) {
                if (rail) SideRail(dests)
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    if (banner == OfflineState.Shown) OfflineBanner(onRetry = hub::retry)
                    AppNavHost(hub, nav, isExpanded(width), Modifier.weight(1f))
                }
            }
        }
        VoiceHost(hub)
    }

    shared?.let { ShareSheet(hub, it) }
    GoalSheets(hub)
    if (more) MoreSheet(hub.deploy.collectAsState().value, hub.hiddenFeatures.collectAsState().value, { more = false }) { r ->
        more = false
        val id = r.removePrefix("more/")
        hub.track(if (MORE_TOOLS.any { it.route == id }) "more:$id" else "page:$id")
        nav.openMore(r)
    }
}

// The Sessions list beside the open chat on wide windows.
@Composable
private fun TwoPane(hub: Hub, onOpenAgent: (String) -> Unit) {
    Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(2f).fillMaxHeight()) { SessionsScreen(hub, onOpen = {}) }
        Box(Modifier.width(Tokens.hairline).fillMaxHeight().background(av.border))
        Box(Modifier.weight(3f).fillMaxHeight()) { ChatScreen(hub, onOpenAgent) }
    }
}

@Composable
private fun OfflineBanner(onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(av.warnContainer).padding(start = Tokens.listPad, end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Offline. Trying to reconnect…", color = av.onWarnContainer, style = Type.subheadline)
        Button("Retry", onRetry, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

@Composable
private fun MorePage(m: MoreItem, hub: Hub, onBack: () -> Unit, onTab: (String) -> Unit, onOrigin: () -> Unit) = when (m.route) {
    "files" -> FilesScreen(hub, onBack)
    "changes" -> ChangesScreen(hub, onBack)
    "github" -> PullsScreen(hub, onBack)
    "terminal" -> TerminalScreen(hub, onBack)
    "browser" -> BrowserScreen(hub, onBack)
    "observe" -> ObserveScreen(hub, onBack)
    "deploy" -> DeployScreen(hub, onBack)
    "mcp" -> McpScreen(hub, onBack)
    "runs" -> RunsScreen(hub, onBack, { onTab(Tab.Chat.route) }, { onTab(Tab.Codex.route) })
    "sketches" -> SketchesScreen(hub, onBack)
    "advisors" -> AdvisorsScreen(hub, onBack) { onTab(Tab.Chat.route) }
    else -> SettingsScreen(hub, onBack, onOrigin)
}
