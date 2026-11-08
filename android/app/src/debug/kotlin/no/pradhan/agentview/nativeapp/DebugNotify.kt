package no.pradhan.agentview.nativeapp

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// adb shell am broadcast -n no.pradhan.agentview.native/no.pradhan.agentview.nativeapp.DebugNotify --es kind approval --es ask permission --es chat <id> --ei waiting 3
class DebugNotify : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val notifier = Notifier(context.applicationContext as Application)
        val kind = when (intent.getStringExtra("kind")) { "finished" -> NoticeKind.Finished; "failed" -> NoticeKind.Failed; else -> NoticeKind.Approval }
        val ask = when (intent.getStringExtra("ask")) { "permission" -> NoticeAsk.Permission; "question" -> NoticeAsk.Question; else -> NoticeAsk.None }
        val chat = intent.getStringExtra("chat") ?: "debug"
        notifier.post(Notice(kind, chat, "Claude ${kind.name.lowercase()} in agentview", "Debug notification", ask))
        if (intent.hasExtra("waiting")) {
            val n = intent.getIntExtra("waiting", 0)
            val snap = WaitingSnapshot(n, (1..minOf(n, WAITING_MAX)).map { WaitingLine("debug$it", "Chat $it", "agentview") })
            notifier.waiting(snap)
            WaitingStore.write(context, snap)
        }
    }
}
