package no.pradhan.agentview.nativeapp.ui

import androidx.compose.runtime.Composable
import kotlin.coroutines.cancellation.CancellationException
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

// One field of a state flow, so the screen recomposes only when that field changes.
@Composable
fun <T, R> StateFlow<T>.select(pick: (T) -> R): State<R> {
    val flow = remember(this) { map(pick).distinctUntilChanged() }
    return flow.collectAsState(pick(value))
}

// Runs `block` while the app is in the foreground, and again after each return to it.
@Composable
fun WhileStarted(vararg keys: Any?, block: suspend CoroutineScope.() -> Unit) {
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner, *keys) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED, block) }
}

// The time, ticking every second while `active`; read it only in the small composables that show elapsed time.
@Composable
fun rememberNow(active: Boolean): State<Long> {
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(active) { while (active) { now.longValue = System.currentTimeMillis(); delay(1000) } }
    return now
}

// `value` once it has stayed the same for `ms`, so typing does not redo work on every key.
@Composable
fun <T> rememberSettled(value: T, ms: Long = 200): T {
    var settled by remember { mutableStateOf(value) }
    LaunchedEffect(value) { delay(ms); settled = value }
    return settled
}

// The state of one page request: the last data, the error of the last try, and whether one is running.
data class Loaded<T>(val data: T? = null, val error: String = "", val busy: Boolean = true)

// Runs `fetch` when a key changes or on refresh, keeping the previous data while it runs.
@Composable
fun <T> rememberLoad(vararg keys: Any?, fetch: suspend () -> T): Pair<Loaded<T>, () -> Unit> {
    var tick by remember { mutableIntStateOf(0) }
    var state by remember(*keys) { mutableStateOf(Loaded<T>()) }
    LaunchedEffect(*keys, tick) {
        state = state.copy(error = "", busy = true)
        state = try {
            Loaded(fetch(), "", false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Loaded(state.data, e.message?.ifEmpty { null } ?: "Request failed", false)
        }
    }
    return state to { tick++ }
}
